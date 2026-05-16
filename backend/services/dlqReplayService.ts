/**
 * Phase 7 — Operational DLQ inventory + bounded replay.
 *
 * Phase 7 does NOT add a BullMQ DLQ producer. Instead it surfaces existing
 * Phase 0–6 failure rows (BullMQ lead-jobs-dlq is the only existing BullMQ
 * DLQ; Phase 7 also offers a "logical DLQ" view over failed listening
 * executions and exhausted projection_sync_state rows).
 *
 * The replay workflow:
 *   1. POST /replay      — create `replay_operations` row in `requested` state
 *   2. POST .../preview  — read target rows, populate `preview_summary`
 *   3. POST .../approve  — flip status to `approved` with actor attribution
 *   4. POST .../execute  — perform the replay action, record `result_summary`
 *
 * Every step is explicit. There is no autonomous replayer. Phase 7 ships
 * the inventory + preview + approve + execute step for `projection` kind
 * (re-emit feed_projection events via the realtime publisher). The other
 * target kinds (execution_failure, moderation_block, alert) are recorded
 * and previewable today; execution remains a Phase 8 concern to keep
 * blast radius small.
 */

import { ownedDbTable } from '../db/writeOwner';
import { publishRealtime } from './realtimePublisherService';
import { advanceProjectionCursor } from './projectionSyncService';
import type {
  ReplayOperation,
  ReplayStatus,
  ReplayTargetKind,
} from '../types/replayOps';
import { REPLAY_MAX_BATCH_SIZE } from '../types/replayOps';

// ---------------------------------------------------------------------------
// Inventory (read-only)
// ---------------------------------------------------------------------------

export type DLQInventoryEntry = {
  kind: ReplayTargetKind;
  id: string;
  summary: string;
  failed_at: string | null;
  retry_count: number | null;
  payload: Record<string, unknown>;
};

