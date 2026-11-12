/**
 * Subscription-credit expiry tests — terminated-only, free-pool only, paid/incentive preserved.
 */

import { expireSubscriptionCreditsForOrg, type ExpiryDeps } from '../../services/subscriptionCreditExpiryService';

const NOW = Date.parse('2026-06-25T00:00:00Z');
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function stub(opts: { sub: any | null; free: number | null; existingTxn?: boolean; allocFree?: number; priorExpiry?: boolean; priorExpiryErr?: boolean }, captured: { rpc: any[] }): ExpiryDeps {
  const allocFree = opts.allocFree ?? 1_000_000; // default: cap >= free so full free expires
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api: any = {
        select: () => api, order: () => api, limit: () => api, gte: (c: string, v: unknown) => { filters[`gte:${c}`] = v; return api; },
        eq: (c: string, v: unknown) => { filters[c] = v; return api; },
        maybeSingle: () => {
          if (table === 'organization_credits') return Promise.resolve({ data: opts.free != null ? { free_balance: opts.free, paid_balance: 50, incentive_balance: 10 } : null });
          if (table === 'credit_transactions') return Promise.resolve({ data: opts.existingTxn ? { id: 't' } : null });
          return Promise.resolve({ data: null });
        },
        then: (res: any) => {
          let data: any[] = [];
          if (table === 'billing_subscriptions') data = opts.sub ? [opts.sub] : [];
          else if (table === 'credit_transactions' && filters.reference_type === 'subscription_expiry') {
            // prior expiry by business identity (any key format)
            if (opts.priorExpiryErr) return Promise.resolve({ data: null, error: { message: 'down' } }).then(res);
            data = opts.priorExpiry ? [{ id: 'old-day-key-expiry' }] : [];
          }
          else if (table === 'credit_transactions') data = [{ id: 'alloc-1', created_at: '2026-06-24T00:00:00Z', free_delta: allocFree, credits_delta: allocFree }]; // subscription_allocation
          return Promise.resolve({ data }).then(res);
        },
      };
      return api;
    },
  };
  return { db: db as any, rpc: async (args) => { captured.rpc.push(args); return { error: null }; }, now: () => NOW };
}

const expiredSub = { status: 'active', current_period_end: iso(-10), trial_ends_at: null, cancel_at_period_end: false };
const canceledSub = { status: 'canceled', current_period_end: iso(20), trial_ends_at: null, cancel_at_period_end: false };
const activeSub = { status: 'active', current_period_end: iso(20), trial_ends_at: null, cancel_at_period_end: false };

describe('expireSubscriptionCreditsForOrg', () => {
  it('EXPIRED + free>0 → expires free pool via expire RPC (paid/incentive=0)', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 100 }, cap));
    expect(r).toMatchObject({ expired: 100, state: 'EXPIRED' });
    expect(cap.rpc[0]).toMatchObject({ p_phase: 'expire', p_free_amount: 100, p_paid_amount: 0, p_incentive_amount: 0, p_reference_type: 'subscription_expiry' });
  });
  it('CANCELED + free>0 → expires', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: canceledSub, free: 700 }, cap));
    expect(r.expired).toBe(700);
    expect(cap.rpc).toHaveLength(1);
  });
  it('ACTIVE → no expiry (not_terminated), no RPC', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: activeSub, free: 100 }, cap));
    expect(r).toMatchObject({ expired: 0, state: 'ACTIVE', reason: 'not_terminated' });
    expect(cap.rpc).toHaveLength(0);
  });
  it('NO_SUBSCRIPTION (legacy) → no expiry, no RPC', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: null, free: 100 }, cap));
    expect(r).toMatchObject({ expired: 0, state: 'NO_SUBSCRIPTION', reason: 'not_terminated' });
    expect(cap.rpc).toHaveLength(0);
  });
  it('terminated but free=0 → no_free_balance, no RPC', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 0 }, cap));
    expect(r).toMatchObject({ expired: 0, reason: 'no_free_balance' });
    expect(cap.rpc).toHaveLength(0);
  });
  it('idempotent: existing expiry txn → already_expired, no RPC', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 100, existingTxn: true }, cap));
    expect(r).toMatchObject({ expired: 0, reason: 'already_expired' });
    expect(cap.rpc).toHaveLength(0);
  });
  it('CAP: free=1000 but subscription allocated 700 → expires only 700 (signup 300 preserved)', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 1000, allocFree: 700 }, cap));
    expect(r.expired).toBe(700);
    expect(cap.rpc[0].p_free_amount).toBe(700);
  });
  it('no subscription allocation record → expires nothing (free is non-subscription)', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 300, allocFree: 0 }, cap));
    expect(r).toMatchObject({ expired: 0, reason: 'no_subscription_credits' });
    expect(cap.rpc).toHaveLength(0);
  });
});

