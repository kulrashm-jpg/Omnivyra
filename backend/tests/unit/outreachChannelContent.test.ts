/**
 * Outreach channel-content layer: profiles, formatters, validators.
 */
import fs from 'fs';
import path from 'path';
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
  HARD_LIMIT_EVIDENCE,
  PERSONALIZATION_FIELDS as LAYER_FIELDS,
  SCHEDULED_POSTS_CHAR_LIMITS,
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
    expect(CHANNEL_PROFILES.sms.segments).toEqual({ maxSegments: 3, encodingPolicy: 'auto', enforcement: 'advisory' });
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
  // D3: an evidence-backed limit refuses; a policy number only warns.
  it('refuses content over an evidence-backed limit and accepts content at it', () => {
    expect(validateWhatsApp({ body: 'a'.repeat(4097) }).findings).toEqual([expect.objectContaining({ code: 'length_exceeded', severity: 'error' })]);
    expect(validateWhatsApp({ body: 'a'.repeat(4096) }).valid).toBe(true);
    const subject = validateEmail({ subject: 's'.repeat(201), body: 'b' });
    expect(subject.valid).toBe(false);
    expect(subject.findings).toEqual([expect.objectContaining({ code: 'length_exceeded', severity: 'error', field: 'subject' })]);
  });

  it('warns, but does not refuse, over an advisory policy length', () => {
    for (const r of [
      validateCommunityReply({ body: 'a'.repeat(1501) }),
      validateVoiceScript({ body: 'a'.repeat(3001) }),
      validateEmail({ subject: 'Hi', body: 'b'.repeat(10001) }),
    ]) {
      expect(r.valid).toBe(true);
      expect(r.findings).toEqual([expect.objectContaining({ code: 'length_exceeded', severity: 'warning' })]);
    }
  });

  it('email subject must be one line (an error); a link in it is advised against', () => {
    expect(validateEmail({ subject: 'a\nb', body: 'x' }).findings).toEqual([expect.objectContaining({ code: 'line_break_not_allowed', severity: 'error' })]);
    const linked = validateEmail({ subject: 'see https://x.io', body: 'x' });
    expect(linked.valid).toBe(true);
    expect(linked.findings).toEqual([expect.objectContaining({ code: 'links_not_allowed', severity: 'warning' })]);
  });

  it('link and emoji counts are advisory on every channel', () => {
    expect(validateVoiceScript({ body: 'visit www.example.com' }).findings).toEqual([expect.objectContaining({ code: 'links_not_allowed', severity: 'warning' })]);
    expect(validateVoiceScript({ body: 'great \u{1F600}' }).findings).toEqual([expect.objectContaining({ code: 'emoji_not_allowed', severity: 'warning' })]);
    expect(validateCommunityReply({ body: 'https://a.io and https://b.io' }).findings).toEqual([expect.objectContaining({ code: 'too_many_links', severity: 'warning' })]);
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

  it('flags UCS-2 and the 3-segment policy as warnings (no SMS provider limit is evidenced)', () => {
    expect(validateSms({ body: 'ça va' }).findings).toEqual([expect.objectContaining({ code: 'sms_ucs2_encoding', severity: 'warning' })]);
    expect(validateSms({ body: 'ça va' }).valid).toBe(true);
    const long = validateSms({ body: 'ç'.repeat(202) });
    expect(codes(long)).toEqual(['sms_ucs2_encoding', 'sms_segments_exceeded']);
    expect(long.findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(long.valid).toBe(true);
  });

  it('a hard segment rule (with evidence) is an error', () => {
    const hard = { ...SMS_PROFILE, segments: { maxSegments: 3, encodingPolicy: 'auto' as const, enforcement: 'hard' as const } };
    expect(formatChannelContent(hard, { body: 'ç'.repeat(202) }).content).toBeNull();
  });

  it('gsm7_only policy turns UCS-2 into an error', () => {
    const strict = { ...SMS_PROFILE, segments: { maxSegments: 3, encodingPolicy: 'gsm7_only' as const, enforcement: 'advisory' as const } };
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

  it('takes style from the adaptation profile, hard caps from scheduled_posts, advisory caps from promotionDraft (D3)', () => {
    const x = getSocialChannelProfile('x');
    expect(x.wordRange).toBe(getPlatformProfile('x').wordRange);
    expect(x.maxCharacters).toBe(SCHEDULED_POSTS_CHAR_LIMITS.twitter);
    expect(x.advisoryMaxCharacters).toBeNull();
    expect(getSocialChannelProfile('reddit').emojiAllowed).toBe(false);
    // Enforced by the database, so hard here (it had no cap at all before D3).
    expect(getSocialChannelProfile('youtube').maxCharacters).toBe(5000);
    // No enforced cap: the promotionDraft number is advisory only.
    for (const p of ['threads', 'pinterest', 'reddit']) {
      expect(getSocialChannelProfile(p).maxCharacters).toBeNull();
      expect(getSocialChannelProfile(p).advisoryMaxCharacters).toBe(PROMOTION_PLATFORM_CHAR_LIMITS[p]);
    }
  });

  it('validates against those delegated rules', () => {
    expect(validateSocialPost('x', 'word '.repeat(60)).findings).toContainEqual(expect.objectContaining({ code: 'length_exceeded', severity: 'error' }));
    const threads = validateSocialPost('threads', 'word '.repeat(110));
    expect(threads.valid).toBe(true);
    expect(threads.findings).toContainEqual(expect.objectContaining({ code: 'length_exceeded', severity: 'warning' }));
    expect(validateSocialPost('reddit', 'nice \u{1F600}').findings).toContainEqual(expect.objectContaining({ code: 'emoji_not_allowed', severity: 'warning' }));
    expect(codes(validateSocialPost('x', 'too short'))).toEqual(['word_range_outside_profile']);
    expect(formatSocialPost('ig', ' hello ').content?.fields).toEqual({ body: 'hello', platform: 'instagram' });
  });
});

describe('D3: every hard limit is evidence-backed and pinned to its source', () => {
  const repo = path.resolve(__dirname, '../../..');
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

  it('the hard social caps equal the scheduled_posts CHECK constraints exactly', () => {
    const baseline = read('supabase/_schema/baseline.sql');
    const fromDb: Record<string, number> = {};
    for (const m of baseline.matchAll(/CONSTRAINT chk_(\w+)_content CHECK \(\(\(\(platform\)::text <> '(\w+)'::text\) OR \(length\(content\) <= (\d+)\)\)\)/g)) {
      expect(m[1]).toBe(m[2]);
      fromDb[m[2]] = Number(m[3]);
    }
    expect(Object.keys(fromDb).length).toBeGreaterThan(0);
    expect(fromDb).toEqual(SCHEDULED_POSTS_CHAR_LIMITS);
  });

  it('unifiedContentProcessor PLATFORM_CHAR_LIMITS mirrors them on every enforced platform', () => {
    const ucp = read('backend/services/unifiedContentProcessor.ts');
    const block = ucp.slice(ucp.indexOf('PLATFORM_CHAR_LIMITS'), ucp.indexOf('};', ucp.indexOf('PLATFORM_CHAR_LIMITS')));
    for (const [platform, limit] of Object.entries(SCHEDULED_POSTS_CHAR_LIMITS)) {
      expect(block).toMatch(new RegExp(`\\b${platform}:\\s*${limit},`));
    }
    expect(block).toMatch(/\bx:\s*280,/);
  });

  it('the email subject limit equals the generator constraint', () => {
    expect(read('backend/services/emailEngine/emailContentGenerator.ts')).toContain(`const SUBJECT_MAX = ${HARD_LIMIT_EVIDENCE.emailSubjectMax.value};`);
  });

  it('only the evidenced lengths are hard; every link, emoji and segment rule is advisory', () => {
    const hard = Object.values(CHANNEL_PROFILES).flatMap((p) => p.fields
      .filter((f) => f.length.enforcement === 'hard')
      .map((f) => `${p.channel}.${f.name}=${f.length.maxCharacters}`));
    expect(hard.sort()).toEqual(['email.subject=200', 'whatsapp.body=4096']);
    for (const p of Object.values(CHANNEL_PROFILES)) {
      for (const f of p.fields) {
        expect(f.links.enforcement).toBe('advisory');
        expect(f.emoji.enforcement).toBe('advisory');
      }
      if (p.segments) expect(p.segments.enforcement).toBe('advisory');
      expect(p.basis).toMatch(/advisory|hard/);
    }
  });

  it('negative controls: required fields, line breaks in a subject and unauthorized personalization still refuse', () => {
    expect(validateCommunityReply({ body: 'Thanks {{first_name}}' }).valid).toBe(false);
    expect(validateEmail({ subject: 'a\nb', body: 'x' }).valid).toBe(false);
    expect(validateWhatsApp({ body: '  ' }).valid).toBe(false);
    expect(validateWhatsApp({ body: 'Hi {{email}}' }).valid).toBe(false);
    expect(validateSocialPost('linkedin', 'Hi {{first_name}}').valid).toBe(false);
  });
});
