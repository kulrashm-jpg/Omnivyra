/**
 * C10 (2026-11-11): Super Admin plan analytics.
 *  1. Usage: read from an RPC (get_organization_monthly_usage) that never
 *     existed, with the error swallowed, so every plan always showed ZERO. It
 *     now reads usage_meter_monthly directly. Pinned: the CURRENT UTC month
 *     (the meter writer's convention); paging past the PostgREST row cap; a
 *     failed read is NOT an empty month (usage_status 'unavailable').
 *  2. Feature adoption: was Math.random() - invented numbers on an admin screen.
 *     There is no canonical source, so it is null ("not available"). Pinned
 *     end to end: Math.random is never called and every plan returns null.
 */
type Res = { data: unknown; error: { message: string } | null };
const calls: Array<{ table: string; filters: Array<[string, unknown]>; range: [number, number] | null }> = [];
let meterPages: Res[] = [];
let tables: Record<string, unknown[]> = {};
let superAdmin = false;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: () => { throw new Error('no RPC may be called'); },
    from: (table: string) => {
      const call = { table, filters: [] as Array<[string, unknown]>, range: null as [number, number] | null };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'in', 'gt']) b[m] = () => b;
      b.eq = (c: string, v: unknown) => { call.filters.push([c, v]); return b; };
      b.maybeSingle = async () => ({ data: null, error: null });
      b.range = async (a: number, z: number) => {
        call.range = [a, z];
        return meterPages.shift() ?? { data: [], error: null };
      };
      b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null, error: 'x' }) }));
jest.mock('@/backend/services/superAdminSession', () => ({ getLegacySuperAdminSession: () => (superAdmin ? { ok: true } : null) }), { virtual: true });
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler, { readMonthlyUsage } from '../../../pages/api/super-admin/plans/analytics';

const row = (i: number, org = `org-${String(i).padStart(5, '0')}`) =>
  ({ organization_id: org, llm_total_tokens: 10, external_api_calls: 2, automation_executions: 1 });

beforeEach(() => { calls.length = 0; meterPages = []; tables = {}; superAdmin = false; });

describe('C10 - plan analytics reads the usage meter, never a missing RPC', () => {
  it('reads usage_meter_monthly for the CURRENT UTC month (not local time)', async () => {
    meterPages = [{ data: [row(1)], error: null }];
    const { rows, ok } = await readMonthlyUsage(new Date('2027-01-01T07:30:00Z'));
    expect(ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(calls[0].table).toBe('usage_meter_monthly');
    expect(calls[0].filters).toEqual([['year', 2027], ['month', 1]]);
  });

  it('pages past the 1000-row cap instead of truncating', async () => {
    meterPages = [
      { data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null },
      { data: Array.from({ length: 5 }, (_, i) => row(1000 + i)), error: null },
    ];
    const { rows, ok } = await readMonthlyUsage(new Date('2026-11-11T00:00:00Z'));
    expect(ok).toBe(true);
    expect(rows).toHaveLength(1005);
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('a failed read is UNAVAILABLE, never an empty month', async () => {
    meterPages = [{ data: null, error: { message: 'permission denied' } }];
    expect(await readMonthlyUsage()).toEqual({ rows: [], ok: false });
    meterPages = [{ data: null, error: null }]; // a null error with no array body is not an answer either
    expect(await readMonthlyUsage()).toEqual({ rows: [], ok: false });
  });
});

describe('C10 - the route end to end', () => {
  const run = async () => {
    const res: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
    const r = {
      status: (c: number) => { res.code = c; return r; },
      json: (b: Record<string, unknown>) => { res.body = b; return r; },
    };
    await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)({ method: 'GET', headers: {}, cookies: {} }, r);
    return res;
  };

  beforeEach(() => {
    superAdmin = true;
    tables = {
      pricing_plans: [{ id: 'p1', plan_key: 'pro', name: 'Pro', monthly_price: 10, currency: 'USD', is_active: true }],
      plan_limits: [],
      organization_plan_assignments: [{ id: 'a1', organization_id: 'org-a', plan_id: 'p1' }],
      organization_plan_overrides: [],
      free_credit_grants: [{ organization_id: 'org-free', credits_granted: 5, credits_used: 0 }],
    };
  });

  it('feature adoption is NOT AVAILABLE (null) on every plan, and Math.random is never called', async () => {
    const random = jest.spyOn(Math, 'random');
    meterPages = [{ data: [row(0, 'org-a'), row(0, 'org-free')], error: null }];
    const res = await run();
    expect(res.code).toBe(200);
    const plans = res.body.plans as Array<{ plan_key: string; feature_adoption: unknown; avg_llm_tokens_used: number }>;
    expect(plans.map((p) => p.plan_key).sort()).toEqual(['free_credits', 'pro']);
    for (const p of plans) expect(p.feature_adoption).toBeNull();
    expect(random).not.toHaveBeenCalled();
    // And usage is now REAL: org-a's meter row reaches its plan.
    expect(plans.find((p) => p.plan_key === 'pro')!.avg_llm_tokens_used).toBe(10);
    expect(res.body.usage_status).toBe('ok');
    random.mockRestore();
  });

  it('an unreadable meter is reported as usage_status "unavailable", not as zero usage', async () => {
    meterPages = [{ data: null, error: { message: 'boom' } }];
    const res = await run();
    expect(res.code).toBe(200);
    expect(res.body.usage_status).toBe('unavailable');
  });
});
