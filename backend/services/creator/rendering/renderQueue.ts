/**
 * Render Queue Orchestrator — Step-R4 (async, exactly-once, fail-closed).
 * ──────────────────────────────────────────────────────────────────────────
 * Mutable operational queue ops over creator_render_queue_job. Immutable
 * render lineage stays in the R1 tables. DI deps (no DB import at load).
 * Reuses the two-step claim pattern (clear stale lease by time, THEN
 * claim by state) to avoid the PostgREST .or() ISO-timestamp bug.
 *
 * R3 synchronous rendering is NOT touched — this is a parallel async
 * path gated by ENABLE_CREATOR_RENDER_QUEUE (and still ENABLE_CREATOR_
 * RENDERING). Scheduler never touches any of this.
 */

export function isCreatorRenderQueueEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_RENDER_QUEUE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export type QueueState =
  | 'queued' | 'claimed' | 'rendering' | 'processing' | 'moderation'
  | 'completed' | 'failed' | 'retry_scheduled' | 'cancelled';

export interface RenderQueueDeps {
  supabase: any;
  ownedDbTable: (t: string) => any;
  now: () => string;
}

const LEASE_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_FACTOR = 3;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Transient ⇒ retryable. Terminal ⇒ never retry (moderation /
 *  capability / invalid spec / governance). Fail-closed default:
 *  UNKNOWN errors are treated TERMINAL (no infinite retry storms). */
export function isTransientFailure(reason: string): boolean {
  return [
    'provider_timeout', 'provider_network', 'provider_5xx',
    'provider_unavailable', 'transient',
  ].includes(reason);
}
export function isTerminalFailure(reason: string): boolean {
  return [
    'pre_moderation', 'post_moderation', 'no_capable_provider',
    'unsupported_capability', 'invalid_spec', 'projection_failed',
    'governance', 'image_only_this_step',
  ].includes(reason) || !isTransientFailure(reason);
}

function backoffMs(retry: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, Math.max(0, retry)), BACKOFF_MAX_MS);
}

export interface EnqueueArgs {
  renderJobId: string;
  providerKey: string;
  priority?: 'interactive' | 'standard' | 'batch';
  maxRetries?: number;
}

/** PHASE-2 enqueue. Idempotent on render_job_id (UNIQUE) — re-enqueue of
 *  the same render lineage returns the existing row (no dup attempts). */
export async function enqueueRenderJob(
  deps: RenderQueueDeps, a: EnqueueArgs,
): Promise<{ queue_job_id: string | null; event: 'render_enqueued' | 'render_enqueue_existing' }> {
  const { supabase, ownedDbTable } = deps;
  const { data: existing } = await supabase
    .from('creator_render_queue_job').select('id').eq('render_job_id', a.renderJobId).maybeSingle();
  if (existing?.id) return { queue_job_id: existing.id, event: 'render_enqueue_existing' };
  const { data } = await ownedDbTable('creator_render_queue_job').insert({
    render_job_id: a.renderJobId, provider_key: a.providerKey,
    queue_state: 'queued', priority: a.priority ?? 'standard',
    max_retries: a.maxRetries ?? 3,
  }).select('id').single();
  return { queue_job_id: data?.id ?? null, event: 'render_enqueued' };
}

/**
 * PHASE-2 exactly-once claim. Two steps so a lease can't be double-
 * granted: (1) expire stale leases by time, (2) claim a queued/
 * retry-ready row by state, stamping a lease. Returns null when nothing
 * is claimable.
 */
export async function claimRenderJob(
  deps: RenderQueueDeps, leaseOwner: string,
): Promise<{ id: string; render_job_id: string; provider_key: string; retry_count: number } | null> {
  const { supabase, ownedDbTable, now } = deps;
  const nowIso = now();
  // (1) reclaim stale in-flight leases → retry_scheduled (no .or())
  await ownedDbTable('creator_render_queue_job')
    .update({ queue_state: 'retry_scheduled', lease_owner: null, last_error: 'lease_expired' })
    .lt('lease_expires_at', nowIso)
    .in('queue_state', ['claimed', 'rendering', 'processing', 'moderation']);
  // (2) pick one claimable row (queued, or retry due)
  const { data: cand } = await supabase
    .from('creator_render_queue_job')
    .select('id, render_job_id, provider_key, retry_count, queue_state, next_retry_at')
    .in('queue_state', ['queued', 'retry_scheduled'])
    .order('created_at', { ascending: true })
    .limit(10);
  const rows: any[] = Array.isArray(cand) ? cand : [];
  const pick = rows.find((r) =>
    r.queue_state === 'queued' ||
    (r.queue_state === 'retry_scheduled' && (!r.next_retry_at || r.next_retry_at <= nowIso)));
  if (!pick) return null;
  const leaseExp = new Date(Date.parse(nowIso) + LEASE_MS).toISOString();
  // atomic-ish claim: only if still in the claimable state we saw
  const { data: claimed } = await ownedDbTable('creator_render_queue_job')
    .update({ queue_state: 'claimed', lease_owner: leaseOwner, lease_expires_at: leaseExp })
    .eq('id', pick.id)
    .in('queue_state', ['queued', 'retry_scheduled'])
    .select('id, render_job_id, provider_key, retry_count')
    .maybeSingle();
  if (!claimed?.id) return null; // someone else won the race
  return claimed;
}

/** Advance an in-flight queue job's working state (monotonic). */
export async function advanceQueueState(
  deps: RenderQueueDeps, id: string, state: QueueState,
): Promise<void> {
  await deps.ownedDbTable('creator_render_queue_job')
    .update({ queue_state: state }).eq('id', id);
}

export async function completeRenderJob(
  deps: RenderQueueDeps, id: string,
): Promise<{ event: 'render_completed_async' }> {
  await deps.ownedDbTable('creator_render_queue_job')
    .update({ queue_state: 'completed', lease_owner: null, lease_expires_at: null })
    .eq('id', id);
  return { event: 'render_completed_async' };
}

export async function cancelRenderJob(deps: RenderQueueDeps, id: string): Promise<void> {
  await deps.ownedDbTable('creator_render_queue_job')
    .update({ queue_state: 'cancelled', lease_owner: null }).eq('id', id);
}

export interface FailArgs {
  id: string; retryCount: number; maxRetries: number; reason: string;
}

/**
 * PHASE-4 fail handling. Transient + under cap ⇒ retry_scheduled with
 * backoff (idempotent: retry_count strictly increases — monotonic guard
 * enforces it). Terminal OR cap reached ⇒ failed (no more attempts).
 */
export async function failRenderJob(
  deps: RenderQueueDeps, a: FailArgs,
): Promise<{ event: 'render_retry_scheduled' | 'render_terminal_failure'; next_retry_at?: string }> {
  const { ownedDbTable, now } = deps;
  const transient = isTransientFailure(a.reason) && !isTerminalFailure(a.reason);
  if (transient && a.retryCount + 1 <= a.maxRetries) {
    const nextAt = new Date(Date.parse(now()) + backoffMs(a.retryCount)).toISOString();
    await ownedDbTable('creator_render_queue_job').update({
      queue_state: 'retry_scheduled', retry_count: a.retryCount + 1,
      next_retry_at: nextAt, lease_owner: null, lease_expires_at: null,
      last_error: a.reason,
    }).eq('id', a.id);
    return { event: 'render_retry_scheduled', next_retry_at: nextAt };
  }
  await ownedDbTable('creator_render_queue_job').update({
    queue_state: 'failed', lease_owner: null, lease_expires_at: null, last_error: a.reason,
  }).eq('id', a.id);
  return { event: 'render_terminal_failure' };
}
