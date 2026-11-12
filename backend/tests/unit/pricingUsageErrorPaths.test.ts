/**
 * Unread-error sites (2026-11-12): plan pricing, cost anomalies.
 *  - getPlanPricing: a failed read was "no plan pricing"; now throws.
 *  - recordCostAnomaly: the insert error was unread (anomalies lost
 *    silently); now logged, never thrown.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockFail: string | null = null;
function builder(table: string) {
  const b: any = {};
  const result = (): Res => (mockFail === table ? { data: null, error: { message: 'down' } } : { data: [], error: null });
  for (const m of ['select', 'eq', 'is', 'in']) b[m] = () => b;
  b.insert = () => b;
  b.update = () => b;
  b.maybeSingle = async () => result();
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));

import { getPlanPricing } from '../../services/pricingConfigService';
import { recordCostAnomaly } from '../../services/pricingService';

let errSpy: jest.SpyInstance;
beforeEach(() => { mockFail = null; errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

it('plan pricing: read error THROWS (never "no plan pricing")', async () => {
  mockFail = 'billing_plan_pricing';
  await expect(getPlanPricing()).rejects.toThrow(/plan pricing read failed/);
});
it('plan pricing control: clean read returns rows', async () => {
  await expect(getPlanPricing()).resolves.toEqual([]);
});
it('cost anomaly: insert error is logged, never thrown', async () => {
  mockFail = 'cost_anomalies';
  await expect(recordCostAnomaly({ type: 'unknown_action_key', actionKey: 'x' } as never)).resolves.toBeUndefined();
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('cost anomaly record failed'))).toBe(true);
});
