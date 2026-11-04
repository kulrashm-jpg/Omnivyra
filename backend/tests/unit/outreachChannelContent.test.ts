/**
 * Outreach channel-content layer: profiles, formatters, validators.
 */
import {
  analyzeSms,
  CHANNEL_PROFILES,
  formatChannelContent,
  formatCommunityReply,
  formatEmail,
  formatSms,
  formatSocialPost,
  formatVoiceScript,
  formatWhatsApp,
  getSocialChannelProfile,
  PERSONALIZATION_FIELDS as LAYER_FIELDS,
  SMS_PROFILE,
  validateCommunityReply,
  validateEmail,
  validateSms,
  validateSocialPost,
  validateVoiceScript,
  validateWhatsApp,
} from '../../../lib/outreach/channelContent';
import { PERSONALIZATION_FIELDS } from '../../services/emailEngine/emailContentGenerator';
import { getPlatformProfile } from '../../../lib/content/platformAdaptationProfiles';
import { PROMOTION_PLATFORM_CHAR_LIMITS } from '../../../lib/content/promotionDraft';

const codes = (r: { findings: ReadonlyArray<{ code: string }> }) => r.findings.map((f) => f.code);

describe('profiles', () => {
  it('declares every channel with its required fields and rules', () => {
    expect(Object.keys(CHANNEL_PROFILES).sort()).toEqual(['community_reply', 'email', 'sms', 'voice_script', 'whatsapp']);
    expect(CHANNEL_PROFILES.email.fields.map((f) => [f.name, f.required])).toEqual([['subject', true], ['body', true]]);
    expect(CHANNEL_PROFILES.sms.status).toBe('formatting_only');
    expect(CHANNEL_PROFILES.voice_script.status).toBe('formatting_only');
    expect(CHANNEL_PROFILES.sms.segments).toEqual({ maxSegments: 3, encodingPolicy: 'auto' });
    expect(CHANNEL_PROFILES.community_reply.personalizationPermitted).toBe(false);
  });
});

describe('required fields', () => {
  it('email needs a subject and a body', () => {
    expect(validateEmail({ subject: '', body: 'Hello' })).toMatchObject({ valid: false });
    expect(validateEmail({ subject: '', body: 'Hello' }).findings[0]).toMatchObject({ code: 'required_field_missing', field: 'subject', severity: 'error' });
    expect(validateEmail({ subject: 'Hi', body: '   ' }).findings[0]).toMatchObject({ code: 'required_field_missing', field: 'body' });
    expect(validateEmail({ subject: 'Hi', body: 'Hello there' })).toEqual({ valid: true, findings: [] });
  });

  it.each([
    ['whatsapp', validateWhatsApp],
    ['community_reply', validateCommunityReply],
    ['sms', validateSms],
    ['voice_script', validateVoiceScript],
  ] as const)('%s needs a body', (_c, validate) => {
    expect(codes(validate({ body: null }))).toEqual(['required_field_missing']);
  });

  it('never throws for malformed input', () => {
    expect(() => validateEmail(undefined as never)).not.toThrow();
    expect(() => formatEmail({ subject: 42 as never, body: {} as never })).not.toThrow();
    expect(formatEmail({ subject: 42 as never, body: {} as never }).content).toBeNull();
  });
});

describe('length, link and emoji rules', () => {
  it('rejects content over the channel limit and accepts content at it', () => {
    expect(codes(validateWhatsApp({ body: 'a'.repeat(4097) }))).toContain('length_exceeded');
    expect(validateWhatsApp({ body: 'a'.repeat(4096) }).valid).toBe(true);
    expect(codes(validateEmail({ subject: 's'.repeat(201), body: 'b' }))).toContain('length_exceeded');
    expect(codes(validateCommunityReply({ body: 'a'.repeat(1501) }))).toContain('length_exceeded');
    expect(codes(validateVoiceScript({ body: 'a'.repeat(3001) }))).toContain('length_exceeded');
  });

  it('email subject must be one line and carry no link', () => {
    expect(codes(validateEmail({ subject: 'a\nb', body: 'x' }))).toContain('line_break_not_allowed');
    expect(codes(validateEmail({ subject: 'see https://x.io', body: 'x' }))).toContain('links_not_allowed');
  });

  it('voice scripts allow no links or emoji; community replies cap links', () => {
    expect(codes(validateVoiceScript({ body: 'visit www.example.com' }))).toEqual(['links_not_allowed']);
    expect(codes(validateVoiceScript({ body: 'great \u{1F600}' }))).toEqual(['emoji_not_allowed']);
    expect(codes(validateCommunityReply({ body: 'https://a.io and https://b.io' }))).toEqual(['too_many_links']);
  });
});

