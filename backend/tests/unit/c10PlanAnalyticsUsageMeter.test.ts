/**
 * C10 (2026-11-11): Super Admin plan analytics read usage from an RPC
 * (get_organization_monthly_usage) that never existed and swallowed the error,
 * so every plan always showed ZERO usage. It now reads usage_meter_monthly
 * directly. Pinned here:
 *   - the CURRENT UTC month (the meter writer's convention), all organisations;
 *   - paging past the PostgREST row cap (no silent truncation);
 *   - a failed read is NOT an empty month: ok=false, so the route reports
 *     usage_status 'unavailable' instead of presenting zeros as real.
 */
type Res = { data: unknown; error: { message: string } | null };
const calls: Array<{ table: string; filters: Array<[string, unknown]>; range: [number, number] | null }> = [];
let pages: Res[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: () => { throw new Error('no RPC may be called'); },
    from: (table: string) => {
      const call = { table, filters: [] as Array<[string, unknown]>, range: null as [number, number] | null };
      calls.push(call);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (c: string, v: unknown) => { call.filters.push([c, v]); return b; };
      b.range = async (a: number, z: number) => { call.range = [a, z]; return pages.shift() ?? { data: [], error: null }; };
      return b;
    },
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null, error: 'x' }) }));
jest.mock('@/backend/services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }), { virtual: true });
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { readMonthlyUsage } from '../../../pages/api/super-admin/plans/analytics';

const row = (i: number) => ({ organization_id: `org-${String(i).padStart(5, '0')}`, llm_total_tokens: 10, external_api_calls: 2, automation_executions: 1 });

beforeEach(() => { calls.length = 0; pages = []; });

describe('C10 - plan analytics reads the usage meter, never a missing RPC', () => {
  it('reads usage_meter_monthly for the CURRENT UTC month (not local time)', async () => {
    pages = [{ data: [row(1)], error: null }];
    // 2026-12-31T23:30 UTC-08 is 2027-01-01 07:30 UTC: the UTC month is January 2027.
    const { rows, ok } = await readMonthlyUsage(new Date('2027-01-01T07:30:00Z'));
    expect(ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(calls[0].table).toBe('usage_meter_monthly');
    expect(calls[0].filters).toEqual([['year', 2027], ['month', 1]]);
  });

  it('pages past the 1000-row cap instead of truncating', async () => {
    pages = [
      { data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null },
      { data: Array.from({ length: 5 }, (_, i) => row(1000 + i)), error: null },
    ];
    const { rows, ok } = await readMonthlyUsage(new Date('2026-11-11T00:00:00Z'));
    expect(ok).toBe(true);
    expect(rows).toHaveLength(1005);
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('a failed read is UNAVAILABLE, never an empty month', async () => {
    pages = [{ data: null, error: { message: 'permission denied' } }];
    expect(await readMonthlyUsage()).toEqual({ rows: [], ok: false });
    pages = [{ data: null, error: null }]; // a null error with no array body is not an answer either
    expect(await readMonthlyUsage()).toEqual({ rows: [], ok: false });
  });
});
