/**
 * Phase 6 — Execution observability.
 *
 * Writer + reader for `execution_observability_records`. Each trace row is
 * an explicit event: stage name (e.g. 'fetch_signals', 'moderation_block',
 * 'opportunity_persisted'), kind (execution / projection / moderation /
 * rate_limit / connector_health / source_health), status, and arbitrary
 * payload. Bounded retention is up to the caller — Phase 6 ships an
 * operator-callable purge.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  ExecutionObservabilityRecord,
  TraceKind,
  TraceStatus,
} from '../types/executionObservability';

export type RecordTraceInput = {
  organizationId: string;
  listeningExecutionId?: string | null;
  kind: TraceKind;
  stage: string;
  status?: TraceStatus;
  durationMs?: number | null;
  payload?: Record<string, unknown>;
};

export async function recordTrace(input: RecordTraceInput): Promise<ExecutionObservabilityRecord | null> {
  try {
    const { data, error } = await ownedDbTable('execution_observability_records')
      .insert({
        organization_id: input.organizationId,
        listening_execution_id: input.listeningExecutionId ?? null,
        trace_kind: input.kind,
        stage: input.stage.slice(0, 64),
        status: input.status ?? 'ok',
        duration_ms: input.durationMs ?? null,
        payload: input.payload ?? {},
      })
      .select('*')
      .single();
    if (error) {
      console.warn('[observability] insert failed:', error.message);
      return null;
    }
    return (data as ExecutionObservabilityRecord) ?? null;
  } catch (err: any) {
    console.warn('[observability] insert threw:', err?.message);
    return null;
  }
}

export async function listTracesForExecution(
  organizationId: string,
  listeningExecutionId: string,
): Promise<ExecutionObservabilityRecord[]> {
  const { data, error } = await ownedDbTable('execution_observability_records')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('listening_execution_id', listeningExecutionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`trace_list_failed:${error.message}`);
  return (data as ExecutionObservabilityRecord[]) ?? [];
}

export async function listRecentTraces(
  organizationId: string,
  options?: { kind?: TraceKind; status?: TraceStatus; limit?: number },
): Promise<ExecutionObservabilityRecord[]> {
  let q = ownedDbTable('execution_observability_records')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.kind) q = q.eq('trace_kind', options.kind);
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`trace_list_recent_failed:${error.message}`);
  return (data as ExecutionObservabilityRecord[]) ?? [];
}
