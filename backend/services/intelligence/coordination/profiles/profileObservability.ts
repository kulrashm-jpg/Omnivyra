/**
 * Query Profiles — observability (WS-2D Phase 10). Fail-safe; new namespace
 * `ai.coordination.queryprofile.*` (Shared-Contract + other coordination metric
 * names untouched).
 */
import { recordRawCounter, recordRawHistogram } from '../../../../observability';
import type { ProfileType } from './profileModels';

export function recordProfileExecution(profileType: ProfileType, resultCount: number, latencyMs: number): void {
  try {
    recordRawCounter('ai.coordination.queryprofile.execution', 1, { profile_type: profileType });
    recordRawHistogram('ai.coordination.queryprofile.result_count', resultCount, { profile_type: profileType });
    recordRawHistogram('ai.coordination.queryprofile.latency_ms', latencyMs, { profile_type: profileType });
  } catch { /* observability is fail-safe */ }
}

export function recordProfileDegrade(profileType: ProfileType, reason: string): void {
  try {
    recordRawCounter('ai.coordination.queryprofile.degrade', 1, { profile_type: profileType, reason });
  } catch { /* observability is fail-safe */ }
}
