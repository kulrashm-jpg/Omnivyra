/**
 * SC-7 draft — deterministic governance detection.
 *
 * Every governance class is found by rules alone, across phrasings and channels;
 * near-miss sentences are NOT governance; the reused WhatsApp keyword list is total.
 */

import {
  GOVERNANCE_PHRASE_RULES,
  OPT_OUT_KEYWORD_CLASS,
  REUSED_OPT_OUT_KEYWORDS,
  detectGovernanceClasses,
} from '../../services/engagementClassification/governanceDetection';
import { WHATSAPP_OPT_OUT_KEYWORDS, detectWhatsAppOptOut } from '../../services/whatsappOptOut';

const CHANNELS = ['whatsapp', 'email', 'sms', 'linkedin', 'community', null] as const;

describe('governance detection reuses the WhatsApp inbound keyword rule', () => {
  it('reuses the very same keyword list (not a copy)', () => {
    expect(REUSED_OPT_OUT_KEYWORDS).toBe(WHATSAPP_OPT_OUT_KEYWORDS);
  });

  it('classifies every reused keyword as stop or unsubscribe (total, no extras)', () => {
    expect(Object.keys(OPT_OUT_KEYWORD_CLASS).sort()).toEqual([...WHATSAPP_OPT_OUT_KEYWORDS].sort());
    for (const k of WHATSAPP_OPT_OUT_KEYWORDS) expect(['stop', 'unsubscribe']).toContain(OPT_OUT_KEYWORD_CLASS[k]);
  });

  it('agrees with detectWhatsAppOptOut on every keyword: whenever it fires, a governance class is found', () => {
    for (const k of WHATSAPP_OPT_OUT_KEYWORDS) {
      expect(detectWhatsAppOptOut(k)).not.toBeNull();
      expect(detectGovernanceClasses({ text: k, channel: 'whatsapp' }).codes).toEqual([OPT_OUT_KEYWORD_CLASS[k]]);
    }
  });
});

describe.each(CHANNELS)('channel %s', (channel) => {
  it.each(['STOP', 'stop', 'Stop.', '  stop!  ', 'STOP ALL', 'stopall', 'Stop promotions', 'END', 'quit', 'Cancel'])(
    'whole-message STOP keyword %p -> stop',
    (text) => {
      const r = detectGovernanceClasses({ text, channel });
      expect(r.codes).toEqual(['stop']);
      expect(r.matches[0]).toMatchObject({ basis: 'keyword' });
    },
  );

  it.each(['UNSUBSCRIBE', 'unsubscribe', 'Opt out', 'opt-out', 'OPTOUT'])(
    'whole-message unsubscribe keyword %p -> unsubscribe',
    (text) => {
      expect(detectGovernanceClasses({ text, channel }).codes).toEqual(['unsubscribe']);
    },
  );

  it.each([
    ['Please stop emailing me.', 'stop'],
    ['stop messaging me', 'stop'],
    ['Can you stop contacting me', 'stop'],
    ['Stop sending me these emails', 'stop'],
    ["Don't contact me again", 'stop'],
    ['Never email me again please', 'stop'],
    ['Please unsubscribe me', 'unsubscribe'],
    ['Remove me from your mailing list', 'unsubscribe'],
    ['please remove me from your list, thanks', 'unsubscribe'],
    ['Take me off your list', 'unsubscribe'],
    ['opt me out', 'unsubscribe'],
    ["I'd like to unsubscribe", 'unsubscribe'],
    ['This is spam.', 'complaint'],
    ['I will report you', 'complaint'],
    ['We have reported your company to the regulator', 'complaint'],
    ['How did you get my email?', 'complaint'],
    ['I never signed up for this', 'complaint'],
    ['I am going to file a formal complaint', 'complaint'],
    ['Stop sending unsolicited emails', 'complaint'],
    ['Marked this as spam', 'complaint'],
    ['this is harassment', 'complaint'],
  ])('explicit phrase %p -> includes %s', (text, code) => {
    const r = detectGovernanceClasses({ text, channel });
    expect(r.codes).toContain(code);
    expect(r.matches.some((m) => m.code === code && m.basis === 'phrase')).toBe(true);
  });

  it.each([
    'please stop calling me at night',
    'Can you send me the report you mentioned?',
    'We should stop the campaign at the end of the month',
    'Do not contact me before Monday, I am travelling',
    "I'm interested, what's the pricing?",
    'Our spam filter caught your first email',
    'Let us cancel the meeting and reschedule',
    'I want to end our current contract with the competitor',
    '',
  ])('near-miss %p is NOT governance', (text) => {
    expect(detectGovernanceClasses({ text, channel }).codes).toEqual([]);
  });
});

