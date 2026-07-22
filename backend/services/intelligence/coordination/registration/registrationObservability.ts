/**
 * Canonical Registration — observability (WS-2B, hardened WS-2B-validate).
 *
 * Fail-safe; new namespace `ai.coordination.registration.*` (Shared-Contract
 * metric names untouched). The `register` counter carries a single `outcome`
 * dimension so one series answers every operational question:
 *
 *   outcome ∈ { created, replayed, skipped, error }
 *   • registration success rate   = (created+replayed+skipped) / all
 *   • replay/duplicate suppression = replayed / (created+replayed)
 *   • error rate                   = error / all
 *   latency_ms histogram           → latency distribution (writes only)
 *   lifecycle_advance counter      → progression (from_state → to_state, changed, reason)
 */
import { recordRawCounter, recordRawHistogram } from '../../../../observability';
import type { CommunicationLifecycleState } from './registrationContracts';

export type RegistrationOutcomeLabel = 'created' | 'replayed' | 'skipped' | 'error';

export function recordRegistration(params: {
  outcome: RegistrationOutcomeLabel;
  rootEnsured: boolean;
  sourceModule: string;
  artifactType?: string;
  latencyMs: number;
}): void {
  try {
    recordRawCounter('ai.coordination.registration.register', 1, {
      outcome: params.outcome,
      root_ensured: params.rootEnsured ? 'true' : 'false',
      source_module: params.sourceModule,
      artifact_type: params.artifactType ?? 'none',
    });
    // Latency only for real writes (created/replayed) — skipped/error have no write cost.
    if (params.outcome === 'created' || params.outcome === 'replayed') {
      recordRawHistogram('ai.coordination.registration.latency_ms', params.latencyMs, {
        source_module: params.sourceModule,
      });
    }
  } catch { /* observability is fail-safe */ }
}

export function recordLifecycleAdvance(params: {
  changed: boolean;
  toState: CommunicationLifecycleState;
  fromState: string;
  reason: string;
}): void {
  try {
    recordRawCounter('ai.coordination.registration.lifecycle_advance', 1, {
      changed: params.changed ? 'true' : 'false',
      from_state: params.fromState,
      to_state: params.toState,
      reason: params.reason,
    });
  } catch { /* observability is fail-safe */ }
}

export function recordRegistrationDegrade(op: string, reason: string): void {
  try {
    recordRawCounter('ai.coordination.registration.degrade', 1, { op, reason });
  } catch { /* observability is fail-safe */ }
}
