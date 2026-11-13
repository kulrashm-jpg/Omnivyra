/**
 * Subscription lifecycle write-path tests. Pure helpers + db-stubbed writers.
 */

import {
  mapStripeStatus,
  buildUpsertFromStripeSubscription,
  upsertBillingSubscription,
  applyStripeSubscriptionEvent,
  markExpiredSubscriptions,
  type StripeSubscriptionObject,
} from '../../services/billingSubscriptionService';
import { resolveSubscriptionStateFrom } from '../../services/subscriptionStateResolver';

const NOW = Date.parse('2026-06-24T00:00:00Z');
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('mapStripeStatus', () => {
  it('maps provider statuses', () => {
    expect(mapStripeStatus('trialing')).toBe('trialing');
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('past_due');
    expect(mapStripeStatus('incomplete')).toBe('past_due');
    expect(mapStripeStatus('paused')).toBe('paused');
    expect(mapStripeStatus('canceled')).toBe('canceled');
    expect(mapStripeStatus('incomplete_expired')).toBe('expired');
    expect(mapStripeStatus('weird')).toBe('active');
  });
});

describe('buildUpsertFromStripeSubscription', () => {
  const obj: StripeSubscriptionObject = {
    id: 'sub_123', status: 'active',
    current_period_start: sec('2026-06-01T00:00:00Z'),
    current_period_end: sec('2026-07-01T00:00:00Z'),
    cancel_at_period_end: false,
  };
  it('builds a valid upsert input', () => {
    const u = buildUpsertFromStripeSubscription('customer.subscription.updated', obj, 'org1')!;
    expect(u.providerSubscriptionId).toBe('sub_123');
    expect(u.status).toBe('active');
    expect(u.currentPeriodEnd).toBe('2026-07-01T00:00:00.000Z');
    expect(u.autoRenew).toBe(true);
    expect(u.planId).toBeNull();
  });
  it('deleted event forces CANCELED', () => {
    expect(buildUpsertFromStripeSubscription('customer.subscription.deleted', obj, 'org1')!.status).toBe('canceled');
  });
  it('cancel_at_period_end → autoRenew false', () => {
    expect(buildUpsertFromStripeSubscription('customer.subscription.updated', { ...obj, cancel_at_period_end: true }, 'org1')!.autoRenew).toBe(false);
  });
  it('missing period → null', () => {
    expect(buildUpsertFromStripeSubscription('x', { id: 'sub_1', status: 'active' }, 'org1')).toBeNull();
  });
  it('only accepts a uuid plan_id from metadata', () => {
    const withPlan = { ...obj, metadata: { plan_id: '11111111-1111-1111-1111-111111111111' } };
    expect(buildUpsertFromStripeSubscription('x', withPlan, 'org1')!.planId).toBe('11111111-1111-1111-1111-111111111111');
    expect(buildUpsertFromStripeSubscription('x', { ...obj, metadata: { plan_id: 'growth' } }, 'org1')!.planId).toBeNull();
  });
});

// minimal supabase stub
function dbStub(opts: { selectRows?: any[]; updateError?: { message: string }; updateRows?: any[] }, captured: { upserts: any[]; updates: any[] }) {
  return {
    from() {
      const api: any = {
        upsert: (row: any, o: any) => { captured.upserts.push({ row, onConflict: o?.onConflict }); return Promise.resolve({ error: null }); },
        select: () => api,
        in: () => api,
        lt: () => api,
        // The update returns the rows it ACTUALLY changed (.select('id')) - by default every id it was given;
        // updateRows models a partial update, updateError a failed one (B5: the result must be read).
        update: (row: any) => {
          captured.updates.push({ row });
          return {
            in: (_col: string, ids: string[]) => ({
              select: () => Promise.resolve(opts.updateError
                ? { data: null, error: opts.updateError }
                : { data: opts.updateRows ?? ids.map((id) => ({ id })), error: null }),
            }),
          };
        },
        then: (resolve: any) => Promise.resolve({ data: opts.selectRows ?? [], error: null }).then(resolve),
      };
      return api;
    },
  };
}

