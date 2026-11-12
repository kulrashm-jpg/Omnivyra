/**
 * Unread-error sites with a DOCUMENTED fail-open policy (2026-11-12).
 *
 * resolveTopupEntitlement / resolveSubscriptionState deliberately fail open on a
 * read error (never break paid-credit usage or allocation on a transient
 * error). The supabase `.error` was never read, so the policy was reached
 * SILENTLY - indistinguishable from "no subscription row". Now the policy is
 * explicit and logged; the answers are unchanged (pinned here). Whether the
 * policy itself is right is an owner question (raised to e9).
 */
export {};
import { resolveTopupEntitlement, resolveSubscriptionState } from '../../services/subscriptionStateResolver';

type Res = { data?: unknown; error: { message: string } | null };
function db(script: Record<string, Res>) {
  return {
    from: (t: string) => {
      const r = script[t] ?? { data: null, error: null };
      const b: any = {};
      for (const m of ['select', 'eq', 'order']) b[m] = () => b;
      b.limit = async () => r;
      b.maybeSingle = async () => r;
      return b;
    },
  };
}
const DOWN: Res = { data: null, error: { message: 'down' } };
let errSpy: jest.SpyInstance;
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

it('topup entitlement: read error -> usable (policy, unchanged) AND logged (no longer silent)', async () => {
  const r = await resolveTopupEntitlement('o1', { db: db({ billing_subscriptions: DOWN }) });
  expect(r).toEqual({ usable: true, state: 'NO_SUBSCRIPTION' });
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('fail-open by policy'))).toBe(true);
});

it('subscription state: subscription read error -> the documented legacy policy (plan assignment -> ACTIVE), logged', async () => {
  const r = await resolveSubscriptionState('o1', {
    db: db({ billing_subscriptions: DOWN, organization_plan_assignments: { data: { organization_id: 'o1' }, error: null } }),
  });
  expect(r).toBe('ACTIVE');
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('legacy policy applied'))).toBe(true);
});

it('subscription state: both reads fail -> EXPIRED (legacy policy), logged, never throws', async () => {
  const r = await resolveSubscriptionState('o1', { db: db({ billing_subscriptions: DOWN, organization_plan_assignments: DOWN }) });
  expect(r).toBe('EXPIRED');
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('plan assignment read failed'))).toBe(true);
});

it('control: clean reads log nothing', async () => {
  await resolveTopupEntitlement('o1', { db: db({ billing_subscriptions: { data: [], error: null } }) });
  expect(errSpy).not.toHaveBeenCalled();
});
