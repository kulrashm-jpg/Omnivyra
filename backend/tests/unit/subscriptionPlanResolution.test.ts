/**
 * Deterministic plan resolution tests (priority A→B→C, fail-closed).
 */

import {
  extractPriceId,
  resolvePlanId,
  buildUpsertFromStripeSubscription,
  type StripeSubscriptionObject,
} from '../../services/billingSubscriptionService';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

// stub pricing_plans lookups: rows keyed by the eq() column/value used.
function db(plans: { id: string; plan_key?: string; provider_price_id?: string; is_active?: boolean }[]) {
  return {
    from() {
      let col = '', val: any, activeReq = false;
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => { if (c === 'is_active') activeReq = true; else { col = c; val = v; } return api; },
        maybeSingle: () => {
          const row = plans.find((p: any) => p[col] === val && (!activeReq || p.is_active !== false));
          return Promise.resolve({ data: row ? { id: row.id } : null });
        },
      };
      return api;
    },
  };
}
const deps = (plans: any[]) => ({ db: db(plans) as any });

describe('extractPriceId', () => {
  it('reads obj.plan.id then items[0].price.id', () => {
    expect(extractPriceId({ plan: { id: 'price_1' } })).toBe('price_1');
    expect(extractPriceId({ items: { data: [{ price: { id: 'price_2' } }] } })).toBe('price_2');
    expect(extractPriceId({})).toBeNull();
  });
});

describe('resolvePlanId — priority A → B → C, fail closed', () => {
  const plans = [
    { id: UUID_A, plan_key: 'growth', provider_price_id: 'price_growth', is_active: true },
    { id: UUID_B, plan_key: 'starter', provider_price_id: 'price_starter', is_active: true },
  ];
  it('A: explicit metadata.plan_id uuid (verified) wins', async () => {
    const r = await resolvePlanId({ metadata: { plan_id: UUID_A }, plan: { id: 'price_starter' } }, deps(plans));
    expect(r).toMatchObject({ planId: UUID_A, source: 'metadata' });
  });
  it('A ignored when uuid not a real plan → falls to B', async () => {
    const r = await resolvePlanId({ metadata: { plan_id: '99999999-9999-9999-9999-999999999999' }, plan: { id: 'price_starter' } }, deps(plans));
    expect(r).toMatchObject({ planId: UUID_B, source: 'price_map' });
  });
  it('B: stripe price_id → provider_price_id', async () => {
    expect(await resolvePlanId({ items: { data: [{ price: { id: 'price_growth' } }] } }, deps(plans))).toMatchObject({ planId: UUID_A, source: 'price_map' });
  });
  it('C: legacy metadata.plan_key → active plan', async () => {
    expect(await resolvePlanId({ metadata: { plan_key: 'starter' } }, deps(plans))).toMatchObject({ planId: UUID_B, source: 'legacy_plan_key' });
  });
  it('FAIL CLOSED: unknown price → null / unmapped_price', async () => {
    expect(await resolvePlanId({ plan: { id: 'price_unknown' } }, deps(plans))).toMatchObject({ planId: null, source: 'unmapped_price' });
  });
  it('FAIL CLOSED: nothing → null / none', async () => {
    expect(await resolvePlanId({ metadata: {} }, deps(plans))).toMatchObject({ planId: null, source: 'none' });
  });
});

describe('buildUpsert uses resolvedPlanId', () => {
  const base: StripeSubscriptionObject = { id: 'sub_1', status: 'active', current_period_start: 1, current_period_end: 2 };
  it('resolvedPlanId wins over metadata', () => {
    expect(buildUpsertFromStripeSubscription('x', { ...base, metadata: { plan_id: UUID_A } }, 'org', UUID_B)!.planId).toBe(UUID_B);
  });
  it('explicit null resolvedPlanId → null (fail closed propagated)', () => {
    expect(buildUpsertFromStripeSubscription('x', { ...base, metadata: { plan_id: UUID_A } }, 'org', null)!.planId).toBeNull();
  });
});
