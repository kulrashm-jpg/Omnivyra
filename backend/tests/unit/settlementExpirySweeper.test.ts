/**
 * settlementExpirySweeper — deterministic stale-session expiry tests.
 *
 * Covers: expiry transition correctness, freshness threshold, idempotency
 * (re-sweep + append-only event collision), terminal-state preservation,
 * provider-agnostic behavior, the configurable expiry policy, append-only
 * event behavior, provider_event_reference preservation, and hidden-pricing
 * preservation. The sweeper is dependency-injected — NO DB.
 */

// Inert supabase mock — the sweeper transitively imports the store.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  sweepStaleSettlements,
  resolveExpiryPolicy,
  type ExpirySweeperDeps,
} from '../../services/billing/payments/settlementExpirySweeper';

const NOW = 1_700_000_000_000;
const agoMin = (m: number) => new Date(NOW - m * 60_000).toISOString();

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
    settlementStatus: 'created', createdAt: agoMin(40), lastReconciledAt: null, ...over,
  };
}

interface StoreHandle {
  deps: Partial<ExpirySweeperDeps>;
  sessions: Sess[];
  recordedEvents: any[];
  transitions: any[];
}
function makeStore(seed: Sess[], opts: { statelessApply?: boolean } = {}): StoreHandle {
  const sessions = seed.map((s) => ({ ...s }));
  const recordedEvents: any[] = [];
  const eventKeys = new Set<string>();
  const transitions: any[] = [];
  const deps: Partial<ExpirySweeperDeps> = {
    findSettlementSweepCandidates: async () =>
      sessions
        .filter((s) => s.settlementStatus === 'created' || s.settlementStatus === 'pending')
        .map((s) => ({ ...s })),
    recordSettlementEvent: async (input) => {
      const k = `${input.provider}:${input.providerEventId}`;
      if (eventKeys.has(k)) return { duplicate: true };
      eventKeys.add(k);
      recordedEvents.push(input);
      return { duplicate: false };
    },
    applySettlementTransition: async (input) => {
      transitions.push(input);
      if (opts.statelessApply) return; // simulate migration-unapplied no-op
      const s = sessions.find((x) => x.idempotencyKey === input.idempotencyKey);
      if (s) s.settlementStatus = input.settlementStatus;
    },
  };
  return { deps, sessions, recordedEvents, transitions };
}

