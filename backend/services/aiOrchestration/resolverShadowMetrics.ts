/**
 * resolverShadowMetrics.ts — in-memory shadow observation counters (AI-ORCH 2A-2.1).
 *
 * Process-local counters ONLY. No persistence, no monitoring integration, no I/O.
 * They exist so the shadow observation can be read from existing debug diagnostics
 * (a plain getter). Bounded (fixed set of counters + a small category map). Reading
 * or updating them never affects execution.
 */
import type { MismatchCategory, ParityResult, EquivalenceResult } from './resolverComparator';
import type { AdapterParityResult } from './legacyExecutionAdapter';
import type { ConfigurationParityResult } from './configurationParityGuard';
import type { OrchestrationMode } from './orchestrationMode';

export interface ResolverShadowMetrics {
  invocations: number;
  success: number;
  failure: number;
  parityMatch: number;
  parityMismatch: number;
  /** Count per mismatch category (only categories seen appear). */
  mismatchCategories: Record<string, number>;
  // ── Execution equivalence (AI-ORCH 2A-2.2) ──
  identical: number;
  semanticallyEquivalent: number;
  different: number;
  snapshotHashMatches: number;
  snapshotHashMismatches: number;
  normalizationDifferences: number;
  executionDifferences: number;
  /** Count per difference category across all observed diffs. */
  differenceCategories: Record<string, number>;
  // ── Legacy-config adapter round-trip (AI-ORCH 2A-2.3) ──
  adapterInvocations: number;
  adapterIdentical: number;
  adapterDifferent: number;
  /** Count per mapped field that diverged after round-trip. */
  adapterDifferences: Record<string, number>;
  // ── Dual execution validation (AI-ORCH 2A-3) ──
  dualExecutions: number;
  legacyExecutions: number;
  resolverExecutions: number;
  canaryExecutions: number;
  structuralParity: number;
  snapshotParity: number;
  fingerprintParity: number;
  configParityDifferent: number;
  rollbackEvents: number;
}

const state: ResolverShadowMetrics = {
  invocations: 0,
  success: 0,
  failure: 0,
  parityMatch: 0,
  parityMismatch: 0,
  mismatchCategories: {},
  identical: 0,
  semanticallyEquivalent: 0,
  different: 0,
  snapshotHashMatches: 0,
  snapshotHashMismatches: 0,
  normalizationDifferences: 0,
  executionDifferences: 0,
  differenceCategories: {},
  adapterInvocations: 0,
  adapterIdentical: 0,
  adapterDifferent: 0,
  adapterDifferences: {},
  dualExecutions: 0,
  legacyExecutions: 0,
  resolverExecutions: 0,
  canaryExecutions: 0,
  structuralParity: 0,
  snapshotParity: 0,
  fingerprintParity: 0,
  configParityDifferent: 0,
  rollbackEvents: 0,
};

/** Last-seen mode ordinal, to detect rollback (mode decreasing). */
let lastModeOrdinal: number | null = null;

/** The shadow runner actually ran (flag ON). */
export function recordInvocation(): void { state.invocations++; }

/** A shadow run completed without throwing. */
export function recordSuccess(): void { state.success++; }

/** A shadow run threw (swallowed; never affects execution). */
export function recordFailure(): void { state.failure++; }

/** Record the parity outcome + category of one shadow observation. */
export function recordParity(parity: ParityResult): void {
  if (parity.status === 'MATCH') state.parityMatch++;
  else state.parityMismatch++;
  const cat: MismatchCategory = parity.mismatchCategory;
  state.mismatchCategories[cat] = (state.mismatchCategories[cat] ?? 0) + 1;
}

/** Record an execution-equivalence outcome (AI-ORCH 2A-2.2). */
export function recordEquivalence(result: EquivalenceResult): void {
  if (result.level === 'IDENTICAL') state.identical++;
  else if (result.level === 'SEMANTICALLY_EQUIVALENT') state.semanticallyEquivalent++;
  else state.different++;
  if (result.snapshotHashMatch) state.snapshotHashMatches++;
  else state.snapshotHashMismatches++;
  state.normalizationDifferences += result.normalizationDifferenceCount;
  state.executionDifferences += result.executionDifferenceCount;
  for (const d of result.normalizedDiffs) {
    state.differenceCategories[d.category] = (state.differenceCategories[d.category] ?? 0) + 1;
  }
  for (const d of result.rawDiffs) {
    if (d.category === 'NORMALIZATION_DIFFERENCE') {
      state.differenceCategories[d.category] = (state.differenceCategories[d.category] ?? 0) + 1;
    }
  }
}

/** Record a legacy-config adapter round-trip outcome (AI-ORCH 2A-2.3). */
export function recordAdapterParity(result: AdapterParityResult): void {
  state.adapterInvocations++;
  if (result.parity === 'IDENTICAL') state.adapterIdentical++;
  else state.adapterDifferent++;
  for (const d of result.differences) {
    state.adapterDifferences[d.mappedField] = (state.adapterDifferences[d.mappedField] ?? 0) + 1;
  }
}

/**
 * Record a dual/canary execution-validation outcome (AI-ORCH 2A-3). `executes` is the
 * authority's execution source; `canary` marks a canary observation.
 */
export function recordDualExecution(
  result: ConfigurationParityResult,
  executes: 'legacy' | 'resolver',
  canary: boolean,
): void {
  state.dualExecutions++;
  if (executes === 'legacy') state.legacyExecutions++;
  else state.resolverExecutions++;
  if (canary) state.canaryExecutions++;
  if (result.structuralMatch) state.structuralParity++;
  if (result.snapshotHashMatch) state.snapshotParity++;
  if (result.fingerprintMatch) state.fingerprintParity++;
  if (result.parity === 'DIFFERENT') state.configParityDifferent++;
  for (const d of result.differences) {
    if (d.category !== 'NORMALIZATION_DIFFERENCE') {
      state.differenceCategories[d.category] = (state.differenceCategories[d.category] ?? 0) + 1;
    }
  }
}

