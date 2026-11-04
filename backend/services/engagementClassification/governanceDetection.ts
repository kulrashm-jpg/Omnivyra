/**
 * Deterministic governance detection (SC-7, DRAFT) — runs BEFORE any classifier.
 *
 * Assigns the governance classes `stop`, `unsubscribe` and `complaint` from rules
 * alone: no model, no network, no database. Its result is authoritative: the entry
 * point (`classifyMessage.ts`) lets classifiers ADD labels but never remove or
 * replace a governance class found here.
 *
 * REUSE, NOT DUPLICATION. The whole-message opt-out keyword rule is the WhatsApp
 * inbound path's own `detectWhatsAppOptOut` (whatsappOptOut.ts), which the Meta
 * webhook processor and the orchestration journey-exit sweep already use. This
 * module calls it unchanged and only decides which canonical class a matched
 * keyword is (`stop` or `unsubscribe`). It does NOT write anything: recording an
 * opt-out stays with `recordWhatsAppOptOut` / the contact-governance writer, and
 * that writer still fires on the whole-message rule only.
 *
 * Three rule kinds, in order of strength:
 *   keyword        the whole message (or, for email, its first non-empty line, above
 *                  any quoted text) is a standard opt-out keyword;
 *   channel_signal the transport itself says so (one-click List-Unsubscribe, a
 *                  provider complaint/abuse report, a Meta opt-out button);
 *   phrase         an explicit, high-precision phrase inside a longer message
 *                  ("remove me from your list", "stop emailing me", "this is spam").
 * Phrase rules are deliberately narrow: "please stop calling me at night" is not an
 * opt-out, and "send me the report you mentioned" is not a complaint.
 *
 * Evidence never carries message text: a keyword match records the keyword, a phrase
 * match records the rule id.
 */

import { WHATSAPP_OPT_OUT_KEYWORDS, detectWhatsAppOptOut } from '../whatsappOptOut';
import type { GovernanceClassificationCode } from './vocabulary';

export const GOVERNANCE_DETECTOR_VERSION = 'sc7-gov-1';

/** Most restrictive first. The primary governance class of a message is the first present. */
export const GOVERNANCE_PRECEDENCE: readonly GovernanceClassificationCode[] = ['complaint', 'stop', 'unsubscribe'];

/**
 * Which canonical class each WhatsApp opt-out keyword is. List-removal words are
 * `unsubscribe`; channel STOP words are `stop`. Both are opt-outs in the governance
 * store (the WhatsApp writer records every one as `unsubscribe`); the split is for
 * PI and Orchestration, which may treat a list removal and a channel STOP differently.
 * Total over WHATSAPP_OPT_OUT_KEYWORDS — enforced by a unit test.
 */
export const OPT_OUT_KEYWORD_CLASS: Readonly<Record<string, 'stop' | 'unsubscribe'>> = {
  STOP: 'stop',
  'STOP ALL': 'stop',
  STOPALL: 'stop',
  'STOP PROMOTIONS': 'stop',
  UNSUBSCRIBE: 'unsubscribe',
  'OPT OUT': 'unsubscribe',
  OPTOUT: 'unsubscribe',
  'OPT-OUT': 'unsubscribe',
  CANCEL: 'stop',
  END: 'stop',
  QUIT: 'stop',
};

export type GovernanceRuleBasis = 'keyword' | 'channel_signal' | 'phrase';

export interface GovernanceMatch {
  readonly code: GovernanceClassificationCode;
  readonly basis: GovernanceRuleBasis;
  /** The matched keyword, signal name or phrase-rule id. Never message text. */
  readonly rule: string;
}

export interface GovernanceDetection {
  readonly detectorVersion: string;
  /** Distinct governance classes found, ordered by GOVERNANCE_PRECEDENCE. Empty when none. */
  readonly codes: readonly GovernanceClassificationCode[];
  readonly matches: readonly GovernanceMatch[];
}

/** Transport facts a caller may already know. All optional; absent means "not signalled". */
export interface GovernanceChannelSignals {
  /** Email: the recipient used the one-click List-Unsubscribe (RFC 8058) link. */
  readonly listUnsubscribe?: boolean;
  /** Email/provider: a complaint or abuse report (e.g. an SES complaint notification). */
  readonly providerComplaint?: boolean;
  /** WhatsApp/Meta: the marketing opt-out quick-reply button payload, independent of its text. */
  readonly optOutButton?: boolean;
}

export interface GovernanceDetectionInput {
  readonly text: string | null | undefined;
  /** e.g. 'whatsapp' | 'email' | 'sms' | 'linkedin' | 'community'. Lower-cased internally. */
  readonly channel?: string | null;
  readonly signals?: GovernanceChannelSignals | null;
}

interface PhraseRule {
  readonly id: string;
  readonly code: GovernanceClassificationCode;
  readonly pattern: RegExp;
}

const ME_AGAIN = "(?:again|anymore|any more|ever again)";

