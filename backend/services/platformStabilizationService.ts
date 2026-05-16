/**
 * Phase 12 — Platform stabilization layer.
 *
 * Operator-defined stabilization windows that hold the platform in a
 * deterministic freeze state during high-risk operations (rollouts,
 * migrations, incident triage, semantic backfills). Every state
 * transition writes an append-only event row.
 *
 * State machine: `planned -> active -> closed/cancelled/expired`.
 *
 * Freeze modes:
 *   • soft               — advisory; callers consult `isPlatformFrozen()`
 *   • hard               — same advisory check; harder operational signal
 *   • emergency_pause    — same advisory check; highest signal
 *   • degradation_only   — degraded-mode signal; callers pick safer paths
 *
 * Freeze scopes:
 *   • platform, rollouts, migrations, semantic, replay, connectors, executions
 *
 * Hard guarantees:
 *   • No auto-freeze. Every window requires explicit operator activation.
 *   • Replay-safe: state changes are persisted; callers consult state
 *     synchronously and choose to no-op or branch.
 *   • Append-only event log enforced by DB trigger.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type PlatformStabilizationEvent,
  type PlatformStabilizationWindow,
  type StabilizationEventKind,
  type StabilizationFreezeMode,
  type StabilizationFreezeScope,
  type StabilizationWindowState,
} from '../types/platformStabilization';
import { publishRealtime } from './realtimePublisherService';
import {
  publishRuntimeFreezeApplied,
  publishRuntimeFreezeReleased,
  publishStabilizationWindowActivated,
  publishStabilizationWindowClosed,
} from '../events/listeningEvents';

async function appendStabilizationEvent(args: {
  organizationId: string;
  windowId: string;
  eventKind: StabilizationEventKind;
  previousState: StabilizationWindowState | null;
  newState: StabilizationWindowState;
  actorUserId: string | null;
  rationale: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PlatformStabilizationEvent | null> {
  const { data } = await ownedDbTable('platform_stabilization_events')
    .insert({
      organization_id: args.organizationId,
      window_id: args.windowId,
      event_kind: args.eventKind,
      previous_state: args.previousState,
      new_state: args.newState,
      actor_user_id: args.actorUserId,
      rationale: args.rationale,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  return (data as PlatformStabilizationEvent | null) ?? null;
}

export type CreateStabilizationWindowInput = {
  organizationId: string;
  windowName: string;
  freezeMode: StabilizationFreezeMode;
  freezeScope: StabilizationFreezeScope;
  scheduledStart: string;
  scheduledEnd: string;
  rationale?: string | null;
  boundedScope?: string[];
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
};

export async function createStabilizationWindow(
  input: CreateStabilizationWindowInput,
): Promise<PlatformStabilizationWindow> {
  const name = (input.windowName ?? '').trim().slice(0, 200);
  if (name.length === 0) throw new Error('stabilization_window_name_required');
  if (new Date(input.scheduledEnd) <= new Date(input.scheduledStart)) {
    throw new Error('stabilization_window_invalid_range');
  }

  const ins = await ownedDbTable('platform_stabilization_windows')
    .insert({
      organization_id: input.organizationId,
      window_name: name,
      freeze_mode: input.freezeMode,
      freeze_scope: input.freezeScope,
      state: 'planned' as StabilizationWindowState,
      scheduled_start: input.scheduledStart,
      scheduled_end: input.scheduledEnd,
      rationale: input.rationale ?? null,
      bounded_scope: input.boundedScope ?? [],
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`stabilization_window_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as PlatformStabilizationWindow;

  await appendStabilizationEvent({
    organizationId: input.organizationId,
    windowId: row.id,
    eventKind: 'planned',
    previousState: null,
    newState: 'planned',
    actorUserId: input.actorUserId,
    rationale: input.rationale ?? null,
  });

  return row;
}

export async function activateStabilizationWindow(args: {
  organizationId: string;
  windowId: string;
  actorUserId: string | null;
}): Promise<PlatformStabilizationWindow> {
  const upd = await ownedDbTable('platform_stabilization_windows')
    .update({
      state: 'active' as StabilizationWindowState,
      activated_at: new Date().toISOString(),
      activated_by: args.actorUserId,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.windowId)
    .eq('state', 'planned')
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`stabilization_activate_failed:${upd.error?.message ?? 'unknown'}`);
  const row = upd.data as PlatformStabilizationWindow;

  await appendStabilizationEvent({
    organizationId: args.organizationId,
    windowId: row.id,
    eventKind: 'activated',
    previousState: 'planned',
    newState: 'active',
    actorUserId: args.actorUserId,
    rationale: row.rationale,
  });
  await appendStabilizationEvent({
    organizationId: args.organizationId,
    windowId: row.id,
    eventKind: 'freeze_applied',
    previousState: 'planned',
    newState: 'active',
    actorUserId: args.actorUserId,
    rationale: `freeze_scope=${row.freeze_scope}, freeze_mode=${row.freeze_mode}`,
  });

  try {
    await publishStabilizationWindowActivated({
      organizationId: args.organizationId,
      windowId: row.id,
      freezeMode: row.freeze_mode,
      freezeScope: row.freeze_scope,
      actorUserId: args.actorUserId,
    });
    await publishRuntimeFreezeApplied({
      organizationId: args.organizationId,
      windowId: row.id,
      freezeScope: row.freeze_scope,
      actorUserId: args.actorUserId,
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'platform_stabilization',
      eventName: 'stabilization.window_activated',
      payload: { window_id: row.id, freeze_scope: row.freeze_scope, freeze_mode: row.freeze_mode },
    });
  } catch { /* best effort */ }

  return row;
}

