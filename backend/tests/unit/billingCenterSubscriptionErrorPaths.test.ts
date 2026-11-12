/**
 * Unread-error sites (2026-11-12): Billing Center, Stripe subscription plan
 * resolution, subscription status expiry.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };

function db(script: Record<string, () => Res>) {
  return {
    from: (t: string) => {
      let op = 'select';
      const b: any = {};
      const result = () => (script[t + ':' + op] ?? (() => ({ data: null, error: null })))();
      for (const m of ['select', 'eq', 'in', 'lt', 'order', 'limit']) b[m] = () => b;
      b.update = () => { op = 'update'; return b; };
      b.maybeSingle = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  };
}
const DOWN = () => ({ data: null, error: { message: 'down' } });

import { resolvePlanId, markExpiredSubscriptions } from '../../services/billingSubscriptionService';

let errSpy: jest.SpyInstance;
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

it('plan resolution: a failed read is source read_failed - never "none" / "unmapped"', async () => {
  const r = await resolvePlanId({ items: { data: [{ price: { id: 'price_1' } }] }, metadata: {} } as never, { db: db({ 'pricing_plans:select': DOWN }) as never });
  expect(r).toMatchObject({ planId: null, source: 'read_failed' });
});

it('subscription expiry: candidate read error THROWS (never "nothing to expire")', async () => {
  await expect(markExpiredSubscriptions({ db: db({ 'billing_subscriptions:select': DOWN }) as never })).rejects.toThrow(/candidates read failed/);
});

it('subscription expiry: unread update is never reported as expired', async () => {
  const d = db({
    'billing_subscriptions:select': () => ({ data: [{ id: 's1' }], error: null }),
    'billing_subscriptions:update': DOWN,
  });
  await expect(markExpiredSubscriptions({ db: d as never })).rejects.toThrow(/expiry update failed/);
});

// MUTANT SURVIVORS (2026-11-12): resolvePlanId reads pricing_plans up to THREE
// times (by id, by provider_price_id, by plan_key); a table-keyed fake failed
// them all at once. This fake fails ONE read by its filter column, and the
// others answer with a real plan - so a skipped error check falls through to a
// later tier and returns a plan instead of read_failed.
function planDb(failCol: string) {
  return {
    from: () => {
      let col = '';
      const b: any = {
        select: () => b,
        eq: (c: string) => { if (!col) col = c; return b; },
        maybeSingle: async () => (col === failCol ? { data: null, error: { message: 'down' } } : { data: { id: `plan-by-${col}` }, error: null }),
      };
      return b;
    },
  };
}
it.each([
  ['metadata (by id)', 'id'],
  ['legacy plan_key', 'plan_key'],
])('plan resolution: the %s read failing ALONE -> read_failed (never a later tier\'s plan)', async (_l, col) => {
  const sub = col === 'id'
    ? { items: { data: [{ price: { id: 'price_1' } }] }, metadata: { plan_id: '11111111-1111-4111-8111-111111111111' } }
    : { items: { data: [] }, metadata: { plan_key: 'pro' } };
  const r = await resolvePlanId(sub as never, { db: planDb(col) as never });
  expect(r).toMatchObject({ planId: null, source: 'read_failed' });
});