describe('expiry sweeper — transition correctness', () => {
  test('a stale `created` session is transitioned to `expired`', async () => {
    const store = makeStore([sess({ settlementStatus: 'created', createdAt: agoMin(40) })]);
    const r = await sweepStaleSettlements(
      { nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(r.expired).toBe(1);
    expect(r.candidates).toBe(1);
    expect(r.expiredKeys).toEqual(['idem-1']);
    expect(store.transitions[0].settlementStatus).toBe('expired');
    expect(store.sessions[0].settlementStatus).toBe('expired');
  });

  test('a stale `pending` session is transitioned to `expired`', async () => {
    const store = makeStore([sess({
      idempotencyKey: 'idem-p', settlementStatus: 'pending', lastReconciledAt: agoMin(150),
    })]);
    const r = await sweepStaleSettlements(
      { nowMs: NOW, policy: { pendingMaxAgeMs: 120 * 60_000 } }, store.deps);
    expect(r.expired).toBe(1);
    expect(store.transitions[0].settlementStatus).toBe('expired');
  });

  test('the age anchor is last_reconciled_at when present (recent activity = fresh)', async () => {
    // Created long ago, but reconciled 10 min ago → still fresh under a 120m window.
    const store = makeStore([sess({
      settlementStatus: 'pending', createdAt: agoMin(500), lastReconciledAt: agoMin(10),
    })]);
    const r = await sweepStaleSettlements(
      { nowMs: NOW, policy: { pendingMaxAgeMs: 120 * 60_000 } }, store.deps);
    expect(r.expired).toBe(0);
    expect(r.skipped).toBe(1);
  });

  test('a fresh session within the threshold is NOT expired', async () => {
    const store = makeStore([sess({ createdAt: agoMin(10) })]);
    const r = await sweepStaleSettlements(
      { nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(r.expired).toBe(0);
    expect(r.skipped).toBe(1);
    expect(store.transitions).toHaveLength(0);
  });
});

describe('expiry sweeper — idempotency', () => {
  test('re-running the sweep does not re-expire an already-expired session', async () => {
    const store = makeStore([sess({ createdAt: agoMin(40) })]);
    const first = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    const second = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);       // already expired → not a candidate
    expect(second.candidates).toBe(0);
    expect(store.transitions).toHaveLength(1);
  });

  test('the deterministic expiry event id makes a re-sweep a safe no-op even in degraded mode', async () => {
    // statelessApply simulates the migration being unapplied — the state write
    // is a no-op, so the session keeps reappearing as a candidate. The
    // append-only event ledger collision still prevents a second transition.
    const store = makeStore([sess({ createdAt: agoMin(40) })], { statelessApply: true });
    const first = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    const second = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);       // duplicate event id → skipped
    expect(store.transitions).toHaveLength(1);
    expect(store.recordedEvents).toHaveLength(1);
  });
});

describe('expiry sweeper — terminal-state preservation', () => {
  test('succeeded / failed / cancelled sessions are never candidates, never touched', async () => {
    const store = makeStore([
      sess({ idempotencyKey: 'k-ok', settlementStatus: 'succeeded' }),
      sess({ idempotencyKey: 'k-fail', settlementStatus: 'failed' }),
      sess({ idempotencyKey: 'k-cancel', settlementStatus: 'cancelled' }),
      sess({ idempotencyKey: 'k-stale', settlementStatus: 'created', createdAt: agoMin(60) }),
    ]);
    const r = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(r.candidates).toBe(1);          // only the created session
    expect(r.expiredKeys).toEqual(['k-stale']);
    expect(store.sessions.find((s) => s.idempotencyKey === 'k-ok')!.settlementStatus).toBe('succeeded');
    expect(store.sessions.find((s) => s.idempotencyKey === 'k-fail')!.settlementStatus).toBe('failed');
    expect(store.sessions.find((s) => s.idempotencyKey === 'k-cancel')!.settlementStatus).toBe('cancelled');
  });

  test('defense-in-depth: a terminal session wrongly returned as a candidate is skipped', async () => {
    const transitions: any[] = [];
    const deps: Partial<ExpirySweeperDeps> = {
      // A faulty finder returns a `succeeded` session — the canTransition guard
      // must still refuse to regress it.
      findSettlementSweepCandidates: async () => [{
        idempotencyKey: 'k-bad', provider: 'stripe', providerReference: 'pi_1',
        settlementStatus: 'succeeded', createdAt: agoMin(999), lastReconciledAt: null,
      }],
      recordSettlementEvent: async () => ({ duplicate: false }),
      applySettlementTransition: async (input) => { transitions.push(input); },
    };
    const r = await sweepStaleSettlements({ nowMs: NOW }, deps);
    expect(r.expired).toBe(0);
    expect(transitions).toHaveLength(0);
  });
});

describe('expiry sweeper — provider-agnostic behavior', () => {
  test('stale sessions across all four providers expire uniformly', async () => {
    const store = makeStore(
      (['razorpay', 'stripe', 'cashfree', 'phonepe'] as const).map((p) =>
        sess({ idempotencyKey: `k-${p}`, provider: p, createdAt: agoMin(90) })),
    );
    const r = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(r.expired).toBe(4);
    expect(store.recordedEvents.map((e) => e.normalizedStatus)).toEqual(['expired', 'expired', 'expired', 'expired']);
  });
});

describe('expiry sweeper — append-only + persistence behavior', () => {
  test('every expiry writes one normalized append-only event', async () => {
    const store = makeStore([sess({ createdAt: agoMin(40) })]);
    await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    expect(store.recordedEvents).toHaveLength(1);
    expect(store.recordedEvents[0].normalizedStatus).toBe('expired');
    expect(store.recordedEvents[0].eventType).toBe('settlement.expired');
  });

  test('the transition omits provider_event_reference (an existing one is preserved)', async () => {
    const store = makeStore([sess({ createdAt: agoMin(40) })]);
    await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    const t = store.transitions[0];
    expect(t.providerEventReference).toBeUndefined();   // preserved, not overwritten
    expect(t.providerRawStatus).toBe('sweeper_expiry');
    expect(t.settledAt).toBeNull();                     // expiry is not a settlement
    expect(t.settlementStatus).toBe('expired');
  });
});

describe('expiry sweeper — expiry policy', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SETTLEMENT_EXPIRY_CREATED_MINUTES;
    delete process.env.SETTLEMENT_EXPIRY_PENDING_MINUTES;
  });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  test('default policy: 30m created, 120m pending', () => {
    const p = resolveExpiryPolicy();
    expect(p.createdMaxAgeMs).toBe(30 * 60_000);
    expect(p.pendingMaxAgeMs).toBe(120 * 60_000);
  });
  test('policy thresholds are env-configurable', () => {
    process.env.SETTLEMENT_EXPIRY_CREATED_MINUTES = '5';
    process.env.SETTLEMENT_EXPIRY_PENDING_MINUTES = '45';
    const p = resolveExpiryPolicy();
    expect(p.createdMaxAgeMs).toBe(5 * 60_000);
    expect(p.pendingMaxAgeMs).toBe(45 * 60_000);
  });
  test('an explicit override wins over env / defaults', () => {
    process.env.SETTLEMENT_EXPIRY_CREATED_MINUTES = '5';
    const p = resolveExpiryPolicy({ createdMaxAgeMs: 1_000 });
    expect(p.createdMaxAgeMs).toBe(1_000);
  });
});

describe('expiry sweeper — hidden-pricing preservation', () => {
  test('the sweep result and persisted transitions carry NO pricing fields', async () => {
    const store = makeStore([sess({ createdAt: agoMin(40) })]);
    const r = await sweepStaleSettlements({ nowMs: NOW, policy: { createdMaxAgeMs: 30 * 60_000 } }, store.deps);
    const serialized = JSON.stringify({ r, transitions: store.transitions }).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
