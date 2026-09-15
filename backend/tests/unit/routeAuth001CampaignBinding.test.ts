/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — enforceCompanyAccess binds a supplied campaignId.
 *
 * THE DEFECT (STEP 3AH-84 P1-4): enforceCompanyAccess({ companyId, campaignId })
 * proved membership in `companyId` and then only checked that a campaignId was
 * PRESENT. A member of company A could authorize against A, pass company B's
 * campaign id, and campaigns/[id]/commit-plan overwrote B's blueprint and
 * campaign row. The guard now proves the campaign belongs to the authorized
 * company in every allow branch.
 *
 * The real guard chain runs; only the database and identity provider are fake.
 */
import {
  seed, invoke, failTable, writeCalls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

import { enforceCompanyAccess } from '../../services/userContextService';
import { checkCampaignOwnership } from '../../services/campaignOwnershipService';

const guard = (companyId: string, campaignId?: string | null, requireCampaignId = false) =>
  async (req: any, res: any) => {
    const ok = await enforceCompanyAccess({ req, res, companyId, campaignId, requireCampaignId });
    if (!ok) return;
    res.status(200).json({ ok: true });
  };

beforeEach(() => seed());

describe('checkCampaignOwnership', () => {
  it('owned when the latest campaign_versions row names the company', async () => {
    expect(await checkCampaignOwnership(CAMPAIGN_A, CO_A)).toBe('owned');
  });
  it('foreign when the version row names another company', async () => {
    expect(await checkCampaignOwnership(CAMPAIGN_B, CO_A)).toBe('foreign');
  });
  it('the version read always carries the company predicate (it can only confirm, never disclose)', async () => {
    const { calls } = require('../helpers/routeAuthHarness');
    await checkCampaignOwnership(CAMPAIGN_B, CO_A);
    const first = calls().find((c: { table: string }) => c.table === 'campaign_versions');
    expect(first.filters).toEqual({ campaign_id: CAMPAIGN_B, company_id: CO_A });
  });
  it('legacy campaigns with no version row are owned through campaigns.company_id', async () => {
    seed({ campaigns: [{ id: 'camp-legacy', company_id: CO_A }] });
    expect(await checkCampaignOwnership('camp-legacy', CO_A)).toBe('owned');
    expect(await checkCampaignOwnership('camp-legacy', CO_B)).toBe('foreign');
  });
  it('a campaign with no owner record anywhere is never treated as owned', async () => {
    seed({ campaigns: [{ id: 'camp-orphan', company_id: null }] });
    expect(await checkCampaignOwnership('camp-orphan', CO_A)).toBe('foreign');
  });
  it('a version row with no campaigns row (campaign_versions has no FK) is foreign, not new', async () => {
    seed({ campaign_versions: [{ campaign_id: 'camp-ghost', company_id: CO_B, created_at: '2026-02-01' }] });
    expect(await checkCampaignOwnership('camp-ghost', CO_A)).toBe('foreign');
    expect(await checkCampaignOwnership('camp-ghost', CO_B)).toBe('owned');
  });
  it('unknown campaign → not_found; lookup failure → lookup_error', async () => {
    expect(await checkCampaignOwnership(UNKNOWN_ID, CO_A)).toBe('not_found');
    failTable('campaign_versions');
    expect(await checkCampaignOwnership(CAMPAIGN_A, CO_A)).toBe('lookup_error');
  });
});

describe('enforceCompanyAccess campaign binding', () => {
  it('unauthenticated → 401 before any ownership read', async () => {
    const r = await invoke(guard(CO_A, CAMPAIGN_A), { as: null });
    expect(r.status).toBe(401);
  });
  it('member of A with A\'s campaign → allowed', async () => {
    const r = await invoke(guard(CO_A, CAMPAIGN_A), { as: 'A' });
    expect(r.status).toBe(200);
  });
  it('member of A authorizing against A with B\'s campaign → 404 (was: allowed)', async () => {
    const r = await invoke(guard(CO_A, CAMPAIGN_B), { as: 'A' });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
  });
  it('a campaign that does not exist yet is allowed (creation flows authorize the id they are creating)', async () => {
    const r = await invoke(guard(CO_A, UNKNOWN_ID), { as: 'A' });
    expect(r.status).toBe(200);
  });
  it('an orphan campaign (exists, no owner) is refused like a foreign one', async () => {
    seed({ campaigns: [{ id: 'camp-orphan', company_id: null }] });
    const r = await invoke(guard(CO_A, 'camp-orphan'), { as: 'A' });
    expect(r.status).toBe(404);
  });
  it('member of A naming company B is still refused by membership (403)', async () => {
    const r = await invoke(guard(CO_B, CAMPAIGN_B), { as: 'A' });
    expect(r.status).toBe(403);
  });
  it('ownership lookup failure → retryable 503, never an allow', async () => {
    failTable('campaign_versions');
    const r = await invoke(guard(CO_A, CAMPAIGN_A), { as: 'A' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CAMPAIGN_LOOKUP_ERROR');
  });
  it('no campaignId supplied → unchanged company-only behaviour', async () => {
    expect((await invoke(guard(CO_A, null), { as: 'A' })).status).toBe(200);
    expect((await invoke(guard(CO_A, null, true), { as: 'A' })).status).toBe(400);
  });
});

describe('campaigns/[id]/commit-plan (the STEP 3AH-84 P1-4 exploit)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require('../../../pages/api/campaigns/[id]/commit-plan').default;
  const plan = { weeks: [{ week: 1, theme: 'x' }] };

  it('client-supplied companyId=A cannot unlock company B\'s campaign', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', query: { id: CAMPAIGN_B }, body: { companyId: CO_A, plan } });
    expect(r.status).toBe(404);
    expect(writeCalls(['campaigns', 'twelve_week_plan', 'campaign_versions'])).toHaveLength(0);
  });
  it('unauthenticated → 401 and nothing written', async () => {
    const r = await invoke(handler, { method: 'POST', as: null, query: { id: CAMPAIGN_A }, body: { companyId: CO_A, plan } });
    expect(r.status).toBe(401);
    expect(writeCalls()).toHaveLength(0);
  });
});