describe('channel signals', () => {
  it('one-click List-Unsubscribe -> unsubscribe, whatever the text', () => {
    const r = detectGovernanceClasses({ text: 'Thanks!', channel: 'email', signals: { listUnsubscribe: true } });
    expect(r.codes).toEqual(['unsubscribe']);
    expect(r.matches).toEqual([{ code: 'unsubscribe', basis: 'channel_signal', rule: 'list_unsubscribe' }]);
  });

  it('provider complaint -> complaint, with no text at all', () => {
    expect(detectGovernanceClasses({ text: null, channel: 'email', signals: { providerComplaint: true } }).codes).toEqual(['complaint']);
  });

  it('Meta opt-out button -> stop, whatever the button text', () => {
    expect(detectGovernanceClasses({ text: 'No thanks', channel: 'whatsapp', signals: { optOutButton: true } }).codes).toEqual(['stop']);
  });

  it('signals that are absent or not strictly true do nothing', () => {
    expect(detectGovernanceClasses({ text: 'hello', signals: {} }).codes).toEqual([]);
    expect(
      detectGovernanceClasses({ text: 'hello', signals: { listUnsubscribe: 'yes' as unknown as boolean } }).codes,
    ).toEqual([]);
  });
});

describe('email replies: the first line above quoted text', () => {
  const quoted = 'STOP\n\nOn Tue, 3 Nov 2026, Sales <sales@example.com> wrote:\n> Hi, are you interested in a demo?';

  it('a STOP on the first line of an email reply is a keyword match', () => {
    const r = detectGovernanceClasses({ text: quoted, channel: 'email' });
    expect(r.codes).toEqual(['stop']);
    expect(r.matches[0]).toEqual({ code: 'stop', basis: 'keyword', rule: 'STOP' });
  });

  it('the first-line rule is email-only: WhatsApp keeps the whole-message rule unchanged', () => {
    expect(detectGovernanceClasses({ text: quoted, channel: 'whatsapp' }).codes).toEqual([]);
  });
});

describe('precedence and evidence', () => {
  it('orders multiple classes most-restrictive first: complaint, stop, unsubscribe', () => {
    const r = detectGovernanceClasses({
      text: 'Unsubscribe me. Stop emailing me. This is spam.',
      channel: 'email',
    });
    expect(r.codes).toEqual(['complaint', 'stop', 'unsubscribe']);
  });

  it('evidence never carries message text: keyword or rule id only', () => {
    const text = 'Please remove me from your mailing list - Jane Doe, +44 7700 900123';
    const r = detectGovernanceClasses({ text, channel: 'email' });
    expect(r.matches.length).toBeGreaterThan(0);
    for (const m of r.matches) {
      expect(text).not.toContain(m.rule);
      expect(m.rule).toMatch(/^[A-Z -]+$|^[a-z_]+\.[a-z_]+$|^[a-z_]+$/);
    }
  });

  it('every phrase rule id is unique and names its class', () => {
    const ids = GOVERNANCE_PHRASE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of GOVERNANCE_PHRASE_RULES) expect(r.id.startsWith(`${r.code}.`)).toBe(true);
  });

  it('never throws on non-string input', () => {
    for (const text of [undefined, null, 42 as unknown as string, {} as unknown as string]) {
      expect(detectGovernanceClasses({ text }).codes).toEqual([]);
    }
  });
});
