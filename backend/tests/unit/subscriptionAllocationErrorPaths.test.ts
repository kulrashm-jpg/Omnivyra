/**
 * MONEY unread-error sites (2026-11-12): subscription monthly allocation.
 *  - resolvePlanKey: a failed read was "no plan" -> a paying subscriber got no
 *    monthly credits, silently. Now throws.
 *  - the sweep's org list: a failed read was "no orgs". Now throws.
 *  - the sweep's per-org catch was completely silent; failures are now logged
 *    and counted (failed / failedOrgIds).
 *  - allocation status: a failed read was "nothing allocated this cycle".
 */
export {};
let mockFail: string | null = null;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const res = () => (mockFail === table ? { data: null, error: { message: 'down' } } : { data: table === 'organization_plan_assignments' ? [{ organization_id: 'o1' }] : null, error: null });
      const b: any = {};
      for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => (mockFail === table ? { data: null, error: { message: 'down' } } : { data: null, error: null });
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/creditExecutionService', () => ({ createCredit: jest.fn() }));

import { allocateMonthlyCreditsForOrg, runMonthlyAllocationSweep, getAllocationStatus } from '../../services/subscriptionAllocationService';

let errSpy: jest.SpyInstance;
beforeEach(() => { mockFail = null; errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

it('plan assignment read error THROWS (never "no plan" -> no monthly credits)', async () => {
  mockFail = 'organization_plan_assignments';
  await expect(allocateMonthlyCreditsForOrg({ orgId: 'o1', planKey: null } as never)).rejects.toThrow(/plan assignment read failed/);
});

it('control: a clean empty read is still no_plan', async () => {
  const r = await allocateMonthlyCreditsForOrg({ orgId: 'o1', planKey: null } as never);
  expect(r.status).toBe('no_plan');
});

it('sweep: org list read error THROWS (never "no subscribed orgs")', async () => {
  mockFail = 'organization_plan_assignments';
  await expect(runMonthlyAllocationSweep()).rejects.toThrow(/org list read failed/);
});

it('allocation status: history read error THROWS (never "nothing allocated this cycle")', async () => {
  mockFail = 'credit_transactions';
  await expect(getAllocationStatus('o1')).rejects.toThrow(/allocation history read failed/);
});
