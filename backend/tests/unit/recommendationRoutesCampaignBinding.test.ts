/**
 * TENANT (e9, BLOCKING): campaigns/[id]/merge-recommendations and campaigns/[id]/recommendations took
 * the company from campaign_versions (an unchecked read) and, when that found nothing, from the request
 * BODY / QUERY. They then authorized the caller against that company WITHOUT binding the campaign to it
 * (enforceCompanyAccess with requireCampaignId:false). A member of A could pass their own company with
 * B's company-less campaign and merge into, or generate recommendations for, B's plan.
 *
 * Both now bind the campaign with requireCampaignAccess (company resolved server-side, membership proven,
 * a lookup failure refused) and treat a body/query companyId as a claim that must MATCH.
 *
 * The real guards run over the route-auth harness's modelled database. The recommendation service is
 * mocked so that "no write" is observable as "the service was never called".
 */
import {
  seed, invoke, writeCalls, failTable,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, USER_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockMerge = jest.fn(async (..._a: unknown[]) => ({ merged: 1 }));
const mockGenerate = jest.fn(async (..._a: unknown[]) => ({ sessionId: 's1', weeks: [] }));
const mockFetch = jest.fn(async (..._a: unknown[]) => [] as unknown[]);
jest.mock('../../services/campaignRecommendationExtensionService', () => ({
  mergeRecommendationsIntoPlan: (...a: unknown[]) => mockMerge(...a),
  generateCampaignRecommendations: (...a: unknown[]) => mockGenerate(...a),
  fetchRecommendationWeeks: (...a: unknown[]) => mockFetch(...a),
}));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => ({ weeks: [] })) }));
jest.mock('../../utils/refineUserFacingResponse', () => ({ formatForUserOutput: async (d: unknown) => d }));

/* eslint-disable @typescript-eslint/no-var-requires */
const mergeRoute = require('../../../pages/api/campaigns/[id]/merge-recommendations').default;
const recsRoute = require('../../../pages/api/campaigns/[id]/recommendations').default;

const ORPHAN = 'camp-orphan-b';
const MERGE_BODY = { sessionId: 's1', weekNumbers: [1] };

beforeEach(() => {
  // B's company-less campaign: no campaign_versions row and campaigns.company_id NULL (the 7 prod rows).
  seed({ campaigns: [{ id: ORPHAN, company_id: null, user_id: USER_B, name: 'orphan' }] });
  mockMerge.mockClear();
  mockGenerate.mockClear();
  mockFetch.mockClear();
});

const recWrites = () => writeCalls(['campaign_recommendation_weeks', 'campaign_week_plan']);

describe('merge-recommendations', () => {
  it('CONTROL: a member of A merges into their OWN campaign', async () => {
    const r = await invoke(mergeRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: { ...MERGE_BODY, companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockMerge).toHaveBeenCalledWith({ campaignId: CAMPAIGN_A, sessionId: 's1', weekNumbers: [1] });
  });

  it("CRITICAL: a member of A cannot merge into B's campaign (with their own companyId) — refused, no write", async () => {
    const r = await invoke(mergeRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_B }, body: { ...MERGE_BODY, companyId: CO_A } });
    expect([403, 404]).toContain(r.status);
    expect(mockMerge).not.toHaveBeenCalled();
    expect(recWrites()).toEqual([]);
  });

  it("CRITICAL: a member of A cannot merge into B's COMPANY-LESS campaign by passing their own companyId — refused, no write", async () => {
    const r = await invoke(mergeRoute, { method: 'POST', as: 'A', query: { id: ORPHAN }, body: { ...MERGE_BODY, companyId: CO_A } });
    expect([403, 404]).toContain(r.status);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('a body companyId that does not MATCH the campaign company is refused, even on the caller own campaign', async () => {
    const r = await invoke(mergeRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: { ...MERGE_BODY, companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'CAMPAIGN_NOT_IN_COMPANY' });
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('a failed ownership read is refused (fail-closed), never a fallback to the body company', async () => {
    failTable('campaign_versions');
    const r = await invoke(mergeRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: { ...MERGE_BODY, companyId: CO_A } });
    expect(r.status).not.toBe(200);
    expect(mockMerge).not.toHaveBeenCalled();
  });
});

describe('recommendations (POST generates and saves recommendation weeks)', () => {
  it('CONTROL: a member of A generates for their OWN campaign, under their company', async () => {
    const r = await invoke(recsRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: { companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith({ campaignId: CAMPAIGN_A, companyId: CO_A });
  });

  it("CRITICAL: a member of A cannot generate for B's COMPANY-LESS campaign via body companyId — refused, no write", async () => {
    const r = await invoke(recsRoute, { method: 'POST', as: 'A', query: { id: ORPHAN }, body: { companyId: CO_A } });
    expect([403, 404]).toContain(r.status);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("CRITICAL: a member of A cannot read B's campaign recommendations via query companyId", async () => {
    const r = await invoke(recsRoute, { method: 'GET', as: 'A', query: { id: ORPHAN, companyId: CO_A } });
    expect([403, 404]).toContain(r.status);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a body/query companyId that does not MATCH the campaign company is refused', async () => {
    const r = await invoke(recsRoute, { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'CAMPAIGN_NOT_IN_COMPANY' });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
