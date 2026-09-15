/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-5 (low-risk part): requireCampaignAccess
 * refuses members of a SUSPENDED / INACTIVE company, like the canonical tenant
 * guard does on every other route of that company.
 *
 * The member fast path (`user.companyIds.includes(companyId)`) never looked at
 * `companies.status`, while enforceCompanyAccess / requireTenantAccess
 * (TenantGuard.assertTenantAccess) answer ORG_INACTIVE → 403 for an active
 * member of a non-active company. A suspended or disabled company's members
 * could therefore keep reading and writing campaigns through the ~100
 * requireCampaignAccess routes after the company was switched off.
 * companies.status ∈ {active, inactive, suspended} (default active).
 *
 * Parity is proved against the canonical guard itself: for every org state ×
 * principal, requireCampaignAccess and enforceCompanyAccess agree.
 */
import { seed, rows, failTable, invoke, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';
import { requireCampaignAccess } from '../../services/campaignAccessService';
import { enforceCompanyAccess } from '../../services/userContextService';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const campaignSummary = require('../../../pages/api/campaigns/campaign-summary').default;
/* eslint-enable @typescript-eslint/no-var-requires */

type Who = 'A' | 'B' | 'SUPER';
const TOKENS: Record<Who, string> = { A: 'tok-user-a', B: 'tok-user-b', SUPER: 'tok-user-super' };
function fakeReq(who: Who): any {
  return { method: 'GET', query: {}, body: {}, headers: { authorization: `Bearer ${TOKENS[who]}` }, cookies: {}, url: '/api/test' };
}
function fakeRes(): any {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
const setStatus = (companyId: string, status: string) => {
  rows('companies').find((c) => c.id === companyId)!.status = status;
};

beforeEach(() => {
  seed();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('member of a non-active company', () => {
  it.each(['suspended', 'inactive'])('company %s → 403 on its own campaign', async (status) => {
    setStatus(CO_A, status);
    const res = fakeRes();
    const access = await requireCampaignAccess(fakeReq('A'), res, CAMPAIGN_A);
    expect(access).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('a real requireCampaignAccess route answers 403 and reads no campaign data', async () => {
    setStatus(CO_A, 'suspended');
    const r = await invoke(campaignSummary, { method: 'GET', query: { campaignId: CAMPAIGN_A }, as: 'A' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('Campaign A');
  });

  it('company row missing → 403 (fail closed)', async () => {
    rows('companies').splice(rows('companies').findIndex((c) => c.id === CO_A), 1);
    const res = fakeRes();
    expect(await requireCampaignAccess(fakeReq('A'), res, CAMPAIGN_A)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('company status lookup error → retryable 503, never an allow', async () => {
    failTable('companies');
    const res = fakeRes();
    expect(await requireCampaignAccess(fakeReq('A'), res, CAMPAIGN_A)).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ retryable: true });
  });
});

describe('unchanged behaviour', () => {
  it('active company → member allowed (same result as before)', async () => {
    const access = await requireCampaignAccess(fakeReq('A'), fakeRes(), CAMPAIGN_A);
    expect(access).toMatchObject({ companyId: CO_A, campaignId: CAMPAIGN_A });
  });

  it('platform super admin keeps access to a suspended company it is a member of (TenantGuard bypass)', async () => {
    setStatus(CO_A, 'suspended');
    const access = await requireCampaignAccess(fakeReq('SUPER'), fakeRes(), CAMPAIGN_A);
    expect(access).toMatchObject({ companyId: CO_A });
  });

  it('platform super admin keeps access to a suspended company it is NOT a member of', async () => {
    setStatus(CO_B, 'suspended');
    const access = await requireCampaignAccess(fakeReq('SUPER'), fakeRes(), CAMPAIGN_B);
    expect(access).toMatchObject({ companyId: CO_B });
  });

  it('non-member of a suspended company is still 403 (not 503, no oracle change)', async () => {
    setStatus(CO_B, 'suspended');
    const res = fakeRes();
    expect(await requireCampaignAccess(fakeReq('A'), res, CAMPAIGN_B)).toBeNull();
    expect(res.statusCode).toBe(403);
  });
});

describe('parity with the canonical tenant guard (enforceCompanyAccess)', () => {
  const states = ['active', 'inactive', 'suspended'];
  const cases: Array<[string, Who, string, string]> = [];
  for (const status of states) {
    cases.push([status, 'A', CO_A, CAMPAIGN_A]);
    cases.push([status, 'SUPER', CO_A, CAMPAIGN_A]);
    cases.push([status, 'SUPER', CO_B, CAMPAIGN_B]);
    cases.push([status, 'A', CO_B, CAMPAIGN_B]);
  }
  it.each(cases)('company %s, caller %s, company %s → same allow/deny', async (status, who, companyId, campaignId) => {
    setStatus(companyId, status);
    const guardRes = fakeRes();
    const guard = await enforceCompanyAccess({ req: fakeReq(who), res: guardRes, companyId });
    const campRes = fakeRes();
    const camp = await requireCampaignAccess(fakeReq(who), campRes, campaignId);
    expect(camp !== null).toBe(guard !== null);
    if (!guard) expect(campRes.statusCode).toBe(guardRes.statusCode);
  });
});
