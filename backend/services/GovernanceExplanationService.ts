/**
 * Governance Explanation Normalization — UI-ready payload. Stage 10 Phase 4.
 * Pure transformation. No business logic. No constraint evaluation.
 */

import type { DurationEvaluationResult } from '../types/CampaignDuration';

export interface NormalizedGovernanceDecision {
  blocked: boolean;
  primaryReason: string | null;
  explanation: string;
  recommendedAction: string | null;
}

/**
 * Standardize DurationEvaluationResult into UI-ready explanation payload.
 */
export function normalizeGovernanceDecision(
  result: DurationEvaluationResult
): NormalizedGovernanceDecision {
  if (result.status === 'REJECTED') {
    const primary = result.blocking_constraints[0]?.name ?? result.limiting_constraints[0]?.name ?? null;
    const explanation =
      result.blocking_constraints[0]?.reasoning ??
      result.limiting_constraints[0]?.reasoning ??
      'Request rejected. No viable duration under current constraints.';
    const recommendedAction = result.tradeOffOptions?.[0]?.type ?? null;
    return {
      blocked: true,
      primaryReason: primary,
      explanation,
      recommendedAction,
    };
  }

  if (result.status === 'NEGOTIATE') {
    const primary = result.limiting_constraints[0]?.name ?? null;
    const explanation =
      result.limiting_constraints[0]?.reasoning ??
      'Request exceeds available capacity. Adjustment required.';
    const recommendedAction = result.tradeOffOptions?.[0]?.type ?? null;
    return {
      blocked: false,
      primaryReason: primary,
      explanation,
      recommendedAction,
    };
  }

  return {
    blocked: false,
    primaryReason: null,
    explanation: 'Approved under current governance rules.',
    recommendedAction: null,
  };
}

export type GovernanceEventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

const CRITICAL_EVENTS = new Set([
  'DURATION_REJECTED',
  'CONTENT_COLLISION_DETECTED',
  'EXECUTION_WINDOW_FROZEN',
  'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
]);

const WARNING_EVENTS = new Set([
  'DURATION_NEGOTIATE',
  'CONTENT_CAPACITY_LIMITED',
  'SHIFT_START_DATE_SUGGESTED',
  'SCHEDULER_LOCK_BLOCKED',
]);

/**
 * Classify governance event severity for UI display. Classification only — no logic changes.
 */
export function classifyGovernanceEventSeverity(eventType: string): GovernanceEventSeverity {
  const t = String(eventType ?? '').toUpperCase().trim();
  if (CRITICAL_EVENTS.has(t)) return 'CRITICAL';
  if (WARNING_EVENTS.has(t)) return 'WARNING';
  return 'INFO';
}
