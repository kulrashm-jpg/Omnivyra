/**
 * Unread-error sites (2026-11-12): super-admin credit views. A failed read is
 * never answered with a confident empty ("no activity", "0 granted", "no
 * matching billing_operations"); each now answers 503.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockFail: string | null = null;

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'sa1' }, error: null }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => true }));
jest.mock('../../services/contentArchitectService', () => ({ isContentArchitectSession: () => false }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/requestAccessService', () => ({ requireAuthenticatedInternalUser: async () => ({ id: 'fa1' }) }));
jest.mock('../../services/billing/financeRbacService', () => ({ isFinanceAuditor: async () => true }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: async () => ({ data: {}, error: null }),
    from: (table: string) => {
      const b: any = {};
      const result = (): Res => (mockFail === table ? { data: null, error: { message: 'down' } } : { data: [], error: null });
      for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'range', 'not', 'gt', 'in']) b[m] = () => b;
      b.maybeSingle = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import summary from '../../../pages/api/super-admin/free-credits/summary';
import globalLedger from '../../../pages/api/super-admin/global-ledger';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
async function get(h: (req: any, res: any) => unknown, query: Record<string, string> = {}) {
  const res = mockRes();
  await h({ method: 'GET', query, headers: {} }, res);
  return res;
}
beforeEach(() => { mockFail = null; });

it.each(['free_credit_claims', 'credit_transactions'])('free-credit summary: %s read error -> 503, never "0 granted"', async (t) => {
  mockFail = t;
  const res = await get(summary);
  expect(res.statusCode).toBe(503);
});

it('global ledger by correlation: billing_operations read error -> 503, never "no matching"', async () => {
  mockFail = 'billing_operations';
  const res = await get(globalLedger, { correlationId: 'c1' });
  expect(res.statusCode).toBe(503);
});

it('control: clean reads answer 200', async () => {
  const res = await get(summary);
  expect(res.statusCode).toBe(200);
});
