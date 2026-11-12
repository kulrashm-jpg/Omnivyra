/**
 * POST /api/campaigns/approve - S2 tenant seam (e9 ruling 2026-11-13).
 *
 * CONTRACT CHANGE (deliberate): a campaign of ANOTHER company used to answer 403 CAMPAIGN_NOT_IN_COMPANY, which told
 * the caller the campaign exists. It now answers the same 404 as an unknown campaign (no existence oracle), and
 * nothing is updated. The Supabase fake is FAITHFUL: a row matches only when every eq filter matches.
 */
type Row = Record<string, unknown>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const CAMP_A = 'c0c00000-0000-4000-8000-0000000000a1';
const CAMP_B = 'c0c00000-0000-4000-8000-0000000000b1';

let tables: Record<string, Row[]> = {};
const updates: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let isUpdate = false;
  const q: any = {};
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  q.select = () => q;
  q.update = () => { isUpdate = true; return q; };
  q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
  q.order = () => q;
  q.limit = () => q;
  q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  q.single = async () => {
    const r = rows();
    if (isUpdate && r.length) updates.push({ table, filters: [...filters] });
    return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  };
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/rbacService', () => ({
  // The caller is an approver of the company they name (the role check is not what this suite tests).
  getUserCompanyRole: jest.fn(async () => ({ role: 'COMPANY_ADMIN', userId: 'u-1' })),
  hasPermission: jest.fn(async () => true),
}));

import handler from '../../../pages/api/campaigns/approve';

const approve = async (campaignId: string) => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await (handler as any)({ method: 'POST', query: {}, body: { companyId: CO_A, campaignId } }, res);
  return res;
};

beforeEach(() => {
  updates.length = 0;
  tables = {
    campaigns: [{ id: CAMP_A, company_id: CO_A, status: 'draft' }, { id: CAMP_B, company_id: CO_B, status: 'draft' }],
    campaign_versions: [{ campaign_id: CAMP_A, company_id: CO_A }, { campaign_id: CAMP_B, company_id: CO_B }],
  };
});

describe('campaigns/approve: foreign == unknown (uniform 404)', () => {
  it('CONTROL: an approver approves their own company campaign', async () => {
    const res = await approve(CAMP_A);
    expect(res.statusCode).toBe(200);
    expect(updates).toEqual([{ table: 'campaigns', filters: expect.arrayContaining([['company_id', CO_A], ['id', CAMP_A]]) }]);
  });

  it('CRITICAL: a campaign of ANOTHER company is the uniform 404 (was 403 CAMPAIGN_NOT_IN_COMPANY), nothing updated', async () => {
    const res = await approve(CAMP_B);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Campaign not found' });
    expect(updates).toEqual([]);
  });

  it('an unknown campaign answers the IDENTICAL 404 (no existence oracle)', async () => {
    const unknown = await approve('c0c00000-0000-4000-8000-0000000000ff');
    const foreign = await approve(CAMP_B);
    expect([unknown.statusCode, unknown.body]).toEqual([foreign.statusCode, foreign.body]);
  });

  it('a version of this company but a campaigns row of another: 404, nothing updated (strict)', async () => {
    tables.campaigns = [{ id: CAMP_A, company_id: CO_B, status: 'draft' }];
    const res = await approve(CAMP_A);
    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
  });
});
