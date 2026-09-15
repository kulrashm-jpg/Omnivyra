/**
 * SEC-91 W2-G (STEP 3AH-91, wave-2 residuals) — W2G-4: the INVITED-admin
 * fallback honours company status.
 *
 * enforceCompanyAccess keeps a legacy fallback: a user whose COMPANY_ADMIN /
 * ADMIN / SUPER_ADMIN row is still status='invited' may administer the company
 * before accepting. Its doc comment says suspended / soft-deleted companies are
 * rejected even for invited admins "(ORG_NOT_FOUND / ORG_INACTIVE override the
 * fallback)" — but TenantGuard.assertTenantAccess returns STALE_MEMBERSHIP for
 * a non-active row BEFORE it reads the company, so the fallback ran and admitted
 * the invited admin into a suspended / inactive / missing company.
 * requireCampaignAccess admitted the same principal through getUserRole's
 * invited-admin fallback with no company check (W2-A §8).
 *
 * Now both fallbacks require companies.status = 'active' (missing row ⇒ deny,
 * lookup error ⇒ retryable 503, never an allow). Platform super admins keep
 * their bypass; everything else is unchanged. TenantGuard.ts is not touched.
 */
import { seed, rows, failTable, invoke, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';
import { roleRows } from '../helpers/sec91W2AHarness';
import { as, w2gRoleRows, type W2GPrincipal } from '../helpers/sec91W2GHarness';
import { requireCampaignAccess } from '../../services/campaignAccessService';
import { enforceCompanyAccess } from '../../services/userContextService';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const campaignSummary = require('../../../pages/api/campaigns/campaign-summary').default;
const contentList = require('../../../pages/api/content/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function fakeReq(who: W2GPrincipal): any {
  return { method: 'GET', query: {}, body: {}, headers: as(who), cookies: {}, url: '/api/test' };
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
const dropCompany = (companyId: string) => {
  rows('companies').splice(rows('companies').findIndex((c) => c.id === companyId), 1);
};
const guard = async (who: W2GPrincipal, companyId = CO_A) => {
  const res = fakeRes();
  const out = await enforceCompanyAccess({ req: fakeReq(who), res, companyId });
  return { allowed: out !== null, status: res.statusCode, body: res.body };
};
const campaign = async (who: W2GPrincipal, campaignId = CAMPAIGN_A) => {
  const res = fakeRes();
  const out = await requireCampaignAccess(fakeReq(who), res, campaignId);
  return { allowed: out !== null, status: res.statusCode, body: res.body };
};

beforeEach(() => {
  seed({ user_company_roles: [...roleRows(), ...w2gRoleRows()] });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('invited COMPANY_ADMIN of a non-operational company', () => {
  it.each(['suspended', 'inactive'])('company %s → enforceCompanyAccess 403', async (status) => {
    setStatus(CO_A, status);
    expect(await guard('INVITED_ADMIN')).toMatchObject({ allowed: false, status: 403 });
  });

  it.each(['suspended', 'inactive'])('company %s → requireCampaignAccess 403', async (status) => {
    setStatus(CO_A, status);
    expect(await campaign('INVITED_ADMIN')).toMatchObject({ allowed: false, status: 403 });
  });

  it('company row missing → 403 on both guards (fail closed)', async () => {
    dropCompany(CO_A);
    expect(await guard('INVITED_ADMIN')).toMatchObject({ allowed: false, status: 403 });
    // requireCampaignAccess still resolves the owner through campaign_versions.
    expect(await campaign('INVITED_ADMIN')).toMatchObject({ allowed: false, status: 403 });
  });

  it('company status lookup error → retryable 503 on both guards, never an allow', async () => {
    failTable('companies');
    const g = await guard('INVITED_ADMIN');
    expect(g).toMatchObject({ allowed: false, status: 503 });
    expect(g.body).toMatchObject({ retryable: true });
    const c = await campaign('INVITED_ADMIN');
    expect(c).toMatchObject({ allowed: false, status: 503 });
    expect(c.body).toMatchObject({ retryable: true });
  });

  it('real routes: content list (enforceCompanyAccess) and campaign summary (requireCampaignAccess) → 403, no data', async () => {
    setStatus(CO_A, 'suspended');
    const list = await invoke(contentList, { method: 'GET', query: { companyId: CO_A }, headers: as('INVITED_ADMIN') });
    expect(list.status).toBe(403);
    const summary = await invoke(campaignSummary, { method: 'GET', query: { campaignId: CAMPAIGN_A }, headers: as('INVITED_ADMIN') });
    expect(summary.status).toBe(403);
    expect(JSON.stringify(summary.body)).not.toContain('Campaign A');
  });
});

describe('unchanged behaviour', () => {
  it('invited COMPANY_ADMIN of an ACTIVE company keeps its legacy access on both guards', async () => {
    expect(await guard('INVITED_ADMIN')).toMatchObject({ allowed: true });
    expect(await campaign('INVITED_ADMIN')).toMatchObject({ allowed: true });
  });

  it('invited CONTENT_CREATOR (non-admin) is refused on both guards, active company', async () => {
    expect(await guard('INVITED_CREATOR')).toMatchObject({ allowed: false, status: 403 });
    expect(await campaign('INVITED_CREATOR')).toMatchObject({ allowed: false, status: 403 });
  });

  it('a non-member of a company whose status lookup fails is still 403 (no 503 oracle)', async () => {
    failTable('companies');
    expect(await guard('INVITED_ADMIN', CO_B)).toMatchObject({ allowed: false, status: 403 });
    expect(await campaign('INVITED_ADMIN', CAMPAIGN_B)).toMatchObject({ allowed: false, status: 403 });
  });

  it('platform super admin keeps its bypass on a suspended company it is not a member of', async () => {
    setStatus(CO_B, 'suspended');
    expect(await guard('SUPER', CO_B)).toMatchObject({ allowed: true });
    expect(await campaign('SUPER', CAMPAIGN_B)).toMatchObject({ allowed: true });
  });

  it('platform super admin is not made to depend on the company read (lookup error → still allowed)', async () => {
    failTable('companies');
    expect(await guard('SUPER', CO_B)).toMatchObject({ allowed: true });
    expect(await campaign('SUPER', CAMPAIGN_B)).toMatchObject({ allowed: true });
  });
});

describe('parity: enforceCompanyAccess and requireCampaignAccess agree', () => {
  const states = ['active', 'inactive', 'suspended'];
  const principals: W2GPrincipal[] = ['INVITED_ADMIN', 'INVITED_CREATOR', 'A', 'LEGACY_ADMIN', 'VIEWER', 'SUPER', 'B'];
  const cases: Array<[string, W2GPrincipal]> = [];
  for (const s of states) for (const p of principals) cases.push([s, p]);
  it.each(cases)('company A %s, caller %s → same allow/deny and status', async (status, who) => {
    setStatus(CO_A, status);
    const g = await guard(who);
    const c = await campaign(who);
    expect(c.allowed).toBe(g.allowed);
    if (!g.allowed) expect(c.status).toBe(g.status);
  });
});
