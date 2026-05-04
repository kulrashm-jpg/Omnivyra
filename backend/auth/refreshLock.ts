/**
 * Token refresh distributed lock.
 *
 * Prevents concurrent refresh attempts from racing on a single-use
 * refresh_token. X v2 rotates refresh_tokens on every successful refresh:
 * if two workers fire simultaneously, both read the old refresh_token, X
 * rotates it on the first call, and the second writer overwrites the first
 * writer's rotated token — the rotated value is then lost and every future
 * refresh fails with invalid_grant.
 *
 * Implementation: a Postgres-backed lock keyed on (platform, account_id)
 * with a 30-second TTL. Acquisition is best-effort; the small race window
 * around stale-lock takeover is acceptable for our purposes (the worst case
 * is that two workers both refresh once, which is the same risk we have
 * today — but in practice the workers fire at different rates, so a hot
 * lock virtually always blocks the second one).
 *
 * Schema: see supabase/migrations/20260605_token_refresh_locks.sql.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

const DEFAULT_TTL_SECONDS = 30;

export type LockOwner = string | undefined;

/**
 * Try to acquire the named lock. Returns true if acquired (caller must call
 * releaseLock when done), false if another holder owns a fresh lock.
 *
 * Stale locks (older than ttlSeconds) are treated as released and the caller
 * takes them over.
 */
export async function acquireRefreshLock(
  lockKey: string,
  owner?: LockOwner,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - ttlSeconds * 1000).toISOString();

  // Fast path: insert. If no conflict, we own the lock.
  const { error: insertError } = await supabase
    .from('token_refresh_locks')
    .insert({ lock_key: lockKey, acquired_at: now, acquired_by: owner ?? null });

  if (!insertError) return true;

  // PK conflict — a row exists. If it's stale, take it over.
  const { data: existing } = await supabase
    .from('token_refresh_locks')
    .select('acquired_at')
    .eq('lock_key', lockKey)
    .maybeSingle();

  if (!existing) {
    // Row vanished between insert and select (rare). Try insert once more.
    const { error: retryError } = await supabase
      .from('token_refresh_locks')
      .insert({ lock_key: lockKey, acquired_at: now, acquired_by: owner ?? null });
    return !retryError;
  }

  if (new Date(existing.acquired_at).getTime() >= new Date(cutoffIso).getTime()) {
    // Fresh lock held by someone else.
    return false;
  }

  // Stale — take it over with a guarded update so we lose to any other taker
  // that races us through this window.
  const { data: takenOver, error: updateError } = await supabase
    .from('token_refresh_locks')
    .update({ acquired_at: now, acquired_by: owner ?? null })
    .eq('lock_key', lockKey)
    .lt('acquired_at', cutoffIso)
    .select('lock_key')
    .maybeSingle();

  if (updateError || !takenOver) return false;
  return true;
}

/**
 * Release the named lock unconditionally. Safe to call even if the row no
 * longer exists.
 */
export async function releaseRefreshLock(lockKey: string): Promise<void> {
  await supabase.from('token_refresh_locks').delete().eq('lock_key', lockKey);
}

/**
 * Run `fn` while holding the named lock. If the lock cannot be acquired,
 * returns `whenBlocked`. Lock is always released, even on throw.
 */
export async function withRefreshLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  whenBlocked: T,
  owner?: LockOwner,
): Promise<T> {
  const acquired = await acquireRefreshLock(lockKey, owner);
  if (!acquired) {
    console.log(`[refreshLock] skipped — lock held: ${lockKey}`);
    return whenBlocked;
  }
  try {
    return await fn();
  } finally {
    await releaseRefreshLock(lockKey);
  }
}