export async function listDLQInventory(
  organizationId: string,
  options?: { kind?: ReplayTargetKind; limit?: number },
): Promise<DLQInventoryEntry[]> {
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  const entries: DLQInventoryEntry[] = [];

  if (!options?.kind || options.kind === 'execution_failure') {
    const { data } = await ownedDbTable('listening_executions')
      .select('id, failed_at, error_metadata, listening_source_id, retry_count')
      .eq('organization_id', organizationId)
      .eq('execution_status', 'failed')
      .order('failed_at', { ascending: false })
      .limit(limit);
    for (const r of (data ?? []) as Array<{
      id: string;
      failed_at: string | null;
      error_metadata: Record<string, unknown> | null;
      listening_source_id: string;
      retry_count: number | null;
    }>) {
      entries.push({
        kind: 'execution_failure',
        id: r.id,
        summary: typeof (r.error_metadata as { reason?: string } | null)?.reason === 'string'
          ? String((r.error_metadata as { reason: string }).reason)
          : 'execution_failed',
        failed_at: r.failed_at,
        retry_count: r.retry_count,
        payload: { listening_source_id: r.listening_source_id, error_metadata: r.error_metadata },
      });
    }
  }

  if (!options?.kind || options.kind === 'projection') {
    const { data } = await ownedDbTable('projection_sync_state')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('pending_retry_count', 5)
      .order('updated_at', { ascending: false })
      .limit(limit);
    for (const r of (data ?? []) as Array<{
      id: string;
      projection_kind: string;
      cursor_position: string | null;
      pending_retry_count: number;
      updated_at: string;
      metadata: Record<string, unknown>;
    }>) {
      entries.push({
        kind: 'projection',
        id: r.id,
        summary: `projection ${r.projection_kind} exhausted retries`,
        failed_at: r.updated_at,
        retry_count: r.pending_retry_count,
        payload: { projection_kind: r.projection_kind, cursor: r.cursor_position, metadata: r.metadata },
      });
    }
  }

  if (!options?.kind || options.kind === 'moderation_block') {
    const { data } = await ownedDbTable('moderation_decisions')
      .select('id, content_hash, reasons, created_at, platform')
      .eq('organization_id', organizationId)
      .eq('outcome', 'blocked')
      .order('created_at', { ascending: false })
      .limit(limit);
    for (const r of (data ?? []) as Array<{
      id: string;
      content_hash: string;
      reasons: string[];
      created_at: string;
      platform: string;
    }>) {
      entries.push({
        kind: 'moderation_block',
        id: r.id,
        summary: `blocked content (${(r.reasons ?? []).join(',') || 'unknown'})`,
        failed_at: r.created_at,
        retry_count: null,
        payload: { content_hash: r.content_hash, platform: r.platform },
      });
    }
  }

  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Replay operations CRUD
// ---------------------------------------------------------------------------

export type RequestReplayInput = {
  organizationId: string;
  targetKind: ReplayTargetKind;
  itemIds: string[];
  requestedBy: string | null;
};

export async function requestReplay(input: RequestReplayInput): Promise<ReplayOperation> {
  const batch = Math.min(REPLAY_MAX_BATCH_SIZE, input.itemIds.length);
  const items = input.itemIds.slice(0, batch);
  const { data, error } = await ownedDbTable('replay_operations')
    .insert({
      organization_id: input.organizationId,
      target_kind: input.targetKind,
      status: 'requested' as ReplayStatus,
      requested_items: items,
      batch_size: items.length,
      requested_by: input.requestedBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`replay_request_failed:${error?.message ?? 'unknown'}`);
  return data as ReplayOperation;
}

export async function previewReplay(args: {
  organizationId: string;
  replayId: string;
}): Promise<ReplayOperation> {
  const { data: existing } = await ownedDbTable('replay_operations')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.replayId)
    .maybeSingle();
  const op = existing as ReplayOperation | null;
  if (!op) throw new Error(`replay_not_found:${args.replayId}`);
  if (op.status !== 'requested') throw new Error(`replay_not_in_requested:${op.status}`);
  const preview = {
    target_kind: op.target_kind,
    items_count: op.requested_items.length,
    sample: op.requested_items.slice(0, 5),
  };
  const { data, error } = await ownedDbTable('replay_operations')
    .update({
      status: 'previewed' as ReplayStatus,
      preview_summary: preview,
    })
    .eq('id', op.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(`replay_preview_failed:${error?.message ?? 'unknown'}`);
  return data as ReplayOperation;
}

export async function approveReplay(args: {
  organizationId: string;
  replayId: string;
  approverUserId: string | null;
}): Promise<ReplayOperation> {
  const { data: existing } = await ownedDbTable('replay_operations')
    .select('status')
    .eq('organization_id', args.organizationId)
    .eq('id', args.replayId)
    .maybeSingle();
  const status = (existing as { status?: string } | null)?.status;
  if (status !== 'previewed') throw new Error(`replay_not_previewed:${status ?? 'missing'}`);
  const { data, error } = await ownedDbTable('replay_operations')
    .update({
      status: 'approved' as ReplayStatus,
      approved_at: new Date().toISOString(),
      approved_by: args.approverUserId,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.replayId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`replay_approve_failed:${error?.message ?? 'unknown'}`);
  return data as ReplayOperation;
}

export async function executeReplay(args: {
  organizationId: string;
  replayId: string;
  executorUserId: string | null;
}): Promise<ReplayOperation> {
  const { data: existing } = await ownedDbTable('replay_operations')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.replayId)
    .maybeSingle();
  const op = existing as ReplayOperation | null;
  if (!op) throw new Error(`replay_not_found:${args.replayId}`);
  if (op.status !== 'approved') throw new Error(`replay_not_approved:${op.status}`);

  await ownedDbTable('replay_operations')
    .update({ status: 'executing' as ReplayStatus })
    .eq('id', op.id);

  const result: Record<string, unknown> = { kind: op.target_kind, processed: 0, skipped: 0 };
  let processed = 0;
  let skipped = 0;

  try {
    if (op.target_kind === 'projection') {
      // Re-emit a projection.replayed event per item. Bounded by batch_size
      // already; executeReplay never traverses beyond the requested items.
      for (const id of op.requested_items) {
        const { data: row } = await ownedDbTable('projection_sync_state')
          .select('*')
          .eq('organization_id', args.organizationId)
          .eq('id', id)
          .maybeSingle();
        if (!row) {
          skipped += 1;
          continue;
        }
        const r = row as { projection_kind: string; cursor_position: string | null };
        await publishRealtime({
          organizationId: args.organizationId,
          topic: 'opportunity_feed',
          eventName: 'projection.replayed',
          payload: {
            projection_kind: r.projection_kind,
            cursor_position: r.cursor_position,
            replay_id: op.id,
          },
        });
        if (r.cursor_position) {
          await advanceProjectionCursor({
            organizationId: args.organizationId,
            projectionKind: r.projection_kind as 'opportunity_feed' | 'graph' | 'alerts' | 'clusters' | 'lifecycle',
            cursor: r.cursor_position,
          });
        }
        processed += 1;
      }
    } else {
      // Phase 7 records the request but does NOT execute non-projection
      // replays. The result_summary surfaces this so operators can route
      // them via the Phase 8 hard-replay path when it lands.
      result.deferred = true;
      result.reason = `${op.target_kind}_replay_deferred_to_phase_8`;
      skipped = op.requested_items.length;
    }
    result.processed = processed;
    result.skipped = skipped;

    const { data, error } = await ownedDbTable('replay_operations')
      .update({
        status: 'complete' as ReplayStatus,
        executed_at: new Date().toISOString(),
        executed_by: args.executorUserId,
        result_summary: result,
      })
      .eq('id', op.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`replay_complete_failed:${error?.message ?? 'unknown'}`);
    return data as ReplayOperation;
  } catch (err: any) {
    await ownedDbTable('replay_operations')
      .update({
        status: 'failed' as ReplayStatus,
        failure_reason: err?.message ?? 'unknown',
        result_summary: result,
        executed_at: new Date().toISOString(),
        executed_by: args.executorUserId,
      })
      .eq('id', op.id);
    throw new Error(`replay_execute_failed:${err?.message ?? 'unknown'}`);
  }
}

export async function listReplayOperations(
  organizationId: string,
  options?: { status?: ReplayStatus; limit?: number },
): Promise<ReplayOperation[]> {
  let q = ownedDbTable('replay_operations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`replay_list_failed:${error.message}`);
  return (data as ReplayOperation[]) ?? [];
}
