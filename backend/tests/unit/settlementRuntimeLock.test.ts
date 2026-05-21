/**
 * settlementRuntimeLock — distributed lease-lock tests.
 *
 * Covers: lock acquisition, overlapping-run suppression, stale-lock recovery,
 * release semantics, fail-open behavior, and deterministic acquisition. The
 * lock backend is dependency-injected — NO DB.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  acquireSettlementLock,
  releaseSettlementLock,
  listSettlementLocks,
  type LockBackend,
  type LockRow,
  type LockVisibilityBackend,
} from '../../services/billing/payments/settlementRuntimeLock';

/** In-memory lock backend with the same compare-and-swap semantics as the
 *  supabase-backed default. */
function memLockBackend() {
  const rows = new Map<string, LockRow>();
  let unavailable = false;
  const backend: LockBackend = {
    tryInsert: async (row) => {
      if (unavailable) return 'unavailable';
      if (rows.has(row.lock_key)) return 'conflict';
      rows.set(row.lock_key, { ...row });
      return 'inserted';
    },
    tryClaimExpired: async (row, nowIso) => {
      const existing = rows.get(row.lock_key);
      if (!existing) return false;
      if (existing.expires_at < nowIso) {
        rows.set(row.lock_key, { ...row }); // CAS — reclaim the expired lease
        return true;
      }
      return false;
    },
    remove: async (lockKey, ownerToken) => {
      const existing = rows.get(lockKey);
      if (existing && existing.owner_token === ownerToken) rows.delete(lockKey);
    },
  };
  return { backend, rows, makeUnavailable: () => { unavailable = true; } };
}

describe('runtime lock — acquisition', () => {
  test('a lock acquired on an empty table → acquired, non-degraded, owner token issued', async () => {
    const { backend } = memLockBackend();
    const r = await acquireSettlementLock('sweep', { backend, nowMs: 1_000 });
    expect(r.acquired).toBe(true);
    expect(r.degraded).toBe(false);
    expect(typeof r.ownerToken).toBe('string');
    expect(r.ownerToken.length).toBeGreaterThan(0);
  });

  test('distinct acquisitions get distinct owner tokens', async () => {
    const { backend } = memLockBackend();
    const a = await acquireSettlementLock('k1', { backend });
    const b = await acquireSettlementLock('k2', { backend });
    expect(a.ownerToken).not.toBe(b.ownerToken);
  });
});

describe('runtime lock — overlapping-run suppression', () => {
  test('a second acquisition while the lease is held (fresh) → not acquired', async () => {
    const { backend } = memLockBackend();
    const first = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 });
    const second = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 2_000 });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);   // held elsewhere → overlapping run suppressed
  });

  test('acquisition outcome is deterministic — first wins, the rest lose', async () => {
    const { backend } = memLockBackend();
    const results = [
      await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 }),
      await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 }),
      await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 }),
    ];
    expect(results.map((r) => r.acquired)).toEqual([true, false, false]);
  });
});

describe('runtime lock — stale-lock recovery', () => {
  test('an expired lease is reclaimed by the next acquirer', async () => {
    const { backend, rows } = memLockBackend();
    const first = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 1_000 });
    // Before expiry (lease expires at 2 000) — blocked.
    const blocked = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 1_500 });
    // After expiry — reclaimed.
    const reclaimed = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 3_000 });
    expect(first.acquired).toBe(true);
    expect(blocked.acquired).toBe(false);
    expect(reclaimed.acquired).toBe(true);
    expect(rows.get('sweep')!.owner_token).toBe(reclaimed.ownerToken); // ownership transferred
  });

  test('after a stale reclaim the original holder no longer owns the lease', async () => {
    const { backend } = memLockBackend();
    const original = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 1_000 });
    const reclaimed = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 5_000 });
    // The original holder's release is a no-op (token no longer matches).
    await releaseSettlementLock('sweep', original.ownerToken, { backend });
    const blocked = await acquireSettlementLock('sweep', { backend, ttlMs: 1_000, nowMs: 5_500 });
    expect(reclaimed.acquired).toBe(true);
    expect(blocked.acquired).toBe(false); // the reclaimer's fresh lease still holds
  });
});

