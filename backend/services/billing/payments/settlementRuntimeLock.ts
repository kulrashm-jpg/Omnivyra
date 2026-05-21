/**
 * Distributed settlement runtime lock (INTERNAL).
 *
 * A cross-process / cross-container / cross-worker lease lock backed by the
 * `settlement_runtime_locks` table (migration 20260720). Replaces the previous
 * process-local re-entrancy guard so a settlement job is safe under
 * multi-instance execution.
 *
 *   acquire — insert a fresh lease row; if a row exists, reclaim it ONLY when
 *             its lease has expired (a compare-and-swap on expires_at).
 *   release — delete the lease IFF the owner_token matches.
 *
 * STALE-LOCK-SAFE: a crashed holder's lease expires after `ttlMs`; the next
 * acquirer's expiry CAS reclaims it. TIMEOUT-SAFE: the lease bounds the hold.
 * DETERMINISTIC: acquisition outcome is a pure function of (table state, now).
 *
 * DEFAULT-PRESERVING: when the lock table is absent (migration unapplied) or
 * the DB is unreachable, acquire is FAIL-OPEN (`acquired:true, degraded:true`)
 * — the job still runs and duplicate transitions stay prevented by the
 * append-only billing_settlement_events ledger. Never throws.
 *
 * NO public/manual lock API — this module is called only by internal jobs.
 */

import crypto from 'crypto';
import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface LockRow {
  lock_key: string;
  owner_token: string;
  acquired_at: string;
  expires_at: string;
}

/** Low-level lock-table operations — injectable so the lock is unit-testable
 *  without a DB. */
export interface LockBackend {
  /** Insert a fresh lease. 'conflict' = a row already exists; 'unavailable' =
   *  table missing / DB error (→ fail-open). */
  tryInsert(row: LockRow): Promise<'inserted' | 'conflict' | 'unavailable'>;
  /** Compare-and-swap: claim the lease for row.lock_key IFF its expires_at is
   *  strictly before nowIso. Returns true when the stale lease was reclaimed. */
  tryClaimExpired(row: LockRow, nowIso: string): Promise<boolean>;
  /** Delete the lease IFF lock_key + owner_token match. */
  remove(lockKey: string, ownerToken: string): Promise<void>;
}

function messageIncludes(error: { message?: string }, needle: string): boolean {
  return String(error.message ?? '').toLowerCase().includes(needle);
}

/** The default supabase-backed lock backend. */
export const DEFAULT_LOCK_BACKEND: LockBackend = {
  tryInsert: async (row) => {
    const { error } = await supabase
      .from('settlement_runtime_locks')
      .insert(row as unknown as Record<string, unknown>);
    if (!error) return 'inserted';
    if ((error as { code?: string }).code === '23505') return 'conflict';
    if (messageIncludes(error, 'does not exist')) return 'unavailable';
    logger.warn('settlement_lock_insert_failed', { message: error.message });
    return 'unavailable'; // unknown DB error → fail-open
  },
  tryClaimExpired: async (row, nowIso) => {
    // CAS — the .lt('expires_at', nowIso) predicate ensures only an EXPIRED
    // lease is reclaimed; concurrent claimers are serialized by Postgres.
    const { data, error } = await supabase
      .from('settlement_runtime_locks')
      .update({ owner_token: row.owner_token, acquired_at: row.acquired_at, expires_at: row.expires_at })
      .eq('lock_key', row.lock_key)
      .lt('expires_at', nowIso)
      .select('lock_key');
    if (error || !data) return false;
    return (data as unknown[]).length > 0;
  },
  remove: async (lockKey, ownerToken) => {
    const { error } = await supabase
      .from('settlement_runtime_locks')
      .delete()
      .eq('lock_key', lockKey)
      .eq('owner_token', ownerToken);
    if (error && !messageIncludes(error, 'does not exist')) {
      logger.warn('settlement_lock_release_failed', { message: error.message });
    }
  },
};

export interface AcquireLockResult {
  acquired: boolean;
  /** Identifies this holder — required to release. */
  ownerToken: string;
  /** true → the lock table was unavailable; acquisition is fail-open. */
  degraded: boolean;
}

export interface AcquireLockOptions {
  ttlMs?: number;
  /** Injectable clock (ms) — defaults to Date.now(). */
  nowMs?: number;
  backend?: LockBackend;
}

