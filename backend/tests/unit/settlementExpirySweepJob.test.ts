/**
 * settlementExpirySweepJob — scheduled-runtime wrapper tests.
 *
 * Covers: scheduled execution, distributed-lock integration, overlapping-run
 * suppression across the shared lock, lock release, replay-safe repeated
 * execution, persistent-metric emission, and hidden-pricing preservation.
 * Dependency-injected — NO DB.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  runSettlementExpirySweepJob,
  SETTLEMENT_SWEEP_LOCK_KEY,
  type SweepJobRuntimeDeps,
} from '../../jobs/settlementExpirySweepJob';
import type { ExpirySweeperDeps } from '../../services/billing/payments/settlementExpirySweeper';
import {
  acquireSettlementLock,
  releaseSettlementLock,
  type LockBackend,
  type LockRow,
} from '../../services/billing/payments/settlementRuntimeLock';
import type { SettlementMetricName } from '../../services/billing/payments/settlementMetrics';

const NOW = 1_700_000_000_000;
const agoMin = (m: number) => new Date(NOW - m * 60_000).toISOString();
const CREATED_30M = { createdMaxAgeMs: 30 * 60_000 };

// ── in-memory sweeper store ─────────────────────────────────────────────────
interface Sess {
  idempotencyKey: string;
  provider: string;
  providerReference: string | null;
  settlementStatus: string;
  createdAt: string | null;
  lastReconciledAt: string | null;
}
function sess(over: Partial<Sess> = {}): Sess {
  return {
    idempotencyKey: 'idem-1', provider: 'razorpay', providerReference: 'order_1',
    settlementStatus: 'created', createdAt: agoMin(60), lastReconciledAt: null, ...over,
  };
}
function makeSweepDeps(seed: Sess[]) {
  const sessions = seed.map((s) => ({ ...s }));
  const events = new Set<string>();
  const transitions: any[] = [];
  let findCalled = false;
  const deps: Partial<ExpirySweeperDeps> = {
    findSettlementSweepCandidates: async () => {
      findCalled = true;
      return sessions
        .filter((s) => s.settlementStatus === 'created' || s.settlementStatus === 'pending')
        .map((s) => ({ ...s }));
    },
    recordSettlementEvent: async (i) => {
      const k = `${i.provider}:${i.providerEventId}`;
      if (events.has(k)) return { duplicate: true };
      events.add(k);
      return { duplicate: false };
    },
    applySettlementTransition: async (i) => {
      transitions.push(i);
      const s = sessions.find((x) => x.idempotencyKey === i.idempotencyKey);
      if (s) s.settlementStatus = i.settlementStatus;
    },
  };
  return { deps, transitions, wasFindCalled: () => findCalled };
}

// ── in-memory distributed lock + runtime ────────────────────────────────────
function memLockBackend() {
  const rows = new Map<string, LockRow>();
  const backend: LockBackend = {
    tryInsert: async (row) => {
      if (rows.has(row.lock_key)) return 'conflict';
      rows.set(row.lock_key, { ...row });
      return 'inserted';
    },
    tryClaimExpired: async (row, nowIso) => {
      const existing = rows.get(row.lock_key);
      if (!existing) return false;
      if (existing.expires_at < nowIso) { rows.set(row.lock_key, { ...row }); return true; }
      return false;
    },
    remove: async (lockKey, ownerToken) => {
      const existing = rows.get(lockKey);
      if (existing && existing.owner_token === ownerToken) rows.delete(lockKey);
    },
  };
  return { backend, rows };
}

function makeRuntime() {
  const { backend, rows } = memLockBackend();
  const metricCalls: Array<[SettlementMetricName, number]> = [];
  const rt: Partial<SweepJobRuntimeDeps> = {
    acquireLock: (key, opts) => acquireSettlementLock(key, { ...opts, backend }),
    releaseLock: (key, token) => releaseSettlementLock(key, token, { backend }),
    recordMetric: async (name, by = 1) => { metricCalls.push([name, by]); },
  };
  return { rt, lockRows: rows, metricCalls };
}

describe('expiry sweep job — scheduled execution', () => {
  test('the job acquires the lock, runs the sweeper, and returns ran:true', async () => {
    const { deps } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const { rt } = makeRuntime();
    const r = await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(r.ran).toBe(true);
    expect(r.candidates).toBe(1);
    expect(r.expired).toBe(1);
  });

  test('the lock is released after the run (next acquirer can proceed)', async () => {
    const { deps } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const { rt, lockRows } = makeRuntime();
    await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(lockRows.has(SETTLEMENT_SWEEP_LOCK_KEY)).toBe(false); // lease released
  });
});

describe('expiry sweep job — distributed-lock overlapping-run suppression', () => {
  test('a second job invocation while the lock is held → ran:false, no sweep', async () => {
    const a = makeSweepDeps([sess({ idempotencyKey: 'a', createdAt: agoMin(60) })]);
    const b = makeSweepDeps([sess({ idempotencyKey: 'b', createdAt: agoMin(60) })]);
    const { rt } = makeRuntime(); // ONE shared lock backend
    // Both invoked before the first awaits — the distributed lock must engage.
    const p1 = runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, a.deps, rt);
    const p2 = runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, b.deps, rt);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ran).toBe(true);
    expect(r2.ran).toBe(false);          // locked out
    expect(b.wasFindCalled()).toBe(false); // the locked-out run never scanned
  });

  test('a job whose lock acquisition fails returns ran:false and never sweeps', async () => {
    const { deps, wasFindCalled } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const rt: Partial<SweepJobRuntimeDeps> = {
      acquireLock: async () => ({ acquired: false, ownerToken: 'other-holder', degraded: false }),
      releaseLock: async () => {},
      recordMetric: async () => {},
    };
    const r = await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(r.ran).toBe(false);
    expect(wasFindCalled()).toBe(false);
  });
});

describe('expiry sweep job — replay-safe repeated execution', () => {
  test('running the job twice expires a stale session exactly once', async () => {
    const { deps, transitions } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const { rt } = makeRuntime();
    const first = await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    const second = await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);      // already expired → not a candidate
    expect(transitions).toHaveLength(1);
  });
});

describe('expiry sweep job — persistent metrics emission', () => {
  test('a run records candidates / expired / duplicate-suppression metrics', async () => {
    const { deps } = makeSweepDeps([
      sess({ idempotencyKey: 'a', createdAt: agoMin(60) }),
      sess({ idempotencyKey: 'b', providerReference: 'order_2', createdAt: agoMin(5) }),
    ]);
    const { rt, metricCalls } = makeRuntime();
    await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(metricCalls).toEqual([
      ['candidates_scanned', 2],
      ['sessions_expired', 1],
      ['duplicate_expiry_suppressions', 0],
    ]);
  });

  test('a locked-out run records no metrics', async () => {
    const { deps } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const metricCalls: Array<[SettlementMetricName, number]> = [];
    const rt: Partial<SweepJobRuntimeDeps> = {
      acquireLock: async () => ({ acquired: false, ownerToken: 'x', degraded: false }),
      releaseLock: async () => {},
      recordMetric: async (n, by = 1) => { metricCalls.push([n, by]); },
    };
    await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    expect(metricCalls).toHaveLength(0);
  });
});

describe('expiry sweep job — hidden-pricing preservation', () => {
  test('the job report carries no pricing fields', async () => {
    const { deps } = makeSweepDeps([sess({ createdAt: agoMin(60) })]);
    const { rt } = makeRuntime();
    const r = await runSettlementExpirySweepJob({ nowMs: NOW, policy: CREATED_30M }, deps, rt);
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
