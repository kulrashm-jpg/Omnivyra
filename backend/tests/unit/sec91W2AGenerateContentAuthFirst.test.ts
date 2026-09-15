/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-3: /api/ai/generate-content
 * (type=campaign_content) authenticates BEFORE it looks the campaign up.
 *
 * The campaign owner used to be read first, so an anonymous caller got 404
 * "Campaign company not found" for an unknown id and 401 for a real one: an
 * existence oracle on campaign ids (the same class SEC-A fixed as A6-b on four
 * other routes). The lookup was also an unordered `.limit(1)` read of
 * campaign_versions; it now goes through the canonical resolveCampaignCompanyId
 * seam (newest version row authoritative, legacy campaigns.company_id fallback
 * only when no version row exists — SEC-A A8).
 */
import { seed, invoke, calls, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, CO_A } from '../helpers/routeAuthHarness';
import { as, roleRows } from '../helpers/sec91W2AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2AHarness').identityModule());

const mockRunPostGeneration = jest.fn(async (_input: Record<string, unknown>) => ({
  master_content: { content: 'generated text', generation_source: 'ai' },
  platform_variant: { generated_content: 'generated text', discoverability_meta: { hashtags: ['#a'] } },
}));
jest.mock('../../../lib/post/runPostGeneration', () => ({
  runPostGeneration: (input: Record<string, unknown>) => mockRunPostGeneration(input),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const generateContent = require('../../../pages/api/ai/generate-content').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const LEGACY_A = 'camp-l-00-0000-0000-00000000000l';

beforeEach(() => {
  seed({
    user_company_roles: roleRows(),
    // A legacy campaign: owner recorded on campaigns only, no version row.
    campaigns: [{ id: LEGACY_A, company_id: CO_A, name: 'Legacy A', status: 'planning' }],
  });
  mockRunPostGeneration.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const body = (campaignId: string) => ({ type: 'campaign_content', context: { campaignId, campaignData: { name: 'Launch' } } });
const campaignReads = () => calls().filter((c) => c.table === 'campaign_versions' || c.table === 'campaigns');

describe('anonymous callers learn nothing about campaign ids', () => {
  it('real campaign and unknown id get the SAME 401, and no campaign row is read', async () => {
    const real = await invoke(generateContent, { method: 'POST', body: body(CAMPAIGN_B) });
    const unknown = await invoke(generateContent, { method: 'POST', body: body(UNKNOWN_ID) });
    expect(real.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(real.body);
    expect(campaignReads()).toEqual([]);
    expect(mockRunPostGeneration).not.toHaveBeenCalled();
  });

  it('an invalid token is treated the same as no token', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(UNKNOWN_ID), headers: { authorization: 'Bearer forged' } });
    expect(r.status).toBe(401);
    expect(campaignReads()).toEqual([]);
  });
});

describe('authenticated behaviour is preserved', () => {
  it('member (content creator) of the owning company → 200, generation runs for THAT company', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(CAMPAIGN_A), headers: as('CREATOR') });
    expect(r.status).toBe(200);
    expect(r.body.content.text).toBe('generated text');
    expect(mockRunPostGeneration).toHaveBeenCalledTimes(1);
    expect(mockRunPostGeneration.mock.calls[0][0]).toMatchObject({ company_id: CO_A });
  });

  it('another tenant\'s campaign → 403, no generation', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(CAMPAIGN_B), headers: as('A') });
    expect(r.status).toBe(403);
    expect(mockRunPostGeneration).not.toHaveBeenCalled();
  });

  it('unknown campaign (authenticated) → 404', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(UNKNOWN_ID), headers: as('A') });
    expect(r.status).toBe(404);
    expect(mockRunPostGeneration).not.toHaveBeenCalled();
  });

  it('VIEW_ONLY member → 403 (role gate unchanged)', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(CAMPAIGN_A), headers: as('VIEWER') });
    expect(r.status).toBe(403);
    expect(mockRunPostGeneration).not.toHaveBeenCalled();
  });

  it('legacy campaign with no version row resolves through the canonical seam → 200 for its own company', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: body(LEGACY_A), headers: as('A') });
    expect(r.status).toBe(200);
    expect(mockRunPostGeneration.mock.calls[0][0]).toMatchObject({ company_id: CO_A });
  });

  it('missing campaignId → 400 before anything else', async () => {
    const r = await invoke(generateContent, { method: 'POST', body: { type: 'campaign_content', context: {} } });
    expect(r.status).toBe(400);
  });
});