/**
 * Acquire the distributed lease for `lockKey`. Deterministic + stale-lock-safe.
 */
export async function acquireSettlementLock(
  lockKey: string,
  opts: AcquireLockOptions = {},
): Promise<AcquireLockResult> {
  const backend = opts.backend ?? DEFAULT_LOCK_BACKEND;
  const ttl = opts.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : DEFAULT_TTL_MS;
  const now = opts.nowMs ?? Date.now();
  const ownerToken = crypto.randomUUID();
  const row: LockRow = {
    lock_key: lockKey,
    owner_token: ownerToken,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl).toISOString(),
  };

  try {
    const insert = await backend.tryInsert(row);
    if (insert === 'inserted') return { acquired: true, ownerToken, degraded: false };
    if (insert === 'unavailable') {
      // Fail-open — preserve pre-distributed-lock behavior. The append-only
      // event ledger still prevents duplicate expiry transitions.
      return { acquired: true, ownerToken, degraded: true };
    }
    // conflict — a lease row exists. Reclaim ONLY if it has expired.
    const claimed = await backend.tryClaimExpired(row, new Date(now).toISOString());
    return { acquired: claimed, ownerToken, degraded: false };
  } catch (err) {
    logger.warn('settlement_lock_acquire_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { acquired: true, ownerToken, degraded: true }; // fail-open
  }
}

/** Release the lease. Best-effort — a non-matching owner_token is a no-op
 *  (a lease reclaimed after expiry is owned by someone else). Never throws. */
export async function releaseSettlementLock(
  lockKey: string,
  ownerToken: string,
  opts: { backend?: LockBackend } = {},
): Promise<void> {
  const backend = opts.backend ?? DEFAULT_LOCK_BACKEND;
  try {
    await backend.remove(lockKey, ownerToken);
  } catch (err) {
    logger.warn('settlement_lock_release_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── operational visibility (READ-ONLY) ──────────────────────────────────────
// Internal observability for the settlement-ops endpoint. STRICTLY read-only —
// there is NO manual lock mutation / override path.

/** A lock lease as surfaced to an internal operator. */
export interface SettlementLockView {
  lock_key: string;
  /** Identifies the current holder. */
  owner_token: string;
  acquired_at: string;
  expires_at: string;
  /** true → the lease has elapsed (reclaimable by the next acquirer). */
  is_expired: boolean;
}

export interface SettlementLockVisibility {
  /** true → the lock table is unavailable; the runtime is in fail-open mode. */
  degraded: boolean;
  locks: SettlementLockView[];
}

/** Read surface for lock visibility — injectable for unit tests. */
export interface LockVisibilityBackend {
  /** `available:false` → the lock table is missing / unreachable. */
  readLocks(): Promise<{ available: boolean; rows: LockRow[] }>;
}

export const DEFAULT_LOCK_VISIBILITY_BACKEND: LockVisibilityBackend = {
  readLocks: async () => {
    const { data, error } = await supabase
      .from('settlement_runtime_locks')
      .select('lock_key, owner_token, acquired_at, expires_at');
    if (error) return { available: false, rows: [] };
    return {
      available: true,
      rows: (data as unknown as LockRow[] | null) ?? [],
    };
  },
};

/**
 * Read the current settlement lock leases for internal observability. READ-ONLY
 * — never mutates a lease. `degraded` reflects the fail-open mode state (the
 * lock table being unavailable). Never throws.
 */
export async function listSettlementLocks(
  opts: { nowMs?: number; backend?: LockVisibilityBackend } = {},
): Promise<SettlementLockVisibility> {
  const backend = opts.backend ?? DEFAULT_LOCK_VISIBILITY_BACKEND;
  const now = opts.nowMs ?? Date.now();
  try {
    const { available, rows } = await backend.readLocks();
    if (!available) return { degraded: true, locks: [] };
    const nowIso = new Date(now).toISOString();
    const locks: SettlementLockView[] = rows.map((r) => ({
      lock_key: String(r.lock_key ?? ''),
      owner_token: String(r.owner_token ?? ''),
      acquired_at: String(r.acquired_at ?? ''),
      expires_at: String(r.expires_at ?? ''),
      is_expired: String(r.expires_at ?? '') < nowIso,
    }));
    return { degraded: false, locks };
  } catch (err) {
    logger.warn('settlement_lock_visibility_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { degraded: true, locks: [] };
  }
}
