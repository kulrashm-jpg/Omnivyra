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
