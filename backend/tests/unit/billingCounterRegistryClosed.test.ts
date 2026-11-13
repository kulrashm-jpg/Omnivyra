/**
 * 83 2026-11-13: the billing counter registry is a CLOSED set at compile time. Under `Record<string, number>`
 * BillingCounter resolved to `string`, so two unregistered route-wiring counters compiled through three CI runs.
 * The @ts-expect-error lines are the NEGATIVE control: if BillingCounter widens back to `string`, they become unused
 * directives and the backend-tests typecheck FAILS (TS2578). Never executed at runtime.
 */
import { incrCounter, getCounter, snapshotBillingMetrics, type BillingCounter } from '../../services/billing/billingMetrics';

function neverCalled(): void {
  // @ts-expect-error - an unregistered counter name must not compile
  incrCounter('not_a_registered_counter_total');
  // @ts-expect-error - an unregistered counter name must not compile
  getCounter('not_a_registered_counter_total');
}
void neverCalled;

it('registered names compile and are exported in the snapshot', () => {
  const names: BillingCounter[] = ['phase2_route_without_idempotency_key_total', 'phase2_route_reclaim_cap_exhausted_total'];
  for (const n of names) expect(snapshotBillingMetrics()).toHaveProperty(n);
});
