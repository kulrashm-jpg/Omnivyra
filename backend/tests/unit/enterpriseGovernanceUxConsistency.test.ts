/**
 * Enterprise Governance — UX Consistency Validation (Phase 11).
 *
 * Validates that every operator-facing label, taxonomy, and naming
 * convention is sourced from the canonical taxonomy module and stays
 * in sync with the underlying state machine + escalation pipeline +
 * event bus enums.
 *
 * A failure here means the UX drifted: a state was added to the FSM
 * but no label exists, or vice versa.
 */

import {
  REVIEW_STATE_LABELS,
  REVIEW_STATE_DESCRIPTIONS,
  ESCALATION_LEVEL_LABELS,
  ESCALATION_PRIORITY_LABELS,
  ESCALATION_REASON_LABELS,
  EVENT_TYPE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  isLabelMapComplete,
  labelForReviewState,
  labelForEscalationReason,
} from '../../services/creator/enterpriseGovernanceUxTaxonomy';
import type { ReviewState } from '../../services/creator/creativeReviewStateMachine';
import type {
  EscalationLevel,
  EscalationPriority,
  EscalationReason,
} from '../../services/creator/creativeEscalationPipeline';
import type { EnterpriseGovernanceEventType } from '../../services/creator/enterpriseGovernanceEvents';

describe('UX: review state labels match the canonical state set', () => {
  const ALL_STATES: ReviewState[] = [
    'draft', 'generated', 'qa_review', 'governance_review', 'brand_review',
    'legal_review', 'approved', 'rejected', 'published', 'archived',
  ];

  test('every review state has a label', () => {
    for (const s of ALL_STATES) {
      expect(REVIEW_STATE_LABELS[s]).toBeTruthy();
      expect(typeof REVIEW_STATE_LABELS[s]).toBe('string');
    }
  });

  test('every review state has a description', () => {
    for (const s of ALL_STATES) {
      expect(REVIEW_STATE_DESCRIPTIONS[s]).toBeTruthy();
      expect(typeof REVIEW_STATE_DESCRIPTIONS[s]).toBe('string');
    }
  });

  test('label resolver returns canonical label', () => {
    expect(labelForReviewState('generated')).toBe('Generated');
    expect(labelForReviewState('qa_review')).toBe('QA Review');
    expect(labelForReviewState('governance_review')).toBe('Governance Review');
  });

  test('no label map regression — keys exactly match the FSM', () => {
    const labelKeys = new Set(Object.keys(REVIEW_STATE_LABELS));
    const fsmKeys = new Set(ALL_STATES);
    expect(labelKeys.size).toBe(fsmKeys.size);
    for (const k of fsmKeys) expect(labelKeys.has(k)).toBe(true);
  });
});

describe('UX: escalation taxonomy labels match the canonical sets', () => {
  const ALL_LEVELS: EscalationLevel[] = ['routine', 'high', 'critical', 'executive'];
  const ALL_PRIORITIES: EscalationPriority[] = ['p1', 'p2', 'p3', 'p4'];
  const ALL_REASONS: EscalationReason[] = [
    'severe_governance_violation', 'repeated_qa_failures', 'repeated_off_brand_output',
    'unsafe_realism_drift', 'repeated_retry_exhaustion', 'campaign_coherence_collapse',
    'legal_risk', 'executive_review', 'manual_escalation',
  ];

  test('every escalation level has a label', () => {
    for (const l of ALL_LEVELS) expect(ESCALATION_LEVEL_LABELS[l]).toBeTruthy();
  });
  test('every escalation priority has a label', () => {
    for (const p of ALL_PRIORITIES) expect(ESCALATION_PRIORITY_LABELS[p]).toBeTruthy();
  });
  test('every escalation reason has a label', () => {
    for (const r of ALL_REASONS) expect(ESCALATION_REASON_LABELS[r]).toBeTruthy();
  });
  test('reason label resolver works', () => {
    expect(labelForEscalationReason('severe_governance_violation')).toBe('Severe governance violation');
    expect(labelForEscalationReason('legal_risk')).toBe('Legal risk');
  });
});

describe('UX: event taxonomy labels match the canonical event set', () => {
  const CANONICAL_TYPES: EnterpriseGovernanceEventType[] = [
    'asset_generated', 'qa_failure', 'qa_passed', 'governance_intervention',
    'governance_passed', 'severe_governance_violation', 'escalation_created',
    'retry_exhausted', 'approval_required', 'approval_granted', 'approval_rejected',
    'publish_allowed', 'publish_blocked', 'published', 'campaign_locked',
    'campaign_unlocked', 'review_state_transition', 'autonomous_intervention',
    'review_record_established',
  ];

  test('every event type has a label', () => {
    for (const t of CANONICAL_TYPES) expect(EVENT_TYPE_LABELS[t]).toBeTruthy();
  });

  test('event label keys exactly match canonical type union', () => {
    const labelKeys = new Set(Object.keys(EVENT_TYPE_LABELS));
    const typeSet = new Set<string>(CANONICAL_TYPES);
    expect(labelKeys.size).toBe(typeSet.size);
    for (const k of typeSet) expect(labelKeys.has(k)).toBe(true);
  });
});

describe('UX: severity taxonomy is consistent across modules', () => {
  test('three-tier severity (info/warning/critical) has labels + ranks', () => {
    expect(SEVERITY_LABELS.info).toBeTruthy();
    expect(SEVERITY_LABELS.warning).toBeTruthy();
    expect(SEVERITY_LABELS.critical).toBeTruthy();
    expect(SEVERITY_RANK.critical > SEVERITY_RANK.warning).toBe(true);
    expect(SEVERITY_RANK.warning > SEVERITY_RANK.info).toBe(true);
  });
});

describe('UX: completeness helper detects missing labels', () => {
  test('isLabelMapComplete reports missing keys correctly', () => {
    const result = isLabelMapComplete(REVIEW_STATE_LABELS, { generated: 'Generated', published: 'Published' });
    expect(result.complete).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing).toContain('draft');
  });

  test('isLabelMapComplete reports complete when all keys present', () => {
    const result = isLabelMapComplete(REVIEW_STATE_LABELS, REVIEW_STATE_LABELS);
    expect(result.complete).toBe(true);
    expect(result.missing.length).toBe(0);
  });
});
