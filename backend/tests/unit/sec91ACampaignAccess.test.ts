/**
 * SEC-91A (STEP 3AH-91) — requireCampaignAccess membership (A2) and the legacy
 * campaign owner fallback (A8).
 *
 * A2 — requireCampaignAccess fell back to getCompanyRoleIncludingInvited and
 * accepted ANY invited role (an invited CONTENT_CREATOR who never accepted, or
 * whose invitation expired, could read and write the company's campaigns),
 * while enforceCompanyAccess on the same company's other routes accepts invited
 * ADMIN roles only. Both now agree.
 *
 * A8 — resolveCampaignCompanyId resolved owners ONLY from campaign_versions, so
 * campaigns created by paths that write no version row (pending approve,
 * autonomousScheduler, adsIngestionService) 404'd for their own company. It now
 * falls back to campaigns.company_id ONLY when no version row exists; a version
 * row stays authoritative, and the fallback is still only an owner claim that
 * the caller's membership must satisfy.
 *
 * Only the database and identity provider are faked; the guard chain is real.
 */
import { seed, invoke, rows, calls, failTable, leaksB, CO_A, CO_B, USER_A, USER_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID } from '../helpers/routeAuthHarness';
import { bearer, USER_INVITED } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const { requireCampaignAccess, resolveCampaignCompanyId } = require('../../services/campaignAccessService');
const { enforceCompanyAccess } = require('../../services/userContextService');
const campaignSummaryUpdate = require('../../../pages/api/campaigns/campaign-summary-update').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const LEGACY_A = 'camp-l-00-0000-0000-00000000000a'; // campaigns.company_id = A, no version row
const DIVERGENT = 'camp-d-00-0000-0000-00000000000d'; // campaigns.company_id = A, version row = B
const ORPHAN = 'camp-o-00-0000-0000-00000000000o'; // campaigns row, company_id null, no version

function world(invitedRole = 'CONTENT_CREATOR') {
  seed({
    user_company_roles: [
      { user_id: USER_INVITED, company_id: CO_B, role: invitedRole, status: 'invited' },
    ],
    campaigns: [
      { id: LEGACY_A, company_id: CO_A, user_id: USER_A, name: 'Legacy A (pending-approve path)', objective: 'legacy-a' },
      { id: DIVERGENT, company_id: CO_A, user_id: USER_B, name: 'Divergent', objective: 'divergent' },
      { id: ORPHAN, company_id: null, user_id: USER_A, name: 'Orphan (campaigns/save path)' },
    ],
    campaign_versions: [
      { campaign_id: DIVERGENT, company_id: CO_B, version: 1, created_at: '2026-02-01', campaign_snapshot: {} },
    ],
  });
}
beforeEach(() => world());

async function access(campaignId: string, who: Parameters<typeof bearer>[0] | null) {
  let result: any;
  const r = await invoke(async (req, res) => { result = await requireCampaignAccess(req, res, campaignId); }, { headers: who ? bearer(who) : {} });
  return { result, status: r.status, body: r.body };
}

describe('A2 — invited memberships (requireCampaignAccess aligned with enforceCompanyAccess)', () => {
  it('THE EXPLOIT: an invited, never-accepted CONTENT_CREATOR of B is refused B\'s campaign → 403', async () => {
    const g = await access(CAMPAIGN_B, 'INVITED');
    expect(g.result).toBeNull();
    expect(g.status).toBe(403);
    expect(leaksB(g.body)).toBe(false);
  });

  it('the same invited member is refused by enforceCompanyAccess too (the two guards agree)', async () => {
    let result: unknown;
    const r = await invoke(async (req, res) => { result = await enforceCompanyAccess({ req, res, companyId: CO_B, campaignId: CAMPAIGN_B }); }, { headers: bearer('INVITED') });
    expect(result).toBeNull();
    expect(r.status).toBe(403);
  });

  it('an invited COMPANY_ADMIN keeps the documented legacy fallback in BOTH guards → allowed', async () => {
    world('COMPANY_ADMIN');
    const g = await access(CAMPAIGN_B, 'INVITED');
    expect(g.result).toMatchObject({ userId: USER_INVITED, companyId: CO_B, campaignId: CAMPAIGN_B });
    let ec: unknown;
    await invoke(async (req, res) => { ec = await enforceCompanyAccess({ req, res, companyId: CO_B, campaignId: CAMPAIGN_B }); }, { headers: bearer('INVITED') });
    expect(ec).not.toBeNull();
  });

  it('an active member is unaffected → allowed', async () => {
    const g = await access(CAMPAIGN_B, 'B');
    expect(g.result).toMatchObject({ userId: USER_B, companyId: CO_B });
  });

  it('unauthenticated → 401 before any campaign lookup', async () => {
    const g = await access(CAMPAIGN_B, null);
    expect(g.status).toBe(401);
    expect(calls().filter((c) => c.table === 'campaign_versions' || c.table === 'campaigns')).toEqual([]);
  });
});