describe('upsertBillingSubscription', () => {
  it('upserts with the conflict key', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const res = await upsertBillingSubscription(
      { organizationId: 'org1', provider: 'stripe', providerSubscriptionId: 'sub_1', planId: null, status: 'active', currentPeriodStart: '2026-06-01T00:00:00Z', currentPeriodEnd: '2026-07-01T00:00:00Z', trialEndsAt: null, cancelAtPeriodEnd: false, autoRenew: true },
      { db: dbStub({}, captured) as any, now: () => NOW },
    );
    expect(res.ok).toBe(true);
    expect(captured.upserts[0].onConflict).toBe('provider,provider_subscription_id');
    expect(captured.upserts[0].row.status).toBe('active');
  });
});

describe('applyStripeSubscriptionEvent', () => {
  it('no org → not applied', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const r = await applyStripeSubscriptionEvent('customer.subscription.updated', { id: 'sub_1' }, null, { db: dbStub({}, captured) as any });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('no_org');
  });
  it('valid event → upserts ledger row', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const obj = { id: 'sub_9', status: 'active', current_period_start: sec('2026-06-01T00:00:00Z'), current_period_end: sec('2026-07-01T00:00:00Z') };
    const r = await applyStripeSubscriptionEvent('customer.subscription.updated', obj, 'org1', { db: dbStub({}, captured) as any });
    expect(r.applied).toBe(true);
    expect(captured.upserts).toHaveLength(1);
  });
});

describe('markExpiredSubscriptions', () => {
  it('expires lapsed rows past period+grace', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const db = dbStub({ selectRows: [{ id: 'a' }, { id: 'b' }] }, captured);
    const r = await markExpiredSubscriptions({ db: db as any, now: () => NOW });
    expect(r.expired).toBe(2);
    expect(captured.updates[0].row.status).toBe('expired');
  });
  it('B5: a FAILED expire update throws - it never reports subscriptions expired that are still active', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const db = dbStub({ selectRows: [{ id: 'a' }, { id: 'b' }], updateError: { message: 'connection reset' } }, captured);
    await expect(markExpiredSubscriptions({ db: db as any, now: () => NOW })).rejects.toThrow(/expire update failed for 2 subscription\(s\): connection reset/);
    // e1 F4: typed refusal { code, retryable }
    await expect(markExpiredSubscriptions({ db: db as any, now: () => NOW })).rejects.toMatchObject({ name: 'SubscriptionExpiryWriteError', code: 'SUBSCRIPTION_EXPIRE_FAILED', retryable: true });
  });
  it('B5: expired = the rows ACTUALLY updated, not the rows selected', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const db = dbStub({ selectRows: [{ id: 'a' }, { id: 'b' }], updateRows: [{ id: 'b' }] }, captured);
    const r = await markExpiredSubscriptions({ db: db as any, now: () => NOW });
    expect(r).toEqual({ expired: 1, ids: ['b'] });
  });
  it('no lapsed rows → 0', async () => {
    const captured = { upserts: [] as any[], updates: [] as any[] };
    const r = await markExpiredSubscriptions({ db: dbStub({ selectRows: [] }, captured) as any, now: () => NOW });
    expect(r.expired).toBe(0);
    expect(captured.updates).toHaveLength(0);
  });
});

describe('end-to-end with resolver (built row → state)', () => {
  it('active future period → ACTIVE; deleted → CANCELED', () => {
    const active = buildUpsertFromStripeSubscription('customer.subscription.updated', { id: 's', status: 'active', current_period_start: sec('2026-06-01T00:00:00Z'), current_period_end: sec('2026-07-01T00:00:00Z') }, 'org1')!;
    expect(resolveSubscriptionStateFrom({ subscription: { status: active.status, current_period_end: active.currentPeriodEnd, trial_ends_at: active.trialEndsAt, cancel_at_period_end: active.cancelAtPeriodEnd }, hasPlanAssignment: false, nowMs: NOW })).toBe('ACTIVE');
    const canceled = buildUpsertFromStripeSubscription('customer.subscription.deleted', { id: 's', status: 'active', current_period_start: sec('2026-06-01T00:00:00Z'), current_period_end: sec('2026-07-01T00:00:00Z') }, 'org1')!;
    expect(resolveSubscriptionStateFrom({ subscription: { status: canceled.status, current_period_end: canceled.currentPeriodEnd, trial_ends_at: null, cancel_at_period_end: false }, hasPlanAssignment: false, nowMs: NOW })).toBe('CANCELED');
  });
});
