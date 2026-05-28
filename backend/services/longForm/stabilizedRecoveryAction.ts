/**
 * stabilizedRecoveryAction.ts
 *
 * Phase 8.4 — Content-type-aware recovery decisions.
 *
 * The unified recovery graph already knows the content type. This module
 * turns the content-type stabilizer's preferred-action fields into the
 * primary policy for selecting next recovery actions. Layered ABOVE the
 * coordinator's per-failure heuristics: stabilizer says "for blogs,
 * always restore narrative on alignment failure"; the coordinator only
 * overrides when the stabilizer is silent.
 *
 * The output is a `RecoveryStepAction` (from
 * `plannedEngineRecoveryCoordinator`) plus an optional override note for
 * diagnostics.
 */

import { getContentTypeStabilizer, type ContentTypeStabilizer } from './contentTypeStabilizers';
import type { RecoveryStepAction } from './plannedEngineRecoveryCoordinator';
import type { LongFormGovernanceFailureReason } from './plannedEngineStabilityTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export interface StabilizedRecoveryDecision {
  recommendedAction: RecoveryStepAction | 'soften_claims' | 'compact_retry' | 'minimal_recovery';
  overrideOriginAction?: RecoveryStepAction | string;
  stabilizerApplied: boolean;
  stabilizerKey: string;
  abandonmentRecommended: boolean;
  reasoning: string;
}

