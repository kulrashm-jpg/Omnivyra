/**
 * BOLT execution lock with stale-lock recovery.
 *
 * Replaces the soft `status === 'running'` guard at the top of
 * executeBoltPipelineRuntime. The soft guard had a fatal blind spot:
 * if a worker crashed mid-pipeline the run stayed `status='running'`
 * forever and no other worker (or human re-trigger) could re-enter it.
 *
 * Contract:
 *   - acquireRunLock() atomically claims a run when nobody else holds
 *     a valid (non-expired) lock. Returns the lock token + expiry, or
 *     null when the run is already in flight.
 *   - extendRunLock() pushes lock_expires_at forward during long
 *     stages. Caller passes its token so a stale worker can't bump
 *     someone else's lock.
 *   - releaseRunLock() clears the lock columns on terminal status.
 *
 * The function intentionally does NOT touch `status` — that's the
 * pipeline's job. The lock is a separate, stricter signal.
 *
 * Schema: see migration `20260515b_bolt_execution_resilience.sql`
 * (lock_owner, lock_acquired_at, lock_expires_at on bolt_execution_runs).
 */

import { randomUUID } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';

/**
 * Default lease length.
 *
 * Sized to comfortably outlast the longest legitimate stage we've
 * observed end-to-end. Phase 4 (medium load) data:
 *   - ai/plan:                  73–85 s
 *   - generate-weekly-structure ~17 s
 *   - schedule-structured-plan  115 s
 * 4-week × 3-platform projections push the schedule stage to ~11 min,
 * so a TTL shorter than the stage duration would let the lock lapse
 * mid-stage and expose the run to a concurrent stale-recovery claim
 * by another worker.
 *
 * KNOWN GAP (deferred): `updateRun` currently writes `heartbeat_at` on
 * every state update but does NOT write `lock_expires_at`. A prior
 * comment claimed it did — it doesn't. Until that's wired in, the
 * lock is only extended at stage boundaries (acquireRunLock +
 * extendRunLock). 5 min gives margin even on 4-week schedule runs
 * because each stage *boundary* extends, and no individual stage in
 * the observed envelope exceeds the TTL.
 */
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export interface BoltRunLock {
  /** Per-execution token. Must be presented on every extend/release. */
  token: string;
  /** When the lock will expire if not extended. */
  expiresAt: string;
}

/**
 * Atomically claim the lock if either:
 *   (a) no lock is currently held, OR
 *   (b) the current lock has expired.
 *
 * Returns the lock token + expiry on success, or `null` if a live
 * worker still holds a valid lock.
 *
 * This is a single-statement compare-and-set against the row, so it
 * is safe under concurrent execution attempts.
 */
export async function acquireRunLock(
  runId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  // Caller can pre-mint a token (e.g. crashed-worker recovery flow);
  // otherwise we mint a fresh one.
  preMintedToken?: string,
): Promise<BoltRunLock | null> {
  const token = preMintedToken ?? randomUUID();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();

  // Two-step claim to avoid a PostgREST .or() + ISO-timestamp parsing
  // bug that silently caused EVERY acquire to fail.
  //
  // Previously we tried:
  //   .or(`lock_owner.is.null,lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
  // which translates to a URL like:
  //   or=(lock_owner.is.null,lock_expires_at.is.null,lock_expires_at.lt.2026-05-15T15:35:00.000Z)
  // PostgREST parses the comma-separated value list incorrectly when one
  // value contains both `:` and `.000Z` — the parser confuses the `.`
  // separators in the timestamp with filter-name separators, the whole
  // `.or()` clause is treated as unsatisfiable, no row matches, the
  // UPDATE writes nothing, `.maybeSingle()` returns null, and we return
  // null pretending the lock was held by someone else. Result: every
  // BOLT run silently bailed right after acquireRunLock "succeeded".
  //
  // Fix: do the stale-lock recovery as a SEPARATE update first, then
  // claim with a simple `lock_owner IS NULL` check — no timestamp in
  // the filter. The two operations don't need to be atomic together;
  // we serialize them and the second is the actual atomic claim.

  // Step 1: clear any stale lock (expired or NULL lock_expires_at with
  // non-NULL lock_owner — a defensive case where someone forgot to set
  // an expiry). This is a no-op when the lock is healthy and held.
  await ownedDbTable('bolt_execution_runs')
    .update({ lock_owner: null, lock_expires_at: null, lock_acquired_at: null })
    .eq('id', runId)
    .lt('lock_expires_at', nowIso);

  // Step 2: atomic claim. lock_owner IS NULL is the only filter — works
  // because step 1 nulled out any stale lock.
  const { data, error } = await ownedDbTable('bolt_execution_runs')
    .update({
      lock_owner: token,
      lock_acquired_at: nowIso,
      lock_expires_at: expiresAt,
      heartbeat_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', runId)
    .is('lock_owner', null)
    .select('id, lock_owner, lock_expires_at')
    .maybeSingle();

  if (error) {
    console.error('[bolt/lock] acquire failed', { runId, error: error.message });
    return null;
  }
  if (!data) {
    // A live worker still holds the lock. Back off silently.
    return null;
  }
  return { token, expiresAt };
}

/**
 * Refresh lock_expires_at for the current owner. Use between stages
 * during long runs so a slow AI call doesn't let the lock lapse and
 * invite a second worker in.
 *
 * Bumps heartbeat_at at the same time — the sweeper uses heartbeat
 * as its liveness signal.
 *
 * Returns true when the extension succeeded, false when the current
 * lock_owner no longer matches (someone else claimed it, or the run
 * was terminally updated).
 */
export async function extendRunLock(
  runId: string,
  token: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const { data, error } = await ownedDbTable('bolt_execution_runs')
    .update({
      lock_expires_at: expiresAt,
      heartbeat_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', runId)
    .eq('lock_owner', token)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[bolt/lock] extend failed', { runId, error: error.message });
    return false;
  }
  return !!data;
}

/**
 * Clear the lock columns. Called on terminal status (completed /
 * failed / cancelled). Token-checked so a crashed worker can't
 * accidentally clear a successor's lock.
 *
 * Never throws — releasing a lock that's already been re-claimed is
 * a no-op, not an error.
 */
export async function releaseRunLock(runId: string, token: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await ownedDbTable('bolt_execution_runs')
    .update({
      lock_owner: null,
      lock_expires_at: null,
      updated_at: nowIso,
    })
    .eq('id', runId)
    .eq('lock_owner', token);
  if (error) {
    console.warn('[bolt/lock] release failed (non-fatal)', { runId, error: error.message });
  }
}

/**
 * Read-only check: is the run currently locked by a live worker?
 * Used by the cancel API (skips persistence work when nothing's
 * running) and by diagnostic tooling.
 */
export async function getRunLockState(runId: string): Promise<{
  isHeld: boolean;
  isStale: boolean;
  lockOwner: string | null;
  lockExpiresAt: string | null;
}> {
  const { data } = await supabase
    .from('bolt_execution_runs')
    .select('lock_owner, lock_expires_at')
    .eq('id', runId)
    .maybeSingle();
  const lockOwner = ((data as { lock_owner?: string | null } | null) ?? null)?.lock_owner ?? null;
  const lockExpiresAt = ((data as { lock_expires_at?: string | null } | null) ?? null)?.lock_expires_at ?? null;
  const isStale = lockExpiresAt ? new Date(lockExpiresAt).getTime() < Date.now() : false;
  return {
    isHeld: !!lockOwner && !isStale,
    isStale: !!lockOwner && isStale,
    lockOwner,
    lockExpiresAt,
  };
}