describe('SMS encoding and segments', () => {
  it('counts GSM-7 septets, including the extension table', () => {
    expect(analyzeSms('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(analyzeSms('a'.repeat(161))).toMatchObject({ encoding: 'gsm7', segments: 2 });
    expect(analyzeSms('a'.repeat(306))).toMatchObject({ segments: 2 });
    expect(analyzeSms('a'.repeat(307))).toMatchObject({ segments: 3 });
    expect(analyzeSms('€[]')).toMatchObject({ encoding: 'gsm7', units: 6 });
    expect(analyzeSms('')).toMatchObject({ segments: 0 });
  });

  it('switches to UCS-2 for non-GSM characters, counting UTF-16 units', () => {
    expect(analyzeSms('a'.repeat(69) + 'ç')).toMatchObject({ encoding: 'ucs2', units: 70, segments: 1, nonGsmCharacters: ['ç'] });
    expect(analyzeSms('a'.repeat(70) + 'ç')).toMatchObject({ encoding: 'ucs2', segments: 2 });
    expect(analyzeSms('\u{1F600}')).toMatchObject({ encoding: 'ucs2', units: 2 });
  });

  it('flags UCS-2 as a warning and too many segments as an error', () => {
    expect(validateSms({ body: 'ça va' }).findings).toEqual([expect.objectContaining({ code: 'sms_ucs2_encoding', severity: 'warning' })]);
    expect(validateSms({ body: 'ça va' }).valid).toBe(true);
    const long = validateSms({ body: 'ç'.repeat(202) });
    expect(codes(long)).toEqual(['sms_ucs2_encoding', 'sms_segments_exceeded']);
    expect(long.valid).toBe(false);
  });

  it('gsm7_only policy turns UCS-2 into an error', () => {
    const strict = { ...SMS_PROFILE, segments: { maxSegments: 3, encodingPolicy: 'gsm7_only' as const } };
    expect(formatChannelContent(strict, { body: 'ça va' }).findings[0]).toMatchObject({ code: 'sms_encoding_not_gsm7', severity: 'error' });
  });
});

describe('personalization guard', () => {
  it('uses the imported 041-D allow-list, not a copy', () => {
    expect(LAYER_FIELDS).toBe(PERSONALIZATION_FIELDS);
  });

  it('substitutes allow-listed fields from supplied values', () => {
    const r = formatEmail({ subject: 'Hi {{first_name}}', body: 'Hello {{ First_Name }} at {{city}}' }, { first_name: 'Ada', city: 'Pune' });
    expect(r.findings).toEqual([]);
    expect(r.content).toEqual({
      channel: 'email',
      fields: { subject: 'Hi Ada', body: 'Hello Ada at Pune' },
      personalizationUsed: { city: 'Pune', first_name: 'Ada' },
    });
  });

  it.each(['email', 'company_name', 'phone', 'linkedin_url', 'icp_score'])('refuses a placeholder for "%s"', (field) => {
    const v = validateWhatsApp({ body: `Hi {{${field}}}` });
    expect(v.valid).toBe(false);
    expect(v.findings[0]).toMatchObject({ code: 'personalization_unauthorized', severity: 'error' });
    expect(formatWhatsApp({ body: `Hi {{${field}}}` }, { [field]: 'x' }).content).toBeNull();
  });

  it('refuses a missing value instead of leaving a gap', () => {
    const r = formatSms({ body: 'Hi {{first_name}},' }, {});
    expect(r.content).toBeNull();
    expect(codes(r)).toEqual(['personalization_missing']);
  });

  it('refuses any placeholder on a public community reply', () => {
    const r = formatCommunityReply({ body: 'Thanks {{first_name}}' }, { first_name: 'Ada' });
    expect(r.content).toBeNull();
    expect(codes(r)).toEqual(['personalization_not_permitted']);
  });

  it('refuses placeholders in social posts', () => {
    expect(codes(validateSocialPost('linkedin', 'Hi {{first_name}}'))).toContain('personalization_not_permitted');
  });
});

describe('formatter determinism', () => {
  const input = { subject: '  Quick   question\r\n about {{job_title}} ', body: 'Line one   \r\n\r\n\r\n\r\nLine two\t\n' };
  const values = { job_title: 'CTO' };

  it('produces byte-identical output for the same input', () => {
    const a = JSON.stringify(formatEmail(input, values));
    const b = JSON.stringify(formatEmail({ ...input }, { ...values }));
    expect(a).toBe(b);
  });

  it('normalizes whitespace, line endings and Unicode form', () => {
    const r = formatEmail(input, values);
    expect(r.content?.fields).toEqual({ subject: 'Quick question about CTO', body: 'Line one\n\nLine two' });
    const composed = formatVoiceScript({ body: 'cafe\u0301' }).content?.fields.body;
    expect(composed).toBe('caf\u00e9');
  });

  it('does not depend on the clock or randomness', () => {
    const before = JSON.stringify(formatSms({ body: 'Hi {{first_name}}' }, { first_name: 'Ada' }));
    const realNow = Date.now;
    const realRandom = Math.random;
    try {
      Date.now = () => 0;
      Math.random = () => 0.5;
      expect(JSON.stringify(formatSms({ body: 'Hi {{first_name}}' }, { first_name: 'Ada' }))).toBe(before);
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });
});

describe('social adapter delegates to platformAdaptationProfiles', () => {
  it('returns the canonical adaptation profile object itself', () => {
    for (const p of ['linkedin', 'x', 'reddit', 'tiktok', 'ig']) {
      expect(getSocialChannelProfile(p).adaptation).toBe(getPlatformProfile(p));
    }
    expect(getSocialChannelProfile('mastodon').adaptation).toEqual(getPlatformProfile('mastodon'));
  });

  it('takes word range and emoji policy from the adaptation profile and caps from promotionDraft', () => {
    const x = getSocialChannelProfile('x');
    expect(x.wordRange).toBe(getPlatformProfile('x').wordRange);
    expect(x.maxCharacters).toBe(PROMOTION_PLATFORM_CHAR_LIMITS.x);
    expect(getSocialChannelProfile('reddit').emojiAllowed).toBe(false);
    expect(getSocialChannelProfile('youtube').maxCharacters).toBeNull();
  });

  it('validates against those delegated rules', () => {
    expect(codes(validateSocialPost('x', 'word '.repeat(60)))).toContain('length_exceeded');
    expect(codes(validateSocialPost('reddit', 'nice \u{1F600}'))).toContain('emoji_not_allowed');
    expect(codes(validateSocialPost('x', 'too short'))).toEqual(['word_range_outside_profile']);
    expect(formatSocialPost('ig', ' hello ').content?.fields).toEqual({ body: 'hello', platform: 'instagram' });
  });
});
