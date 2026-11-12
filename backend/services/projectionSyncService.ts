/**
 * Phase 6 — Projection synchronisation state.
 *
 * Per-org cursor + retry book-keeping for the projections produced by
 * Phase 4 (opportunity feed, clusters) and Phase 5 (graph, alerts, plus
 * Phase 6 lifecycle). Replay is operator-triggered — there is NO autonomous
 * replay loop. The dead-letter readiness signal is `pending_retry_count`
 * reaching `MAX_PROJECTION_RETRIES`, at which point a future operator-side
 * DLQ producer can fire (Phase 6 doesn't auto-produce DLQ events).
 */

import { tenantTable, type TenantContext } from '../db/tenantTable';
import {
  MAX_PROJECTION_RETRIES,
  PROJECTION_PAYLOAD_VERSION,
  type ProjectionKind,
  type ProjectionSyncState,
} from '../types/projectionSync';

async function ensureSyncRow(
  tenant: TenantContext,
  projectionKind: ProjectionKind,
): Promise<ProjectionSyncState> {
  const { data: existing } = await tenantTable('projection_sync_state', tenant)
    .select('*')
    .eq('projection_kind', projectionKind)
    .maybeSingle();
  if (existing) return existing as ProjectionSyncState;
  // organization_id is stamped by the tenant seam.
  const { data, error } = await tenantTable('projection_sync_state', tenant)
    .insert({
      projection_kind: projectionKind,
      payload_version: PROJECTION_PAYLOAD_VERSION,
    })
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      const { data: raced } = await tenantTable('projection_sync_state', tenant)
        .select('*')
        .eq('projection_kind', projectionKind)
        .maybeSingle();
      if (raced) return raced as ProjectionSyncState;
    }
    throw new Error(`projection_sync_ensure_failed:${error?.message ?? 'unknown'}`);
  }
  return data as ProjectionSyncState;
}

/**
 * Mark a projection as synced up to `cursor`. Idempotent — the cursor only
 * advances monotonically.
 */
export async function advanceProjectionCursor(args: {
  tenant: TenantContext;
  projectionKind: ProjectionKind;
  cursor: string;
}): Promise<ProjectionSyncState> {
  const row = await ensureSyncRow(args.tenant, args.projectionKind);
  // Refuse cursors that move backwards.
  if (row.cursor_position && args.cursor < row.cursor_position) {
    return row;
  }
  const { data, error } = await tenantTable('projection_sync_state', args.tenant)
    .update({
      cursor_position: args.cursor,
      last_synced_at: new Date().toISOString(),
      pending_retry_count: 0,
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(`projection_advance_failed:${error?.message ?? 'unknown'}`);
  return data as ProjectionSyncState;
}

export async function recordProjectionRetry(args: {
  tenant: TenantContext;
  projectionKind: ProjectionKind;
  reason: string;
}): Promise<{ exhausted: boolean; state: ProjectionSyncState }> {
  const row = await ensureSyncRow(args.tenant, args.projectionKind);
  const next = Math.min(MAX_PROJECTION_RETRIES, row.pending_retry_count + 1);
  const { data, error } = await tenantTable('projection_sync_state', args.tenant)
    .update({
      pending_retry_count: next,
      metadata: { ...row.metadata, last_retry_reason: args.reason, last_retry_at: new Date().toISOString() },
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(`projection_retry_failed:${error?.message ?? 'unknown'}`);
  return { exhausted: next >= MAX_PROJECTION_RETRIES, state: data as ProjectionSyncState };
}

export async function markProjectionReplayed(args: {
  tenant: TenantContext;
  projectionKind: ProjectionKind;
  cursor: string;
}): Promise<ProjectionSyncState> {
  const row = await ensureSyncRow(args.tenant, args.projectionKind);
  const { data, error } = await tenantTable('projection_sync_state', args.tenant)
    .update({
      cursor_position: args.cursor,
      last_replayed_at: new Date().toISOString(),
      pending_retry_count: 0,
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(`projection_replay_failed:${error?.message ?? 'unknown'}`);
  return data as ProjectionSyncState;
}

export async function listProjectionSyncStates(
  tenant: TenantContext,
): Promise<ProjectionSyncState[]> {
  const { data, error } = await tenantTable('projection_sync_state', tenant)
    .select('*')
    .order('projection_kind', { ascending: true });
  if (error) throw new Error(`projection_sync_list_failed:${error.message}`);
  return (data as ProjectionSyncState[]) ?? [];
}
