/**
 * RELEASE-R3D — Governance Consumer diagnostics & observability.
 *
 * Machine-readable diagnostics for every admission invocation, plus an
 * in-process rollup exposing adapter health. It reuses the existing platform
 * observability seams (HARDEN-001 registry via `recordRawCounter` /
 * `recordRawHistogram`) rather than inventing a new metrics path — so governance
 * consumer metrics appear on the same fail-safe registry as the rest of the app.
 *
 * Every counter/gauge here is fail-safe: a diagnostics error never affects the
 * adapter's decision.
 */
import { recordRawCounter, recordRawHistogram } from '../../observability';

export type InvocationOutcome =
  | 'bypassed'      // flag off or operation not designated — runtime not invoked
  | 'admitted'      // runtime returned Admitted
  | 'rejected'      // runtime returned Rejected/Deferred
  | 'shadowed'      // invoked in shadow mode (never blocks)
  | 'error';        // invocation failed (timeout / invoke / bad-output / incompatible)

/** One machine-readable diagnostic record for a single admission decision. */
export interface GovernanceDiagnostic {
  operation: string;
  mode: string;
  outcome: InvocationOutcome;
  decision?: 'Admitted' | 'Rejected' | 'Deferred';
  durationMs: number;
  runtimeVersion: string | null;
  compatible: boolean;
  errorCode?: string;
  attempts?: number;
}

interface Rollup {
  invocations: number;   // decisions that actually invoked the runtime
  bypassed: number;
  admitted: number;
  rejected: number;
  shadowed: number;
  errors: number;
  totalLatencyMs: number;
  lastRuntimeVersion: string | null;
  lastCompatible: boolean | null;
  lastOutcome: InvocationOutcome | null;
}

const rollup: Rollup = {
  invocations: 0,
  bypassed: 0,
  admitted: 0,
  rejected: 0,
  shadowed: 0,
  errors: 0,
  totalLatencyMs: 0,
  lastRuntimeVersion: null,
  lastCompatible: null,
  lastOutcome: null,
};

/** Record one diagnostic — updates the rollup and the fail-safe metrics registry. */
export function recordGovernanceDiagnostic(d: GovernanceDiagnostic): GovernanceDiagnostic {
  switch (d.outcome) {
    case 'bypassed': rollup.bypassed++; break;
    case 'admitted': rollup.admitted++; rollup.invocations++; break;
    case 'rejected': rollup.rejected++; rollup.invocations++; break;
    case 'shadowed': rollup.shadowed++; rollup.invocations++; break;
    case 'error':    rollup.errors++;   rollup.invocations++; break;
  }
  if (d.outcome !== 'bypassed') {
    rollup.totalLatencyMs += Math.max(0, d.durationMs);
    rollup.lastRuntimeVersion = d.runtimeVersion;
    rollup.lastCompatible = d.compatible;
  }
  rollup.lastOutcome = d.outcome;

  try {
    recordRawCounter('governance.consumer.invocation', 1, { outcome: d.outcome, mode: d.mode });
    if (d.outcome !== 'bypassed') {
      recordRawHistogram('governance.consumer.latency_ms', Math.max(0, d.durationMs), { mode: d.mode });
    }
    if (d.outcome === 'error' && d.errorCode) {
      recordRawCounter('governance.consumer.error', 1, { code: d.errorCode });
    }
  } catch {
    /* fail-safe: diagnostics never affect the decision */
  }
  return d;
}

/** Machine-readable observability snapshot (§5, §8). */
export interface GovernanceObservabilitySnapshot {
  consumerVersion: string;
  invocationCount: number;
  bypassCount: number;
  admittedCount: number;
  rejectedCount: number;
  shadowedCount: number;
  errorCount: number;
  /** successes / (successes + errors) over invocations that ran the runtime. */
  successRatio: number;
  averageLatencyMs: number;
  lastRuntimeVersion: string | null;
  lastCompatible: boolean | null;
  lastOutcome: InvocationOutcome | null;
  /** Coarse health signal derived from the recent error ratio. */
  health: 'healthy' | 'degraded' | 'unavailable' | 'idle';
}

export function getGovernanceObservabilitySnapshot(consumerVersion: string): GovernanceObservabilitySnapshot {
  const ran = rollup.invocations;
  const successes = rollup.admitted + rollup.rejected + rollup.shadowed; // ran without transport error
  const successRatio = ran === 0 ? 1 : successes / ran;
  const averageLatencyMs = ran === 0 ? 0 : rollup.totalLatencyMs / ran;
  let health: GovernanceObservabilitySnapshot['health'];
  if (ran === 0) health = 'idle';
  else if (successRatio >= 0.99) health = 'healthy';
  else if (successRatio >= 0.5) health = 'degraded';
  else health = 'unavailable';
  return {
    consumerVersion,
    invocationCount: ran,
    bypassCount: rollup.bypassed,
    admittedCount: rollup.admitted,
    rejectedCount: rollup.rejected,
    shadowedCount: rollup.shadowed,
    errorCount: rollup.errors,
    successRatio,
    averageLatencyMs,
    lastRuntimeVersion: rollup.lastRuntimeVersion,
    lastCompatible: rollup.lastCompatible,
    lastOutcome: rollup.lastOutcome,
    health,
  };
}

/** Reset the in-process rollup (tests / diagnostics only). */
export function resetGovernanceDiagnostics(): void {
  Object.assign(rollup, {
    invocations: 0, bypassed: 0, admitted: 0, rejected: 0, shadowed: 0, errors: 0,
    totalLatencyMs: 0, lastRuntimeVersion: null, lastCompatible: null, lastOutcome: null,
  });
}
