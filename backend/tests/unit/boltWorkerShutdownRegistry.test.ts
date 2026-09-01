/**
 * PHASE 168 — deployment safety: what a dying worker hands back.
 *
 * A Railway deploy terminated the worker mid-run. `worker.close()` drains
 * in-flight jobs, but a BOLT run takes minutes and no container grace period is
 * that long, so shutdown CANNOT guarantee completion. What it can guarantee is
 * that the claims this process holds are handed back, so the replacement worker
 * reclaims immediately instead of waiting out the lock TTL.
 *
 * That requires knowing WHICH runs this process owns, and with which token —
 * releasing by run id alone would let a dying worker clear a lock its
 * replacement had already legitimately taken.
 */

type Row = Record<string, unknown>;
const rows: Row[] = [];
let claimSucceeds = true;

function makeBuilder() {
  const eqs: Array<[string, unknown]> = [];
  let patch: Row | null = null;
  let isNullCol: string | null = null;

  const matches = (r: Row) =>
    eqs.every(([c, v]) => r[c] === v) &&
    (isNullCol === null || r[isNullCol] === null || r[isNullCol] === undefined);

  const b: Record<string, (...a: any[]) => any> = {
    update: (v: Row) => { patch = v; return b; },
    eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
    in: () => b,
    lt: () => Promise.resolve({ data: null, error: null }),
    is: (c: string, v: unknown) => { if (v === null) isNullCol = c; return b; },
    or: () => b,
    select: () => {
      const targets = claimSucceeds ? rows.filter(matches) : [];
      if (patch) for (const r of targets) Object.assign(r, patch);
      const result = { data: targets.map((r) => ({ id: r.id, lock_owner: r.lock_owner, lock_expires_at: r.lock_expires_at })), error: null };
      return Object.assign(Promise.resolve(result), {
        maybeSingle: async () => ({ data: result.data[0] ?? null, error: null }),
      });
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn(() => makeBuilder()) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(() => makeBuilder()) } }));

import {
  acquireRunLock,
  releaseRunLock,
  getHeldRunLocks,
  __resetHeldRunLocksForTests,
} from '../../services/boltExecutionLock';

beforeEach(() => {
  rows.length = 0;
  claimSucceeds = true;
  __resetHeldRunLocksForTests();
});

describe('the process tracks the claims it holds', () => {
  test('a successful acquire is registered with its token', async () => {
    rows.push({ id: 'run-1', lock_owner: null, lock_expires_at: null, status: 'running' });
    const lock = await acquireRunLock('run-1');
    expect(lock).not.toBeNull();
    const held = getHeldRunLocks();
    expect(held).toHaveLength(1);
    expect(held[0].runId).toBe('run-1');
    expect(held[0].token).toBe(lock!.token);
  });

  test('a FAILED acquire registers nothing — we do not own what we did not claim', async () => {
    rows.push({ id: 'run-1', lock_owner: 'someone-else', lock_expires_at: null, status: 'running' });
    claimSucceeds = false;
    expect(await acquireRunLock('run-1')).toBeNull();
    expect(getHeldRunLocks()).toHaveLength(0);
  });

  test('releasing deregisters, so shutdown does not re-release a finished run', async () => {
    rows.push({ id: 'run-1', lock_owner: null, lock_expires_at: null, status: 'running' });
    const lock = await acquireRunLock('run-1');
    await releaseRunLock('run-1', lock!.token);
    expect(getHeldRunLocks()).toHaveLength(0);
  });

  test('releasing with a FOREIGN token leaves our registration intact', async () => {
    rows.push({ id: 'run-1', lock_owner: null, lock_expires_at: null, status: 'running' });
    await acquireRunLock('run-1');
    await releaseRunLock('run-1', 'not-our-token');
    expect(getHeldRunLocks()).toHaveLength(1);
  });

  test('multiple concurrent runs are all tracked for shutdown', async () => {
    rows.push({ id: 'run-1', lock_owner: null, lock_expires_at: null, status: 'running' });
    rows.push({ id: 'run-2', lock_owner: null, lock_expires_at: null, status: 'running' });
    await acquireRunLock('run-1');
    await acquireRunLock('run-2');
    expect(getHeldRunLocks().map((h) => h.runId).sort()).toEqual(['run-1', 'run-2']);
  });

  test('tokens are distinct per run so one release cannot clear another', async () => {
    rows.push({ id: 'run-1', lock_owner: null, lock_expires_at: null, status: 'running' });
    rows.push({ id: 'run-2', lock_owner: null, lock_expires_at: null, status: 'running' });
    const a = await acquireRunLock('run-1');
    const b = await acquireRunLock('run-2');
    expect(a!.token).not.toBe(b!.token);
  });
});