/** Record the current mode; increments rollbackEvents when the mode DECREASES (2A-3). */
export function recordOrchestrationMode(mode: OrchestrationMode): void {
  const ordinals: Record<OrchestrationMode, number> = { off: 0, shadow: 1, dual: 2, canary: 3, full: 4 };
  const ord = ordinals[mode];
  if (lastModeOrdinal !== null && ord < lastModeOrdinal) state.rollbackEvents++;
  lastModeOrdinal = ord;
}

/** A frozen snapshot for debug diagnostics. */
export function getResolverShadowMetrics(): Readonly<ResolverShadowMetrics> {
  return Object.freeze({
    invocations: state.invocations,
    success: state.success,
    failure: state.failure,
    parityMatch: state.parityMatch,
    parityMismatch: state.parityMismatch,
    mismatchCategories: { ...state.mismatchCategories },
    identical: state.identical,
    semanticallyEquivalent: state.semanticallyEquivalent,
    different: state.different,
    snapshotHashMatches: state.snapshotHashMatches,
    snapshotHashMismatches: state.snapshotHashMismatches,
    normalizationDifferences: state.normalizationDifferences,
    executionDifferences: state.executionDifferences,
    differenceCategories: { ...state.differenceCategories },
    adapterInvocations: state.adapterInvocations,
    adapterIdentical: state.adapterIdentical,
    adapterDifferent: state.adapterDifferent,
    adapterDifferences: { ...state.adapterDifferences },
    dualExecutions: state.dualExecutions,
    legacyExecutions: state.legacyExecutions,
    resolverExecutions: state.resolverExecutions,
    canaryExecutions: state.canaryExecutions,
    structuralParity: state.structuralParity,
    snapshotParity: state.snapshotParity,
    fingerprintParity: state.fingerprintParity,
    configParityDifferent: state.configParityDifferent,
    rollbackEvents: state.rollbackEvents,
  });
}

/**
 * In-memory historical validation report (AI-ORCH 2A-2.2) — derived from the live
 * counters. NOT persisted. For existing debug diagnostics only.
 */
export interface EquivalenceValidationReport {
  requestsObserved: number;
  identical: number;
  semanticallyEquivalent: number;
  different: number;
  snapshotHashMatchRate: number | null;
  topDifferenceCategories: Array<{ category: string; count: number }>;
  // Adapter round-trip (AI-ORCH 2A-2.3)
  adapterInvocations: number;
  adapterIdentical: number;
  adapterDifferent: number;
  adapterParityRate: number | null;
  topAdapterDifferences: Array<{ field: string; count: number }>;
  // Dual execution validation (AI-ORCH 2A-3)
  dualExecutions: number;
  legacyExecutions: number;
  resolverExecutions: number;
  canaryExecutions: number;
  structuralParityRate: number | null;
  snapshotParityRate: number | null;
  fingerprintParityRate: number | null;
  rollbackEvents: number;
}

export function getEquivalenceValidationReport(): EquivalenceValidationReport {
  const observed = state.identical + state.semanticallyEquivalent + state.different;
  const totalHash = state.snapshotHashMatches + state.snapshotHashMismatches;
  const topDifferenceCategories = Object.entries(state.differenceCategories)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
  const topAdapterDifferences = Object.entries(state.adapterDifferences)
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count);
  return {
    requestsObserved: observed,
    identical: state.identical,
    semanticallyEquivalent: state.semanticallyEquivalent,
    different: state.different,
    snapshotHashMatchRate: totalHash === 0 ? null : state.snapshotHashMatches / totalHash,
    topDifferenceCategories,
    adapterInvocations: state.adapterInvocations,
    adapterIdentical: state.adapterIdentical,
    adapterDifferent: state.adapterDifferent,
    adapterParityRate: state.adapterInvocations === 0 ? null : state.adapterIdentical / state.adapterInvocations,
    topAdapterDifferences,
    dualExecutions: state.dualExecutions,
    legacyExecutions: state.legacyExecutions,
    resolverExecutions: state.resolverExecutions,
    canaryExecutions: state.canaryExecutions,
    structuralParityRate: state.dualExecutions === 0 ? null : state.structuralParity / state.dualExecutions,
    snapshotParityRate: state.dualExecutions === 0 ? null : state.snapshotParity / state.dualExecutions,
    fingerprintParityRate: state.dualExecutions === 0 ? null : state.fingerprintParity / state.dualExecutions,
    rollbackEvents: state.rollbackEvents,
  };
}

/** Test/diagnostic reset. */
export function resetResolverShadowMetrics(): void {
  state.invocations = 0;
  state.success = 0;
  state.failure = 0;
  state.parityMatch = 0;
  state.parityMismatch = 0;
  state.mismatchCategories = {};
  state.identical = 0;
  state.semanticallyEquivalent = 0;
  state.different = 0;
  state.snapshotHashMatches = 0;
  state.snapshotHashMismatches = 0;
  state.normalizationDifferences = 0;
  state.executionDifferences = 0;
  state.differenceCategories = {};
  state.adapterInvocations = 0;
  state.adapterIdentical = 0;
  state.adapterDifferent = 0;
  state.adapterDifferences = {};
  state.dualExecutions = 0;
  state.legacyExecutions = 0;
  state.resolverExecutions = 0;
  state.canaryExecutions = 0;
  state.structuralParity = 0;
  state.snapshotParity = 0;
  state.fingerprintParity = 0;
  state.configParityDifferent = 0;
  state.rollbackEvents = 0;
  lastModeOrdinal = null;
}