describe('runtime lock — release', () => {
  test('releasing a held lease lets the next acquirer in', async () => {
    const { backend } = memLockBackend();
    const first = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 });
    await releaseSettlementLock('sweep', first.ownerToken, { backend });
    const second = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 2_000 });
    expect(second.acquired).toBe(true);
  });

  test('a release with a non-matching owner token is a no-op (lease preserved)', async () => {
    const { backend } = memLockBackend();
    const held = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 1_000 });
    await releaseSettlementLock('sweep', 'not-the-owner', { backend });
    const blocked = await acquireSettlementLock('sweep', { backend, ttlMs: 60_000, nowMs: 2_000 });
    expect(held.acquired).toBe(true);
    expect(blocked.acquired).toBe(false); // wrong-owner release did NOT free the lease
  });

  test('releasing an absent lease never throws', async () => {
    const { backend } = memLockBackend();
    await expect(releaseSettlementLock('never-locked', 'token', { backend })).resolves.toBeUndefined();
  });
});

describe('runtime lock — fail-open when the lock table is unavailable', () => {
  test('an unavailable lock backend → acquired:true, degraded:true', async () => {
    const { backend, makeUnavailable } = memLockBackend();
    makeUnavailable();
    const r = await acquireSettlementLock('sweep', { backend });
    expect(r.acquired).toBe(true);   // fail-open — the job still runs
    expect(r.degraded).toBe(true);
  });

  test('a backend that throws → fail-open acquired:true, degraded:true', async () => {
    const throwingBackend: LockBackend = {
      tryInsert: async () => { throw new Error('connection reset'); },
      tryClaimExpired: async () => false,
      remove: async () => {},
    };
    const r = await acquireSettlementLock('sweep', { backend: throwingBackend });
    expect(r.acquired).toBe(true);
    expect(r.degraded).toBe(true);
  });
});

describe('runtime lock — operational visibility', () => {
  const lockRow = (over: Partial<LockRow> = {}): LockRow => ({
    lock_key: 'settlement_expiry_sweep',
    owner_token: 'owner-abc',
    acquired_at: new Date(1_000).toISOString(),
    expires_at: new Date(900_000).toISOString(),
    ...over,
  });
  const visBackend = (available: boolean, rows: LockRow[]): LockVisibilityBackend => ({
    readLocks: async () => ({ available, rows }),
  });

  test('surfaces the holder, acquired_at, expires_at for each lease', async () => {
    const v = await listSettlementLocks({
      nowMs: 500_000, backend: visBackend(true, [lockRow()]),
    });
    expect(v.degraded).toBe(false);
    expect(v.locks).toHaveLength(1);
    expect(v.locks[0]).toMatchObject({
      lock_key: 'settlement_expiry_sweep',
      owner_token: 'owner-abc',
      acquired_at: new Date(1_000).toISOString(),
      expires_at: new Date(900_000).toISOString(),
    });
  });

  test('is_expired reflects the lease against now', async () => {
    const fresh = await listSettlementLocks({ nowMs: 500_000, backend: visBackend(true, [lockRow()]) });
    const stale = await listSettlementLocks({ nowMs: 1_000_000, backend: visBackend(true, [lockRow()]) });
    expect(fresh.locks[0].is_expired).toBe(false); // now 500k < expiry 900k
    expect(stale.locks[0].is_expired).toBe(true);  // now 1 000k > expiry 900k
  });

  test('an unavailable lock table → degraded:true, empty locks', async () => {
    const v = await listSettlementLocks({ nowMs: 500_000, backend: visBackend(false, []) });
    expect(v.degraded).toBe(true);
    expect(v.locks).toEqual([]);
  });

  test('a throwing visibility backend → degraded:true (never throws)', async () => {
    const throwing: LockVisibilityBackend = {
      readLocks: async () => { throw new Error('db down'); },
    };
    const v = await listSettlementLocks({ nowMs: 500_000, backend: throwing });
    expect(v.degraded).toBe(true);
    expect(v.locks).toEqual([]);
  });

  test('no locks held → not degraded, empty list', async () => {
    const v = await listSettlementLocks({ nowMs: 500_000, backend: visBackend(true, []) });
    expect(v.degraded).toBe(false);
    expect(v.locks).toEqual([]);
  });

  test('lock visibility carries no pricing fields', async () => {
    const v = await listSettlementLocks({ nowMs: 500_000, backend: visBackend(true, [lockRow()]) });
    const serialized = JSON.stringify(v).toLowerCase();
    for (const f of ['amount', 'price', 'pricing', 'revenue', 'invoice']) {
      expect(serialized).not.toContain(f);
    }
  });
});
