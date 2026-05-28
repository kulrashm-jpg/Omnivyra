/**
 * Enterprise Governance — Canonical UX Taxonomy (Phase 11).
 *
 * Single-source-of-truth for operator-facing labels across:
 *   - review states
 *   - approval actions
 *   - escalation reasons / levels / priorities
 *   - severity tiers
 *   - alert rules
 *
 * Existing surfaces (writer / thread / creator / campaign / governance
 * admin / analytics / executive) MUST resolve their UI labels through
 * this module to prevent terminology drift between flows.
 *
 * Pure constants + lookup helpers. No state, no side effects.
 */

import type { ReviewState } from './creativeReviewStateMachine';
import type {
  EscalationLevel,
  EscalationPriority,
  EscalationReason,
} from './creativeEscalationPipeline';
import type { EnterpriseGovernanceEventType } from './enterpriseGovernanceEvents';

/* ── State labels ──────────────────────────────────────────────────── */

export const REVIEW_STATE_LABELS: Readonly<Record<ReviewState, string>> = {
  draft: 'Draft',
  generated: 'Generated',
  qa_review: 'QA Review',
  governance_review: 'Governance Review',
  brand_review: 'Brand Review',
  legal_review: 'Legal Review',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
  archived: 'Archived',
};

export const REVIEW_STATE_DESCRIPTIONS: Readonly<Record<ReviewState, string>> = {
  draft: 'Asset is being authored; not yet generated',
  generated: 'Asset rendered; awaiting QA',
  qa_review: 'In automated + human QA review',
  governance_review: 'In governance + compliance review',
  brand_review: 'In brand-alignment review',
  legal_review: 'In legal-risk review',
  approved: 'Approved for publication',
  rejected: 'Rejected — may be revised to draft',
  published: 'Live; terminal state',
  archived: 'Archived; terminal state',
};

export function labelForReviewState(state: ReviewState): string {
  return REVIEW_STATE_LABELS[state] ?? state;
}

/* ── Escalation labels ─────────────────────────────────────────────── */

export const ESCALATION_LEVEL_LABELS: Readonly<Record<EscalationLevel, string>> = {
  routine: 'Routine',
  high: 'High',
  critical: 'Critical',
  executive: 'Executive',
};

export const ESCALATION_PRIORITY_LABELS: Readonly<Record<EscalationPriority, string>> = {
  p1: 'P1 (urgent)',
  p2: 'P2 (high)',
  p3: 'P3 (medium)',
  p4: 'P4 (low)',
};

export const ESCALATION_REASON_LABELS: Readonly<Record<EscalationReason, string>> = {
  severe_governance_violation: 'Severe governance violation',
  repeated_qa_failures: 'Repeated QA failures',
  repeated_off_brand_output: 'Repeated off-brand output',
  unsafe_realism_drift: 'Unsafe realism drift',
  repeated_retry_exhaustion: 'Repeated retry exhaustion',
  campaign_coherence_collapse: 'Campaign coherence collapse',
  legal_risk: 'Legal risk',
  executive_review: 'Executive review',
  manual_escalation: 'Manual escalation',
};

export function labelForEscalationReason(reason: EscalationReason): string {
  return ESCALATION_REASON_LABELS[reason] ?? reason;
}

/* ── Event labels ──────────────────────────────────────────────────── */

export const EVENT_TYPE_LABELS: Readonly<Record<EnterpriseGovernanceEventType, string>> = {
  asset_generated: 'Asset generated',
  qa_failure: 'QA failure',
  qa_passed: 'QA passed',
  governance_intervention: 'Governance intervention',
  governance_passed: 'Governance passed',
  severe_governance_violation: 'Severe governance violation',
  escalation_created: 'Escalation created',
  retry_exhausted: 'Retry exhausted',
  approval_required: 'Approval required',
  approval_granted: 'Approval granted',
  approval_rejected: 'Approval rejected',
  publish_allowed: 'Publish allowed',
  publish_blocked: 'Publish blocked',
  published: 'Published',
  campaign_locked: 'Campaign locked',
  campaign_unlocked: 'Campaign unlocked',
  review_state_transition: 'Review state changed',
  autonomous_intervention: 'Autonomous intervention',
  review_record_established: 'Review record established',
};

/* ── Severity ──────────────────────────────────────────────────────── */

export const SEVERITY_LABELS = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
} as const;

export const SEVERITY_RANK = {
  info: 1,
  warning: 2,
  critical: 3,
} as const;

/* ── Cross-flow consistency check ──────────────────────────────────── */

/**
 * Returns true when the provided label set covers all canonical keys
 * for the given taxonomy. Used by the UX consistency test to ensure
 * downstream surfaces don't omit a label.
 */
export function isLabelMapComplete<K extends string>(
  canonical: Readonly<Record<K, string>>,
  candidate: Partial<Record<K, string>>,
): { complete: boolean; missing: K[] } {
  const missing: K[] = [];
  for (const key of Object.keys(canonical) as K[]) {
    if (!candidate[key] || typeof candidate[key] !== 'string') missing.push(key);
  }
  return { complete: missing.length === 0, missing };
}