describe('A8 — campaigns with no campaign_versions row', () => {
  it('resolveCampaignCompanyId: version row wins; legacy company only when no version row; null otherwise', async () => {
    expect(await resolveCampaignCompanyId(CAMPAIGN_A)).toBe(CO_A);
    expect(await resolveCampaignCompanyId(LEGACY_A)).toBe(CO_A);
    expect(await resolveCampaignCompanyId(DIVERGENT)).toBe(CO_B);
    expect(await resolveCampaignCompanyId(ORPHAN)).toBeNull();
    expect(await resolveCampaignCompanyId(UNKNOWN_ID)).toBeNull();
    expect(await resolveCampaignCompanyId('')).toBeNull();
  });

  it('owner company A reaches its legacy campaign (was 404)', async () => {
    const g = await access(LEGACY_A, 'A');
    expect(g.result).toMatchObject({ userId: USER_A, companyId: CO_A, campaignId: LEGACY_A });
  });

  it('another tenant cannot use the fallback to reach it → 403, nothing leaked', async () => {
    const g = await access(LEGACY_A, 'B');
    expect(g.result).toBeNull();
    expect(g.status).toBe(403);
    expect(JSON.stringify(g.body)).not.toContain('legacy-a');
  });

  it('divergent rows: the version owner stays authoritative — campaigns.company_id cannot pull it to A', async () => {
    const a = await access(DIVERGENT, 'A');
    expect(a.result).toBeNull();
    expect(a.status).toBe(403);
    const b = await access(DIVERGENT, 'B');
    expect(b.result).toMatchObject({ companyId: CO_B });
  });

  it('a campaign with no owner anywhere (null company_id, no version) is still refused → 404', async () => {
    const g = await access(ORPHAN, 'A');
    expect(g.result).toBeNull();
    expect(g.status).toBe(404);
  });

  it('unknown campaign → 404', async () => {
    const g = await access(UNKNOWN_ID, 'A');
    expect(g.status).toBe(404);
  });

  it('a campaign_versions lookup error fails closed (no fallback to campaigns) → 404', async () => {
    failTable('campaign_versions');
    const g = await access(LEGACY_A, 'A');
    expect(g.result).toBeNull();
    expect(g.status).toBe(404);
    expect(calls().some((c) => c.table === 'campaigns')).toBe(false);
  });

  it('a campaigns lookup error fails closed → 404', async () => {
    failTable('campaigns');
    const g = await access(LEGACY_A, 'A');
    expect(g.result).toBeNull();
    expect(g.status).toBe(404);
  });

  describe('through a real route (PUT campaigns/campaign-summary-update)', () => {
    it('owner updates its legacy campaign → 200, row written', async () => {
      const r = await invoke(campaignSummaryUpdate, { method: 'PUT', query: { campaignId: LEGACY_A }, body: { objective: 'rewritten-by-a' }, headers: bearer('A') });
      expect(r.status).toBe(200);
      expect(rows('campaigns').find((c) => c.id === LEGACY_A)?.objective).toBe('rewritten-by-a');
    });

    it('other tenant → 403, nothing written', async () => {
      const r = await invoke(campaignSummaryUpdate, { method: 'PUT', query: { campaignId: LEGACY_A }, body: { objective: 'hijack' }, headers: bearer('B') });
      expect(r.status).toBe(403);
      expect(rows('campaigns').find((c) => c.id === LEGACY_A)?.objective).toBe('legacy-a');
      expect(calls().filter((c) => c.op !== 'select')).toEqual([]);
    });

    it('client-supplied companyId cannot override the resolved owner', async () => {
      const r = await invoke(campaignSummaryUpdate, { method: 'PUT', query: { campaignId: LEGACY_A, companyId: CO_B }, body: { objective: 'hijack', companyId: CO_B }, headers: bearer('B') });
      expect(r.status).toBe(403);
      expect(rows('campaigns').find((c) => c.id === LEGACY_A)?.objective).toBe('legacy-a');
    });
  });
});