// MONEY (2026-11-12): per-ALLOCATION idempotency + explicit read failures.
describe('subscription expiry - idempotency per allocation, never per day', () => {
  it('the same allocation produces the SAME key on consecutive days (day 2 cannot re-expire it)', async () => {
    const day1 = { rpc: [] as any[] };
    await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 500, allocFree: 200 }, day1));
    const day2deps = stub({ sub: expiredSub, free: 300, allocFree: 200 }, { rpc: [] as any[] });
    const day2 = { rpc: [] as any[] };
    await expireSubscriptionCreditsForOrg('org1', { ...day2deps, now: () => NOW + 86_400_000, rpc: async (a: any) => { day2.rpc.push(a); return { error: null }; } });
    expect(day1.rpc[0].p_idempotency_key).toBe(day2.rpc[0].p_idempotency_key);
  });

  it('day 2 with the expiry row present -> already_expired, nothing drained', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 300, allocFree: 200, existingTxn: true }, cap));
    expect(r.reason).toBe('already_expired');
    expect(cap.rpc).toHaveLength(0);
  });
});

describe('subscription expiry - read failures are explicit skips (nothing expired)', () => {
  function failing(table: string): ExpiryDeps {
    const base = stub({ sub: expiredSub, free: 100 }, { rpc: [] });
    return {
      ...base,
      db: {
        from(t: string) {
          const inner = (base.db as any).from(t);
          if (t !== table) return inner;
          const api: any = { select: () => api, eq: () => api, order: () => api, limit: () => api,
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }),
            then: (res: any) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res) };
          return api;
        },
      } as any,
    };
  }
  let spy: jest.SpyInstance;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it('wallet read error -> read_failed:wallet, no RPC', async () => {
    const d = failing('organization_credits');
    const calls: any[] = [];
    const r = await expireSubscriptionCreditsForOrg('org1', { ...d, rpc: async (a: any) => { calls.push(a); return { error: null }; } });
    expect(r.reason).toBe('read_failed:wallet');
    expect(calls).toHaveLength(0);
  });
});

// KEY-FORMAT CHANGE (2026-11-12): prod holds subscription_expiry rows written
// under the OLD per-day key (83/C16: 3 rows on 2026-06-24). The new per-allocation
// key cannot match them; the business-identity check must.
describe('subscription expiry - old-format expiries are honoured', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it('an allocation expired under the OLD per-day key is NOT expired again', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 500, allocFree: 200, priorExpiry: true }, cap));
    expect(r.reason).toBe('already_expired');
    expect(cap.rpc).toHaveLength(0);
  });
  it('prior-expiry read error -> read_failed:prior_expiry, nothing expired', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 500, allocFree: 200, priorExpiryErr: true }, cap));
    expect(r.reason).toBe('read_failed:prior_expiry');
    expect(cap.rpc).toHaveLength(0);
  });
  it('control: no prior expiry -> the allocation expires once', async () => {
    const cap = { rpc: [] as any[] };
    const r = await expireSubscriptionCreditsForOrg('org1', stub({ sub: expiredSub, free: 500, allocFree: 200 }, cap));
    expect(r.expired).toBe(200);
    expect(cap.rpc).toHaveLength(1);
  });
});
