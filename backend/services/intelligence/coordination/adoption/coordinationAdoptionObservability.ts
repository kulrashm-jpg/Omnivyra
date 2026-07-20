/**
 * Coordination Adoption — observability (WS-2A, Zone A2).
 *
 * Platform ADOPTION metrics only (no business metrics) under a new, non-colliding
 * `ai.coordination.adoption.*` namespace. Fail-safe: every emitter is wrapped in
 * try/catch so observability can never affect the reply path.
 *
 * Metrics (Phase 5):
 *   ai.coordination.adoption.lookup_latency_ms   histogram — end-to-end shadow probe latency
 *   ai.coordination.adoption.duplicate_decision  counter   — duplicate/related/unique/not_evaluable
 *   ai.coordination.adoption.registry_hit        counter   — semantic root already registered? (hit=true/false)
 *   ai.coordination.adoption.missing_root        counter   — missing semantic root? (missing=true/false)
 *   ai.coordination.adoption.continuity_coverage counter   — prior communication events present? (covered=true/false)
 *   ai.coordination.adoption.degrade             counter   — shadow probe failed (fail-open)
 */
import { recordRawCounter, recordRawHistogram } from '../../../../observability';
import type { DuplicateIntentVerdict } from '../coordinationContracts';

export interface EngagementAdoptionSample {
  surface: string;
  latencyMs: number;
  rootPresent: boolean;
  priorEventCount: number;
  duplicate: DuplicateIntentVerdict;
}

export function recordEngagementAdoption(sample: EngagementAdoptionSample): void {
  try {
    recordRawHistogram('ai.coordination.adoption.lookup_latency_ms', sample.latencyMs, {
      surface: sample.surface,
    });
    recordRawCounter('ai.coordination.adoption.duplicate_decision', 1, {
      surface: sample.surface,
      decision: sample.duplicate.decision,
      basis: sample.duplicate.basis,
    });
    recordRawCounter('ai.coordination.adoption.registry_hit', 1, {
      surface: sample.surface,
      hit: sample.rootPresent ? 'true' : 'false',
    });
    recordRawCounter('ai.coordination.adoption.missing_root', 1, {
      surface: sample.surface,
      missing: sample.rootPresent ? 'false' : 'true',
    });
    recordRawCounter('ai.coordination.adoption.continuity_coverage', 1, {
      surface: sample.surface,
      covered: sample.priorEventCount > 0 ? 'true' : 'false',
    });
  } catch { /* observability is fail-safe */ }
}

export function recordCoordinationAdoptionDegrade(surface: string, reason: string): void {
  try {
    recordRawCounter('ai.coordination.adoption.degrade', 1, { surface, reason });
  } catch { /* observability is fail-safe */ }
}