export interface ResolveStabilizedRecoveryInput {
  contentType: string;
  failureCategories: LongFormGovernanceFailureReason[];
  /** Whether this is a timeout-dominated failure. */
  timeoutDominant?: boolean;
  /** Default action the coordinator already chose. We use this when the stabilizer is silent. */
  defaultAction?: RecoveryStepAction | 'soften_claims' | 'compact_retry' | 'minimal_recovery';
  /** Severity 0..100 — fed against the stabilizer's `abandonmentSeverityFloor`. */
  severity?: number;
  /** Section value 0..1 — low value sections abandon earlier. */
  sectionValue?: number;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

function pickAlignmentAction(stabilizer: ContentTypeStabilizer): RecoveryStepAction {
  // The stabilizer field names track companyContextBlock semantics. Map
  // them to coordinator RecoveryStepAction. All three legal stabilizer
  // values are already valid RecoveryStepActions.
  return stabilizer.recovery.alignmentFailureAction as RecoveryStepAction;
}

function pickFactualAction(stabilizer: ContentTypeStabilizer): RecoveryStepAction | 'soften_claims' {
  return stabilizer.recovery.factualFailureAction as RecoveryStepAction | 'soften_claims';
}

function pickTimeoutAction(stabilizer: ContentTypeStabilizer): 'compact_retry' | 'minimal_recovery' {
  return stabilizer.recovery.timeoutAction;
}

export function resolveStabilizedRecoveryAction(
  input: ResolveStabilizedRecoveryInput,
): StabilizedRecoveryDecision {
  const stabilizer = getContentTypeStabilizer(input.contentType);
  const reasoningParts: string[] = [];

  // ── Abandonment check ────────────────────────────────────────────────
  const severityFloor = stabilizer.recovery.abandonmentSeverityFloor;
  const severity = input.severity ?? 0;
  const sectionValue = input.sectionValue ?? 0.5;
  if (severity >= severityFloor && sectionValue < 0.4) {
    reasoningParts.push(
      `Severity ${severity} ≥ ${stabilizer.contentType} floor ${severityFloor} with low section value ${sectionValue.toFixed(2)} → abandon.`,
    );
    return {
      recommendedAction: 'soften_claims',
      stabilizerApplied: true,
      stabilizerKey: stabilizer.contentType,
      abandonmentRecommended: true,
      reasoning: reasoningParts.join(' '),
    };
  }

  // ── Timeout-dominant takes priority ──────────────────────────────────
  const isTimeout = input.timeoutDominant || input.failureCategories.includes('timeout');
  if (isTimeout) {
    const action = pickTimeoutAction(stabilizer);
    reasoningParts.push(`Timeout-dominant → ${stabilizer.contentType} stabilizer prefers ${action}.`);
    return {
      recommendedAction: action,
      overrideOriginAction: input.defaultAction,
      stabilizerApplied: true,
      stabilizerKey: stabilizer.contentType,
      abandonmentRecommended: false,
      reasoning: reasoningParts.join(' '),
    };
  }

  // ── Factual / grounded failures ─────────────────────────────────────
  if (input.failureCategories.includes('factual')) {
    const action = pickFactualAction(stabilizer);
    reasoningParts.push(`Factual failure → ${stabilizer.contentType} stabilizer prefers ${action}.`);
    return {
      recommendedAction: action,
      overrideOriginAction: input.defaultAction,
      stabilizerApplied: true,
      stabilizerKey: stabilizer.contentType,
      abandonmentRecommended: false,
      reasoning: reasoningParts.join(' '),
    };
  }

  // ── Alignment failures ──────────────────────────────────────────────
  if (input.failureCategories.includes('company_alignment')) {
    const action = pickAlignmentAction(stabilizer);
    reasoningParts.push(`Alignment failure → ${stabilizer.contentType} stabilizer prefers ${action}.`);
    return {
      recommendedAction: action,
      overrideOriginAction: input.defaultAction,
      stabilizerApplied: true,
      stabilizerKey: stabilizer.contentType,
      abandonmentRecommended: false,
      reasoning: reasoningParts.join(' '),
    };
  }

  // ── Default ─────────────────────────────────────────────────────────
  reasoningParts.push(`No stabilizer-specific preference for failures [${input.failureCategories.join(', ')}]; defer to default.`);
  return {
    recommendedAction: (input.defaultAction ?? 'compact_retry') as RecoveryStepAction | 'compact_retry',
    stabilizerApplied: false,
    stabilizerKey: stabilizer.contentType,
    abandonmentRecommended: false,
    reasoning: reasoningParts.join(' '),
  };
}

// ── Aggregate consumption counters ──────────────────────────────────────────
//
// Tracks how often the stabilizer ended up being the deciding factor vs
// how often the coordinator's default carried. Used by the
// ContentTypeStabilizerConsumptionReport.

interface ConsumptionBucket {
  applied: number;
  ignored: number;
  byContentType: Map<string, { applied: number; ignored: number }>;
}

const consumption: ConsumptionBucket = {
  applied: 0,
  ignored: 0,
  byContentType: new Map(),
};

export function recordStabilizedDecision(decision: StabilizedRecoveryDecision): void {
  const ct = decision.stabilizerKey;
  const bucket = consumption.byContentType.get(ct) ?? { applied: 0, ignored: 0 };
  if (decision.stabilizerApplied) {
    consumption.applied += 1;
    bucket.applied += 1;
  } else {
    consumption.ignored += 1;
    bucket.ignored += 1;
  }
  consumption.byContentType.set(ct, bucket);
}

export interface StabilizedRecoveryConsumptionReport {
  total_decisions: number;
  applied: number;
  ignored: number;
  recovery_application_rate: number;
  per_content_type: Array<{ content_type: string; applied: number; ignored: number; rate: number }>;
}

export function getStabilizedRecoveryConsumptionReport(): StabilizedRecoveryConsumptionReport {
  const total = consumption.applied + consumption.ignored;
  const perType = Array.from(consumption.byContentType.entries()).map(([ct, b]) => ({
    content_type: ct,
    applied: b.applied,
    ignored: b.ignored,
    rate: b.applied + b.ignored > 0 ? Number((b.applied / (b.applied + b.ignored)).toFixed(3)) : 0,
  }));
  return {
    total_decisions: total,
    applied: consumption.applied,
    ignored: consumption.ignored,
    recovery_application_rate: total > 0 ? Number((consumption.applied / total).toFixed(3)) : 0,
    per_content_type: perType,
  };
}

export function __resetStabilizedRecoveryConsumptionForTests(): void {
  consumption.applied = 0;
  consumption.ignored = 0;
  consumption.byContentType.clear();
}
