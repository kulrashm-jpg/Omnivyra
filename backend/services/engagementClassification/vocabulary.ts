/**
 * Canonical message-classification vocabulary (SC-7, DRAFT).
 *
 * One vocabulary for every inbound message, whatever produced the label. The three
 * existing classifiers keep their own outputs; each maps onto these codes through
 * the tables in `legacyMappings.ts`, and `classifyMessage.ts` is the single entry
 * point that returns a canonical classification.
 *
 * GOVERNANCE classes (`stop`, `unsubscribe`, `complaint`) are special:
 *   - only the deterministic detector in `governanceDetection.ts` may assign one;
 *   - no legacy mapping and no AI output ever maps to one;
 *   - once assigned, nothing downstream may remove or override it.
 *
 * Codes are stable identifiers. Renaming one is a contract change (SC-7), not a
 * refactor: PI and Orchestration key lifecycle and journey effects on them.
 */

export const CLASSIFICATION_VOCABULARY_VERSION = 'sc7-draft-1';

export const CANONICAL_CLASSIFICATION_CODES = [
  'positive_interest',
  'enquiry',
  'information_request',
  'pricing',
  'meeting_request',
  'objection',
  'not_interested',
  'follow_up',
  'complaint',
  'support_request',
  'unsubscribe',
  'stop',
  'wrong_recipient',
  'out_of_office',
  'spam_suspicious',
  'ambiguous',
] as const;

export type CanonicalClassificationCode = (typeof CANONICAL_CLASSIFICATION_CODES)[number];

export const GOVERNANCE_CLASSIFICATION_CODES = ['stop', 'unsubscribe', 'complaint'] as const;

export type GovernanceClassificationCode = (typeof GOVERNANCE_CLASSIFICATION_CODES)[number];

export interface CanonicalClassificationEntry {
  readonly code: CanonicalClassificationCode;
  readonly description: string;
  /** True only for classes the deterministic governance detector alone may assign. */
  readonly governance: boolean;
}

export const CLASSIFICATION_VOCABULARY: Readonly<Record<CanonicalClassificationCode, CanonicalClassificationEntry>> = {
  positive_interest: {
    code: 'positive_interest',
    description: 'The sender signals interest in the offer or in continuing the conversation.',
    governance: false,
  },
  enquiry: {
    code: 'enquiry',
    description: 'A commercial enquiry about the product, service or fit (buying-adjacent question).',
    governance: false,
  },
  information_request: {
    code: 'information_request',
    description: 'A general question or request for information that is not specifically commercial.',
    governance: false,
  },
  pricing: {
    code: 'pricing',
    description: 'A question about price, cost, plans or commercial terms.',
    governance: false,
  },
  meeting_request: {
    code: 'meeting_request',
    description: 'The sender asks for, accepts or proposes a meeting, call or demo.',
    governance: false,
  },
  objection: {
    code: 'objection',
    description: 'A stated concern or pushback that does not end the conversation.',
    governance: false,
  },
  not_interested: {
    code: 'not_interested',
    description: 'The sender declines THIS approach. Not an opt-out: it does not forbid future contact.',
    governance: false,
  },
  follow_up: {
    code: 'follow_up',
    description: 'The sender asks to be contacted later or refers to a later time.',
    governance: false,
  },
  complaint: {
    code: 'complaint',
    description:
      'An explicit complaint about being contacted (spam/abuse report, harassment, "how did you get my details"). ' +
      'Governance class. A product or service complaint is support_request, not this.',
    governance: true,
  },
  support_request: {
    code: 'support_request',
    description: 'A problem, defect or dissatisfaction with the product or service that needs help.',
    governance: false,
  },
  unsubscribe: {
    code: 'unsubscribe',
    description: 'A request to be removed from a list or from all future messages (unsubscribe / opt out).',
    governance: true,
  },
  stop: {
    code: 'stop',
    description: 'A channel STOP instruction (STOP, STOP ALL, END, QUIT, CANCEL or an explicit "stop messaging me").',
    governance: true,
  },
  wrong_recipient: {
    code: 'wrong_recipient',
    description: 'The sender says the message reached the wrong person.',
    governance: false,
  },
  out_of_office: {
    code: 'out_of_office',
    description: 'An automatic absence or out-of-office reply.',
    governance: false,
  },
  spam_suspicious: {
    code: 'spam_suspicious',
    description: 'The inbound message itself looks like spam, a scam or bot traffic.',
    governance: false,
  },
  ambiguous: {
    code: 'ambiguous',
    description: 'No class can be determined with confidence. Never a governance class.',
    governance: false,
  },
};

export function isCanonicalClassificationCode(value: unknown): value is CanonicalClassificationCode {
  return typeof value === 'string' && (CANONICAL_CLASSIFICATION_CODES as readonly string[]).includes(value);
}

export function isGovernanceClassificationCode(value: unknown): value is GovernanceClassificationCode {
  return typeof value === 'string' && (GOVERNANCE_CLASSIFICATION_CODES as readonly string[]).includes(value);
}
