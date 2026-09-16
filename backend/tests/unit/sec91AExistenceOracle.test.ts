/**
 * SEC-91A (STEP 3AH-91) — A6: anonymous existence oracles.
 *
 * These routes looked the object up BEFORE authenticating, so an anonymous
 * caller got 404 for an unknown id and 401 for a real one — confirming which
 * UUIDs are live campaigns / recommendations (ROUTE-AUTH-001 removed the same
 * oracle from requireCampaignAccess). Each now authenticates first: every
 * anonymous request gets the same 401 and no object read runs.
 *
 * (The AUTHENTICATED 403-vs-404 distinction is deliberately kept — see
 * docs/security/SEC91_A.md §A6.)
 */
import { seed, invoke, calls, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const campaignById = require('../../../pages/api/campaigns/[id]').default;
const performance = require('../../../pages/api/campaigns/[id]/performance').default;
const continuity = require('../../../pages/api/campaigns/[id]/continuity').default;
const share = require('../../../pages/api/recommendations/[id]/share').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const SNAP_B = 'snap-b-00-0000-0000-00000000000b';
const SNAP_A = 'snap-a-00-0000-0000-00000000000a';

beforeEach(() => {
  seed({
    recommendation_snapshots: [
      { id: SNAP_A, company_id: CO_A, campaign_id: CAMPAIGN_A, trend_topic: 'a' },
      { id: SNAP_B, company_id: CO_B, campaign_id: CAMPAIGN_B, trend_topic: 'b' },
    ],
  });
});

const OBJECT_TABLES = ['campaigns', 'campaign_versions', 'recommendation_snapshots'];
const objectReads = () => calls().filter((c) => OBJECT_TABLES.includes(c.table));

const cases = [
  { name: 'GET campaigns/[id]', handler: campaignById, method: 'GET', real: CAMPAIGN_B },
  { name: 'GET campaigns/[id]/performance', handler: performance, method: 'GET', real: CAMPAIGN_B },
  { name: 'GET campaigns/[id]/continuity', handler: continuity, method: 'GET', real: CAMPAIGN_B },
  { name: 'POST recommendations/[id]/share', handler: share, method: 'POST', real: SNAP_B },
];

describe.each(cases)('$name', ({ handler, method, real }) => {
  it('anonymous: a real id and an unknown id get the identical 401, and no object is read', async () => {
    const a = await invoke(handler, { method, query: { id: real } });
    const u = await invoke(handler, { method, query: { id: UNKNOWN_ID } });
    expect(a.status).toBe(401);
    expect(u.status).toBe(401);
    expect(a.body).toEqual(u.body);
    expect(objectReads()).toEqual([]);
  });

  it('authenticated non-member of the owner → still refused (403/404), nothing leaked', async () => {
    const r = await invoke(handler, { method, query: { id: real }, headers: bearer('A') });
    expect([403, 404]).toContain(r.status);
    expect(JSON.stringify(r.body)).not.toContain(CO_B);
  });
});

describe('authenticated owners are unaffected', () => {
  it('GET campaigns/[id] by A on A\'s campaign → 200', async () => {
    const r = await invoke(campaignById, { method: 'GET', query: { id: CAMPAIGN_A }, headers: bearer('A') });
    expect(r.status).toBe(200);
    expect(r.body.campaign.id).toBe(CAMPAIGN_A);
  });

  it('POST recommendations/[id]/share by A on A\'s snapshot → 200', async () => {
    const r = await invoke(share, { method: 'POST', query: { id: SNAP_A }, headers: bearer('A') });
    expect(r.status).toBe(200);
  });
});
