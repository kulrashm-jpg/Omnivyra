/**
 * Phase 6 — Bounded source-health computation.
 *
 * Deterministic. Reads listening_executions over a rolling window and
 * derives one of four states:
 *   • healthy     — failure rate < 25%, partial rate < 25%, mod block < 40%
 *   • degraded    — partial rate ≥ 25% OR moderation block rate ≥ 40%
 *   • unstable    — failure rate ≥ 25% OR rate-limit pauses ≥ 25% of runs
 *   • silenced    — no executions in the last 30 days
 *
 * The service writes one source_health_states row per evaluation so the
 * trend can be inspected. NEVER disables a source. NEVER triggers failover.
 * NEVER pauses orchestration. The verdict is advisory.
 */

import { ownedDbTable } from '../db/writeOwner';
import type { SourceHealthRecord, SourceHealthState } from '../types/sourceHealth';
import { SOURCE_HEALTH_THRESHOLDS } from '../types/sourceHealth';

export type ComputeSourceHealthInput = {
  organizationId: string;
  listeningSourceId: string;
  windowHours?: number;
};

export type ComputedSourceHealth = {
  health_state: SourceHealthState;
  rationale: string;
  inputs: {
    executions: number;
    completed: number;
    partial: number;
    failed: number;
    rate_limit_pauses_total: number;
    moderation_blocks: number;
    signals_total: number;
    window_hours: number;
  };
};

export async function computeSourceHealth(
  input: ComputeSourceHealthInput,
): Promise<ComputedSourceHealth> {
  const windowHours = input.windowHours ?? 24 * 30;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data } = await ownedDbTable('listening_executions')
    .select('execution_status, ingestion_stats, signal_stats')
    .eq('organization_id', input.organizationId)
    .eq('listening_source_id', input.listeningSourceId)
    .gt('created_at', since);
  const rows = (data ?? []) as Array<{
    execution_status: string;
    ingestion_stats: Record<string, number> | null;
    signal_stats: Record<string, number> | null;
  }>;

  let completed = 0;
  let partial = 0;
  let failed = 0;
  let rateLimitPausesTotal = 0;
  let moderationBlocks = 0;
  let signalsTotal = 0;
  for (const r of rows) {
    if (r.execution_status === 'completed') completed += 1;
    if (r.execution_status === 'partial') partial += 1;
    if (r.execution_status === 'failed') failed += 1;
    rateLimitPausesTotal += Number(r.ingestion_stats?.rate_limit_pauses ?? 0);
    moderationBlocks += Number(r.signal_stats?.signals_moderation_blocked ?? 0);
    signalsTotal += Number(r.signal_stats?.signals_persisted ?? 0)
      + Number(r.signal_stats?.signals_moderation_blocked ?? 0)
      + Number(r.signal_stats?.signals_deduplicated ?? 0);
  }
  const executions = rows.length;

  let state: SourceHealthState = 'healthy';
  let rationale = 'No issues detected in the rolling window.';

  if (executions === 0) {
    const silenceDays = Math.round(windowHours / 24);
    if (silenceDays >= SOURCE_HEALTH_THRESHOLDS.silenced_zero_executions_days) {
      state = 'silenced';
      rationale = `No executions in the last ${silenceDays} day(s).`;
    } else {
      state = 'healthy';
      rationale = `No executions yet within the window — not enough data.`;
    }
  } else {
    const failureRate = failed / executions;
    const partialRate = partial / executions;
    const rlRate = rateLimitPausesTotal / executions;
    const modBlockRate = signalsTotal > 0 ? moderationBlocks / signalsTotal : 0;

    if (failureRate >= SOURCE_HEALTH_THRESHOLDS.unhealthy_failure_rate) {
      state = 'unstable';
      rationale = `Failure rate ${(failureRate * 100).toFixed(0)}% over ${executions} run(s).`;
    } else if (
      failureRate >= SOURCE_HEALTH_THRESHOLDS.unstable_failure_rate
      || rlRate >= SOURCE_HEALTH_THRESHOLDS.unstable_rate_limit_rate
    ) {
      state = 'unstable';
      rationale = `Elevated failure (${(failureRate * 100).toFixed(0)}%) or rate-limit (${rlRate.toFixed(2)}/run) signals.`;
    } else if (
      partialRate >= SOURCE_HEALTH_THRESHOLDS.degraded_partial_rate
      || modBlockRate >= SOURCE_HEALTH_THRESHOLDS.degraded_moderation_rate
    ) {
      state = 'degraded';
      rationale = `Partial-run rate ${(partialRate * 100).toFixed(0)}% / moderation block rate ${(modBlockRate * 100).toFixed(0)}%.`;
    } else {
      state = 'healthy';
      rationale = `Failure ${(failureRate * 100).toFixed(0)}%, partial ${(partialRate * 100).toFixed(0)}%, mod block ${(modBlockRate * 100).toFixed(0)}%.`;
    }
  }

  return {
    health_state: state,
    rationale,
    inputs: {
      executions,
      completed,
      partial,
      failed,
      rate_limit_pauses_total: rateLimitPausesTotal,
      moderation_blocks: moderationBlocks,
      signals_total: signalsTotal,
      window_hours: windowHours,
    },
  };
}

export async function recordSourceHealth(
  input: ComputeSourceHealthInput,
): Promise<SourceHealthRecord | null> {
  const computed = await computeSourceHealth(input);
  const { data, error } = await ownedDbTable('source_health_states')
    .insert({
      organization_id: input.organizationId,
      listening_source_id: input.listeningSourceId,
      health_state: computed.health_state,
      rationale: computed.rationale,
      inputs: computed.inputs,
    })
    .select('*')
    .single();
  if (error || !data) {
    console.warn('[sourceHealth] record failed:', error?.message);
    return null;
  }
  return data as SourceHealthRecord;
}

export async function getLatestSourceHealth(
  organizationId: string,
  listeningSourceId: string,
): Promise<SourceHealthRecord | null> {
  const { data, error } = await ownedDbTable('source_health_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('listening_source_id', listeningSourceId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`source_health_get_failed:${error.message}`);
  return (data as SourceHealthRecord | null) ?? null;
}

export async function listLatestSourceHealth(
  organizationId: string,
): Promise<SourceHealthRecord[]> {
  // Read all recent rows, then keep the latest per source.
  const { data, error } = await ownedDbTable('source_health_states')
    .select('*')
    .eq('organization_id', organizationId)
    .order('computed_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`source_health_list_failed:${error.message}`);
  const rows = (data as SourceHealthRecord[]) ?? [];
  const seen = new Set<string>();
  const latest: SourceHealthRecord[] = [];
  for (const r of rows) {
    if (seen.has(r.listening_source_id)) continue;
    seen.add(r.listening_source_id);
    latest.push(r);
  }
  return latest;
}