export const GOVERNANCE_PHRASE_RULES: readonly PhraseRule[] = [
  // stop — an explicit instruction to stop contacting the sender
  { id: 'stop.stop_contacting_me', code: 'stop', pattern: /\bstop (?:e-?mailing|messaging|texting|contacting|writing to|dm'?ing) me\b/i },
  { id: 'stop.stop_sending_me', code: 'stop', pattern: /\bstop sending me (?:\w+ ){0,2}(?:messages|e-?mails|texts|dms)\b/i },
  {
    id: 'stop.do_not_contact_again',
    code: 'stop',
    pattern: new RegExp(`\\b(?:do not|don'?t|never) (?:contact|e-?mail|message|text|dm) me ${ME_AGAIN}\\b`, 'i'),
  },
  // unsubscribe — removal from a list / all future messages
  { id: 'unsubscribe.unsubscribe_me', code: 'unsubscribe', pattern: /\b(?:please )?unsubscribe me\b/i },
  { id: 'unsubscribe.please_unsubscribe', code: 'unsubscribe', pattern: /\bplease unsubscribe\b/i },
  {
    id: 'unsubscribe.remove_me_from_list',
    code: 'unsubscribe',
    pattern: /\b(?:remove|delete) me from (?:your|this|the|all (?:your )?) ?(?:mailing |email |e-mail |contact |distribution |marketing )?(?:list|lists|database)\b/i,
  },
  {
    id: 'unsubscribe.take_me_off_list',
    code: 'unsubscribe',
    pattern: /\btake me off (?:your|this|the) (?:mailing |email |e-mail |contact |distribution |marketing )?(?:list|lists)\b/i,
  },
  { id: 'unsubscribe.opt_me_out', code: 'unsubscribe', pattern: /\bopt me out\b/i },
  {
    id: 'unsubscribe.want_to_opt_out',
    code: 'unsubscribe',
    pattern: /\bi(?: want| wish| would like|'d like) to (?:unsubscribe|opt[ -]?out)\b/i,
  },
  // complaint — about being contacted, not about the product
  { id: 'complaint.this_is_spam', code: 'complaint', pattern: /\bthis is (?:spam|junk)\b/i },
  { id: 'complaint.stop_spamming', code: 'complaint', pattern: /\b(?:stop|quit) spamming\b/i },
  { id: 'complaint.mark_as_spam', code: 'complaint', pattern: /\b(?:mark(?:ed|ing)?|flag(?:ged|ging)?) (?:this|you|it|your \w+) as spam\b/i },
  {
    id: 'complaint.report_you',
    code: 'complaint',
    pattern: /\b(?:i(?:'ll| will| am going to|'m going to)|we(?:'ll| will)) report (?:you|this|your (?:company|business|messages?|e-?mails?))\b/i,
  },
  { id: 'complaint.reported_you', code: 'complaint', pattern: /\b(?:i|we) (?:have )?reported (?:you|this|your (?:company|business|messages?|e-?mails?))\b/i },
  { id: 'complaint.harassment', code: 'complaint', pattern: /\b(?:this is|you are|you're|stop) harass(?:ment|ing)\b/i },
  {
    id: 'complaint.how_did_you_get_my',
    code: 'complaint',
    pattern: /\bhow did you get (?:hold of )?my (?:e-?mail|number|phone number|details|contact(?: details)?|address|data|information)\b/i,
  },
  { id: 'complaint.never_signed_up', code: 'complaint', pattern: /\bi never (?:signed up|subscribed|opted in|gave you (?:my|permission|consent))\b/i },
  { id: 'complaint.formal_complaint', code: 'complaint', pattern: /\b(?:file|filing|lodge|lodging|make|making|raise|raising) a (?:formal )?complaint\b/i },
  { id: 'complaint.unsolicited', code: 'complaint', pattern: /\bunsolicited (?:e-?mails?|messages?|texts?|contact|marketing|spam)\b/i },
];

/** Email replies quote the original below the reply; the reply's own first line is what the person typed. */
function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function orderCodes(matches: readonly GovernanceMatch[]): GovernanceClassificationCode[] {
  const present = new Set(matches.map((m) => m.code));
  return GOVERNANCE_PRECEDENCE.filter((c) => present.has(c));
}

/**
 * Detect governance classes. Pure and synchronous; never throws on any input.
 */
export function detectGovernanceClasses(input: GovernanceDetectionInput): GovernanceDetection {
  const matches: GovernanceMatch[] = [];
  const text = typeof input.text === 'string' ? input.text : '';
  const channel = (input.channel ?? '').toString().trim().toLowerCase();
  const signals = input.signals ?? {};

  // 1. Whole-message keyword — the WhatsApp inbound rule, reused as is.
  let keywordHit = detectWhatsAppOptOut(text);
  if (!keywordHit && channel === 'email') {
    const first = firstNonEmptyLine(text);
    if (first && first !== text.trim()) keywordHit = detectWhatsAppOptOut(first);
  }
  if (keywordHit) {
    const code = OPT_OUT_KEYWORD_CLASS[keywordHit.keyword] ?? 'stop';
    matches.push({ code, basis: 'keyword', rule: keywordHit.keyword });
  }

  // 2. Channel signals.
  if (signals.listUnsubscribe === true) matches.push({ code: 'unsubscribe', basis: 'channel_signal', rule: 'list_unsubscribe' });
  if (signals.providerComplaint === true) matches.push({ code: 'complaint', basis: 'channel_signal', rule: 'provider_complaint' });
  if (signals.optOutButton === true) matches.push({ code: 'stop', basis: 'channel_signal', rule: 'opt_out_button' });

  // 3. Explicit phrases.
  if (text) {
    for (const rule of GOVERNANCE_PHRASE_RULES) {
      if (rule.pattern.test(text)) matches.push({ code: rule.code, basis: 'phrase', rule: rule.id });
    }
  }

  return { detectorVersion: GOVERNANCE_DETECTOR_VERSION, codes: orderCodes(matches), matches };
}

/** Exposed for the totality test: every reused keyword has a canonical class. */
export const REUSED_OPT_OUT_KEYWORDS: readonly string[] = WHATSAPP_OPT_OUT_KEYWORDS;