export async function closeStabilizationWindow(args: {
  organizationId: string;
  windowId: string;
  actorUserId: string | null;
  closeAs?: 'closed' | 'cancelled' | 'expired';
}): Promise<PlatformStabilizationWindow> {
  const closeAs = args.closeAs ?? 'closed';
  const { data: existing } = await ownedDbTable('platform_stabilization_windows')
    .select('state, freeze_scope')
    .eq('organization_id', args.organizationId)
    .eq('id', args.windowId)
    .maybeSingle();
  const prev = (existing as { state: StabilizationWindowState; freeze_scope: StabilizationFreezeScope } | null) ?? null;
  if (!prev) throw new Error(`stabilization_window_not_found:${args.windowId}`);
  if (!['planned', 'active'].includes(prev.state)) throw new Error(`stabilization_window_not_closable:${prev.state}`);

  const upd = await ownedDbTable('platform_stabilization_windows')
    .update({
      state: closeAs as StabilizationWindowState,
      closed_at: new Date().toISOString(),
      closed_by: args.actorUserId,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.windowId)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`stabilization_close_failed:${upd.error?.message ?? 'unknown'}`);
  const row = upd.data as PlatformStabilizationWindow;

  await appendStabilizationEvent({
    organizationId: args.organizationId,
    windowId: row.id,
    eventKind: closeAs === 'expired' ? 'expired' : closeAs === 'cancelled' ? 'cancelled' : 'closed',
    previousState: prev.state,
    newState: closeAs,
    actorUserId: args.actorUserId,
    rationale: 'operator closed',
  });
  if (prev.state === 'active') {
    await appendStabilizationEvent({
      organizationId: args.organizationId,
      windowId: row.id,
      eventKind: 'freeze_released',
      previousState: 'active',
      newState: closeAs,
      actorUserId: args.actorUserId,
      rationale: `freeze_scope=${prev.freeze_scope}`,
    });
  }

  try {
    await publishStabilizationWindowClosed({
      organizationId: args.organizationId,
      windowId: row.id,
      closedBy: args.actorUserId,
    });
    if (prev.state === 'active') {
      await publishRuntimeFreezeReleased({
        organizationId: args.organizationId,
        windowId: row.id,
        freezeScope: prev.freeze_scope,
        actorUserId: args.actorUserId,
      });
    }
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'platform_stabilization',
      eventName: 'stabilization.window_closed',
      payload: { window_id: row.id, close_as: closeAs },
    });
  } catch { /* best effort */ }

  return row;
}

/**
 * Advisory: returns true if any active stabilization window covers the
 * requested scope. Callers consult this and choose to no-op or branch.
 * This service NEVER blocks caller code.
 */
export async function isPlatformFrozen(
  organizationId: string,
  scope: StabilizationFreezeScope,
): Promise<{ frozen: boolean; window: PlatformStabilizationWindow | null }> {
  const { data } = await ownedDbTable('platform_stabilization_windows')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('state', 'active')
    .in('freeze_scope', ['platform', scope])
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const w = (data as PlatformStabilizationWindow | null) ?? null;
  return { frozen: Boolean(w), window: w };
}

export async function listStabilizationWindows(
  organizationId: string,
  options?: { state?: StabilizationWindowState; limit?: number },
): Promise<PlatformStabilizationWindow[]> {
  let q = ownedDbTable('platform_stabilization_windows')
    .select('*')
    .eq('organization_id', organizationId)
    .order('scheduled_start', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.state) q = q.eq('state', options.state);
  const { data } = await q;
  return (data as PlatformStabilizationWindow[]) ?? [];
}

export async function listStabilizationEvents(
  organizationId: string,
  windowId: string,
): Promise<PlatformStabilizationEvent[]> {
  const { data } = await ownedDbTable('platform_stabilization_events')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('window_id', windowId)
    .order('created_at', { ascending: false })
    .limit(500);
  return (data as PlatformStabilizationEvent[]) ?? [];
}
