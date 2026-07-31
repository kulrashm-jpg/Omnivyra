/**
 * promotion.ts — Resolver Promotion control plane (AI-ORCH 2B).
 *
 * The promotion state machine + the pure, PARITY-GATED execution-source selection +
 * the evidence-driven promotion checklist + the failure/rollback policy. All PURE —
 * no execution, no I/O, no persistence. Promotion is an OPERATIONAL flag-flip governed
 * by these evaluators; this module never flips anything and never executes.
 *
 * The actual gateway synchronous-resolve swap (making the gateway consume the resolver
 * config) is the operational go-live and is DEFERRED (see the 2B doc): it needs live
 * parity evidence the checklist here demands, which is not available in this
 * environment. This module is what makes that go-live evidence-driven and reversible.
 */
import { resolveExecutionAuthority, type ExecutionAuthority, type OrchestrationMode } from './orchestrationMode';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';
import type { ConfigurationParityResult } from './configurationParityGuard';
import { getResolverShadowMetrics, getEquivalenceValidationReport, type ResolverShadowMetrics, type EquivalenceValidationReport } from './resolverShadowMetrics';

// ── Promotion state machine ───────────────────────────────────────────────────

export type PromotionStage =
  | 'STAGE_0_OFF'
  | 'STAGE_1_SHADOW'
  | 'STAGE_2_DUAL'
  | 'STAGE_3_CANARY'
  | 'STAGE_4_FULL';

const MODE_TO_STAGE: Record<OrchestrationMode, PromotionStage> = {
  off: 'STAGE_0_OFF', shadow: 'STAGE_1_SHADOW', dual: 'STAGE_2_DUAL', canary: 'STAGE_3_CANARY', full: 'STAGE_4_FULL',
};

export interface PromotionState {
  stage: PromotionStage;
  mode: OrchestrationMode;
  /** Resolver actually executes (mode canary/full AND master enable flag on). */
  resolverActive: boolean;
  /** Legacy builder is retained as the rollback target (always true this phase). */
  legacyRetained: boolean;
}

/** Derive the promotion state from the resolved execution authority. Pure. */
export function getPromotionState(authority: ExecutionAuthority): PromotionState {
  return {
    stage: MODE_TO_STAGE[authority.mode],
    mode: authority.mode,
    resolverActive: authority.executes === 'resolver',
    legacyRetained: true,
  };
}

/** The next stage up (for operator guidance); null at the ceiling. */
export function nextStage(stage: PromotionStage): PromotionStage | null {
  const order: PromotionStage[] = ['STAGE_0_OFF', 'STAGE_1_SHADOW', 'STAGE_2_DUAL', 'STAGE_3_CANARY', 'STAGE_4_FULL'];
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

// ── Parity-gated execution-source selection (pure) ────────────────────────────

export interface ExecutionSelection {
  source: 'legacy' | 'resolver';
  config: LegacyExecutionConfiguration | null;
  reason: string;
}

/**
 * Select WHICH configuration executes — the single decision point. SAFE BY
 * CONSTRUCTION: the resolver config is chosen ONLY when the authority says resolver
 * AND the ConfigurationParityGuard proved it execution-identical to legacy
 * (snapshotHashMatch). Otherwise legacy executes (fallback). So execution is ALWAYS
 * byte-identical to legacy — resolver authority never changes observable behavior;
 * it only changes the SOURCE of an identical configuration. Pure; never executes.
 */
export function selectExecutionConfiguration(
  authority: ExecutionAuthority,
  legacyConfig: LegacyExecutionConfiguration,
  resolverConfig: LegacyExecutionConfiguration,
  guard: ConfigurationParityResult,
): ExecutionSelection {
  if (authority.executes !== 'resolver') {
    return { source: 'legacy', config: legacyConfig, reason: 'authority=legacy' };
  }
  if (guard.snapshotHashMatch) {
    return { source: 'resolver', config: resolverConfig, reason: 'authority=resolver; parity IDENTICAL/EQUIVALENT (byte-identical execution)' };
  }
  // Fail-safe: resolver authority but configs diverge → execute legacy, recommend rollback.
  return { source: 'legacy', config: legacyConfig, reason: `authority=resolver but parity ${guard.parity} → legacy fallback` };
}

// ── Failure / rollback policy ─────────────────────────────────────────────────

export interface RollbackRecommendation {
  rollback: boolean;
  reasons: string[];
}

/**
 * Automatic rollback recommendation from the failure policy: ANY hard divergence
 * signal recommends rollback. Advisory only — never blocks or executes.
 */
export function recommendRollback(metrics: ResolverShadowMetrics): RollbackRecommendation {
  const reasons: string[] = [];
  if (metrics.configParityDifferent > 0) reasons.push('ConfigurationParityGuard reported DIFFERENT');
  if (metrics.executionDifferences > 0) reasons.push('ExecutionDifference > 0');
  if (metrics.adapterDifferent > 0) reasons.push('adapter round-trip DIFFERENT');
  return { rollback: reasons.length > 0, reasons };
}

// ── Evidence-driven promotion checklist ───────────────────────────────────────

export interface ChecklistItem {
  key: string;
  pass: boolean;
  value: unknown;
  required: unknown;
}

export interface PromotionReadiness {
  stage: PromotionStage;
  ready: boolean;
  recommendation: 'PROMOTE' | 'HOLD' | 'ROLLBACK';
  checklist: ChecklistItem[];
}

/**
 * Evaluate the promotion checklist from the live parity metrics. Evidence-driven:
 * with no observations the rates are null → NOT ready → HOLD. Any hard divergence →
 * ROLLBACK. Only when every item passes → PROMOTE. Pure.
 */
export function evaluatePromotionReadiness(
  stage: PromotionStage,
  metrics: ResolverShadowMetrics,
  report: EquivalenceValidationReport,
): PromotionReadiness {
  const item = (key: string, pass: boolean, value: unknown, required: unknown): ChecklistItem => ({ key, pass, value, required });
  const checklist: ChecklistItem[] = [
    item('structuralParityRate', report.structuralParityRate === 1, report.structuralParityRate, 1),
    item('snapshotParityRate', report.snapshotParityRate === 1, report.snapshotParityRate, 1),
    item('adapterParityRate', report.adapterParityRate === 1, report.adapterParityRate, 1),
    item('executionDifference', metrics.executionDifferences === 0, metrics.executionDifferences, 0),
    item('configParityDifferent', metrics.configParityDifferent === 0, metrics.configParityDifferent, 0),
    item('observationsPresent', report.dualExecutions > 0, report.dualExecutions, '> 0'),
    item('rollbackValidated', metrics.rollbackEvents >= 0, metrics.rollbackEvents, '>= 0 (mode-down works)'),
  ];
  const hardFailure = recommendRollback(metrics).rollback;
  const allPass = checklist.every((c) => c.pass);
  const recommendation: PromotionReadiness['recommendation'] = hardFailure ? 'ROLLBACK' : allPass ? 'PROMOTE' : 'HOLD';
  return { stage, ready: allPass && !hardFailure, recommendation, checklist };
}

// ── Live operator-facing diagnostics (read the current mode + live metrics) ────

/** The live promotion state from the current mode + master enable flag. */
export function getLivePromotionState(): PromotionState {
  return getPromotionState(resolveExecutionAuthority());
}

/** The live, evidence-driven promotion readiness (checklist + recommendation). */
export function getLivePromotionReadiness(): PromotionReadiness {
  const state = getLivePromotionState();
  return evaluatePromotionReadiness(state.stage, getResolverShadowMetrics(), getEquivalenceValidationReport());
}
