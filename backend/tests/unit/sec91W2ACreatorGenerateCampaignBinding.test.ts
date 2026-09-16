/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2F-1b (P3, found by the W2-F re-export
 * route gate): /api/command-center/creator-content/generate (served by
 * backend/services/creator/generateRoute/generateHandler via re-export).
 *
 * The handler authorized body.company_id, then read the newest
 * campaign_versions.campaign_snapshot for body.campaign_id with NO company
 * check and fed it to resolveCampaignVariantPlan / the creator orchestrator
 * (whose output reaches the response). A member of company A could therefore
 * run generation against company B's campaign snapshot. The campaign is now
 * bound by enforceCompanyAccess({ companyId, campaignId }) — a foreign campaign
 * answers 404 before any read — and the snapshot read is scoped to the
 * authorized company as well.
 */
import { seed, invoke, calls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

jest.mock('../../services/creatorRenderFonts', () => ({
  ensureRenderFonts: () => ({ resolvedFontDir: null, fontCount: 0, configPath: null }),
}));
const mockResolvePlan = jest.fn((_input: Record<string, unknown>) => null);
jest.mock('../../services/creator/campaignVariantApplier', () => ({
  resolveCampaignVariantPlan: (input: Record<string, unknown>) => mockResolvePlan(input),
}));
jest.mock('../../services/creator/creatorCopyContextResolver', () => ({
  resolveCreatorCopyContext: jest.fn(async () => ({ company: null, brandVoice: null })),
}));
/** Stop the flow right after campaign resolution: generation itself is out of scope. */
const mockCharge = jest.fn(async () => { throw new Error('STOP_AFTER_CAMPAIGN_RESOLUTION'); });
jest.mock('../../services/billing/phase2RouteWiring', () => ({ wirePhase2Route: () => mockCharge() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const generate = require('../../../pages/api/command-center/creator-content/generate').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed({
    campaign_versions: [
      // Newer snapshots carrying each company's campaign plan.
      { campaign_id: CAMPAIGN_A, company_id: CO_A, version: 2, created_at: '2026-02-01', campaign_snapshot: { plan: 'A-PLAN' } },
      { campaign_id: CAMPAIGN_B, company_id: CO_B, version: 2, created_at: '2026-02-01', campaign_snapshot: { plan: 'B-SECRET-PLAN' } },
    ],
  });
  mockResolvePlan.mockClear();
  mockCharge.mockClear();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const body = (campaignId?: string, companyId: string = CO_A) => ({
  company_id: companyId,
  topic: 'Launch',
  content_type: 'carousel',
  target_platforms: ['linkedin'],
  ...(campaignId ? { campaign_id: campaignId } : {}),
});
const campaignReadsFor = (campaignId: string) =>
  calls().filter((c) => c.table === 'campaign_versions' && c.filters.campaign_id === campaignId);

describe('campaign_id is bound to the authorized company', () => {
  it('THE LEAK: member of A + company A + B\'s campaign → 404; B\'s snapshot never reaches the variant planner', async () => {
    const r = await invoke(generate, { method: 'POST', body: body(CAMPAIGN_B), as: 'A' });
    expect(r.status).toBe(404);
    expect(mockResolvePlan).not.toHaveBeenCalled();
    expect(mockCharge).not.toHaveBeenCalled();
    expect(JSON.stringify(r.body)).not.toContain('B-SECRET-PLAN');
  });

  it('own campaign → passes the guard; the planner receives A\'s snapshot for company A', async () => {
    const r = await invoke(generate, { method: 'POST', body: body(CAMPAIGN_A), as: 'A' });
    expect([403, 404]).not.toContain(r.status);
    expect(mockResolvePlan).toHaveBeenCalledTimes(1);
    const input = mockResolvePlan.mock.calls[0][0] as { campaign: { campaign_snapshot: unknown }; companyId: string; campaignId: string };
    expect(input.companyId).toBe(CO_A);
    expect(input.campaignId).toBe(CAMPAIGN_A);
    expect(input.campaign.campaign_snapshot).toEqual({ plan: 'A-PLAN' });
  });

  it('the snapshot read itself is scoped to the authorized company', async () => {
    await invoke(generate, { method: 'POST', body: body(CAMPAIGN_A), as: 'A' });
    const reads = calls().filter((c) => c.table === 'campaign_versions' && c.op === 'select' && c.filters.campaign_id === CAMPAIGN_A);
    const snapshotRead = reads[reads.length - 1];
    expect(snapshotRead.filters).toMatchObject({ campaign_id: CAMPAIGN_A, company_id: CO_A });
    expect(campaignReadsFor(CAMPAIGN_B)).toEqual([]);
  });

  it('a campaign id that does not exist yet stays allowed (creation semantics) and resolves no plan', async () => {
    const r = await invoke(generate, { method: 'POST', body: body(UNKNOWN_ID), as: 'A' });
    expect([403, 404]).not.toContain(r.status);
    expect(mockResolvePlan).not.toHaveBeenCalled();
  });

  it('no campaign_id → unchanged single-asset path', async () => {
    const r = await invoke(generate, { method: 'POST', body: body(), as: 'A' });
    expect([403, 404]).not.toContain(r.status);
    expect(mockResolvePlan).not.toHaveBeenCalled();
    expect(mockCharge).toHaveBeenCalledTimes(1);
  });

  it('company the caller does not belong to → 403 (unchanged)', async () => {
    const r = await invoke(generate, { method: 'POST', body: body(CAMPAIGN_B, CO_B), as: 'A' });
    expect(r.status).toBe(403);
    expect(mockResolvePlan).not.toHaveBeenCalled();
  });
});
