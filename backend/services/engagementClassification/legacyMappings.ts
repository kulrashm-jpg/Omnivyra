/**
 * Legacy classifier output → canonical code (SC-7, DRAFT).
 *
 * One explicit table per existing producer of message labels. Every table is
 * TOTAL over its producer's output set (compile-time where the producer exports a
 * type, unit-tested otherwise) and maps ONLY to non-governance codes: a governance
 * class (`stop`, `unsubscribe`, `complaint`) can come from the deterministic
 * detector alone. A legacy "complaint" is a product/service complaint and maps to
 * `support_request`; where a legacy producer hints at a governance issue the entry
 * records it as `governanceCandidate`, which the entry point surfaces for review
 * but never treats as authoritative.
 *
 * `fit` says how good the match is:
 *   exact        same meaning;
 *   approximate  nearest canonical class, some meaning lost;
 *   none         the legacy label has no canonical equivalent (community-shaped
 *                triage labels); it maps to `ambiguous`.
 *
 * This module imports producer TYPES only, so the services can import it at runtime
 * without a cycle.
 */

import type { ClassificationCategory } from '../conversationTriageService';
import type { MessageIntent } from '../responsePolicyEngine';
import type { CanonicalClassificationCode, GovernanceClassificationCode } from './vocabulary';

type NonGovernanceCode = Exclude<CanonicalClassificationCode, GovernanceClassificationCode>;

export interface LegacyMappingEntry {
  readonly code: NonGovernanceCode;
  readonly fit: 'exact' | 'approximate' | 'none';
  /** A governance class this label MIGHT indicate. Advisory only; never authoritative. */
  readonly governanceCandidate?: GovernanceClassificationCode;
}

/** conversationTriageService.CLASSIFICATION_CATEGORIES (thread-level, community-shaped). */
export const TRIAGE_CATEGORY_TO_CANONICAL: Readonly<Record<ClassificationCategory, LegacyMappingEntry>> = {
  question_request: { code: 'information_request', fit: 'exact' },
  recommendation_request: { code: 'enquiry', fit: 'approximate' },
  // A complaint about a COMPETITOR is neither a support request to us nor a
  // governance complaint. No canonical equivalent; see SC-7 open question Q-2.
  competitor_complaint: { code: 'ambiguous', fit: 'none' },
  // Someone discussing a problem they have (prospect pain), not asking us for support.
  problem_discussion: { code: 'ambiguous', fit: 'none' },
  product_comparison: { code: 'enquiry', fit: 'approximate' },
  general_comment: { code: 'ambiguous', fit: 'exact' },
};

/**
 * engagementConversationIntelligenceService `intent` values. The rule-based pass
 * always sets one of these four; the Omnivyra pass only ever falls back to them.
 */
export const INTELLIGENCE_INTENTS = ['lead', 'question', 'complaint', 'general'] as const;
export type IntelligenceIntent = (typeof INTELLIGENCE_INTENTS)[number];

export const INTELLIGENCE_INTENT_TO_CANONICAL: Readonly<Record<IntelligenceIntent, LegacyMappingEntry>> = {
  lead: { code: 'positive_interest', fit: 'approximate' },
  question: { code: 'information_request', fit: 'exact' },
  // Rule: negative words ("problem", "not working", "disappointed") or negative sentiment.
  complaint: { code: 'support_request', fit: 'approximate', governanceCandidate: 'complaint' },
  general: { code: 'ambiguous', fit: 'exact' },
};

/** responsePolicyEngine.MessageIntent (the `response_rules.intent_type` vocabulary). */
export const POLICY_INTENT_TO_CANONICAL: Readonly<Record<MessageIntent, LegacyMappingEntry>> = {
  greeting: { code: 'ambiguous', fit: 'none' },
  introduction: { code: 'ambiguous', fit: 'none' },
  question: { code: 'information_request', fit: 'exact' },
  product_inquiry: { code: 'enquiry', fit: 'exact' },
  price_inquiry: { code: 'pricing', fit: 'exact' },
  positive_feedback: { code: 'positive_interest', fit: 'approximate' },
  negative_feedback: { code: 'objection', fit: 'approximate' },
  complaint: { code: 'support_request', fit: 'approximate', governanceCandidate: 'complaint' },
  lead_interest: { code: 'positive_interest', fit: 'exact' },
  general_discussion: { code: 'ambiguous', fit: 'exact' },
  spam: { code: 'spam_suspicious', fit: 'exact' },
};

/**
 * leadDetectionService `lead_intent` values. Not one of the three classifiers, but
 * pages/api/response/generate.ts feeds it to responsePolicyEngine as the intent
 * override, so it is a fourth producer of the same field and is mapped here too.
 */
export const LEAD_DETECTION_INTENTS = [
  'solution_exploration',
  'tool_search',
  'interest_expressed',
  'pricing_inquiry',
  'demo_request',
  'usage_inquiry',
  'trial_interest',
  'connection_request',
  'implementation_interest',
  'comparison_inquiry',
  'lead_interest',
  'product_inquiry',
  'price_inquiry',
  'trial_request',
] as const;
export type LeadDetectionIntent = (typeof LEAD_DETECTION_INTENTS)[number];

export const LEAD_INTENT_TO_CANONICAL: Readonly<Record<LeadDetectionIntent, LegacyMappingEntry>> = {
  solution_exploration: { code: 'enquiry', fit: 'approximate' },
  tool_search: { code: 'enquiry', fit: 'approximate' },
  interest_expressed: { code: 'positive_interest', fit: 'exact' },
  pricing_inquiry: { code: 'pricing', fit: 'exact' },
  demo_request: { code: 'meeting_request', fit: 'exact' },
  usage_inquiry: { code: 'information_request', fit: 'approximate' },
  trial_interest: { code: 'positive_interest', fit: 'approximate' },
  connection_request: { code: 'meeting_request', fit: 'approximate' },
  implementation_interest: { code: 'positive_interest', fit: 'approximate' },
  comparison_inquiry: { code: 'enquiry', fit: 'approximate' },
  lead_interest: { code: 'positive_interest', fit: 'exact' },
  product_inquiry: { code: 'enquiry', fit: 'exact' },
  price_inquiry: { code: 'pricing', fit: 'exact' },
  trial_request: { code: 'positive_interest', fit: 'approximate' },
};

export type LegacySource = 'triage_category' | 'intelligence_intent' | 'policy_intent' | 'lead_intent';

const TABLES: Readonly<Record<LegacySource, Readonly<Record<string, LegacyMappingEntry>>>> = {
  triage_category: TRIAGE_CATEGORY_TO_CANONICAL,
  intelligence_intent: INTELLIGENCE_INTENT_TO_CANONICAL,
  policy_intent: POLICY_INTENT_TO_CANONICAL,
  lead_intent: LEAD_INTENT_TO_CANONICAL,
};

const UNKNOWN: LegacyMappingEntry = { code: 'ambiguous', fit: 'none' };

/**
 * Map one legacy label. Unknown, empty or null labels map to `ambiguous` — never to
 * a governance class, whatever the label says.
 */
export function mapLegacyLabel(source: LegacySource, raw: string | null | undefined): LegacyMappingEntry {
  const key = (raw ?? '').toString().trim().toLowerCase();
  if (!key) return UNKNOWN;
  const table = TABLES[source];
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : UNKNOWN;
}
