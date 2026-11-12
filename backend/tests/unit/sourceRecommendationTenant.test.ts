/**
 * PUT /api/campaigns/[id]/source-recommendation - S2 derive-then-authorize (e9 / 83 rulings, 2026-11-13).
 *
 * The owning company now comes from the CAMPAIGN row (ownerCompanyOfRow('campaigns', id)), no longer from "any
 * campaign_versions row". 83's required case: a campaign whose versions name ANOTHER company than
 * campaigns.company_id is refused, never silently re-attributed - nothing is written to either company's rows.
 *
 * The Supabase fake is FAITHFUL (every eq filter must match). enforceCompanyAccess is mocked to its observable
 * contract: it allows a caller who is a member of the company it is asked about and answers 403 otherwise (the
 * campaign binding it also performs is the legacy check, which passes for the campaigns-row company).
 */
type Row = Record<string, unknown>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const CAMP = 'c0c00000-0000-4000-8000-0000000000c1';

let tables: Record<string, Row[]> = {};
let callerCompanies: string[] = [];
const writes: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let update: Row | null = null;
  const q: any = {};
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  q.select = () => q;
  q.update = (v: Row) => { update = v; return q; };
  q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
  q.order = () => q;
  q.limit = () => q;
  q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    if (update) writes.push({ table, values: update, filters: [...filters] });
    return Promise.resolve({ data: update ? rows() : rows(), error: null }).then(ok, ko);
  };
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res, companyId }: { res: any; companyId: string }) => {
    if (!callerCompanies.includes(companyId)) { res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' }); return null; }
    return { userId: 'u-1' };
  }),
}));
jest.mock('../../services/companyThemeStateService', () => ({ markThemeInUse: jest.fn(async () => undefined) }));

import handler from '../../../pages/api/campaigns/[id]/source-recommendation';

const put = async () => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await (handler as any)({ method: 'PUT', query: { id: CAMP }, body: { source_recommendation_id: 'rec-1' } }, res);
  return res;
};

beforeEach(() => {
  writes.length = 0;
  tables = {
    campaigns: [{ id: CAMP, company_id: CO_A }],
    campaign_versions: [{ id: 'v-a', campaign_id: CAMP, company_id: CO_A, version: 1, campaign_snapshot: {} }],
  };
  callerCompanies = [CO_A];
});

describe('source-recommendation: the company comes from the campaign row', () => {
  it('CONTROL: a member of the campaign company updates its latest version', async () => {
    const res = await put();
    expect(res.statusCode).toBe(200);
    expect(writes.map((w) => w.table)).toEqual(['campaign_versions']);
    expect(writes[0].filters).toEqual(expect.arrayContaining([['company_id', CO_A], ['id', 'v-a']]));
  });

  it('a member of ANOTHER company is denied, nothing written', async () => {
    callerCompanies = [CO_B];
    const res = await put();
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a missing campaign is the uniform 404, nothing written', async () => {
    tables.campaigns = [];
    const res = await put();
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it("CRITICAL (83): versions naming ANOTHER company than campaigns.company_id are NOT re-attributed - the campaigns-row company's member gets 404, nothing written", async () => {
    tables.campaign_versions = [{ id: 'v-b', campaign_id: CAMP, company_id: CO_B, version: 1, campaign_snapshot: {} }];
    const res = await put();
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it("CRITICAL (83): ...and the versions' company's member is denied (the campaign is not theirs), nothing written", async () => {
    tables.campaign_versions = [{ id: 'v-b', campaign_id: CAMP, company_id: CO_B, version: 1, campaign_snapshot: {} }];
    callerCompanies = [CO_B];
    const res = await put();
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });
});
