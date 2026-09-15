/**
 * SEC-91A (STEP 3AH-91) — A2: GET /api/calendar/activity-events standalone posts.
 *
 * Standalone (campaign-less) scheduled posts are selected by AUTHOR — every
 * active member of the requested company — because scheduled_posts has no
 * company column. A user who belongs to two companies therefore had the
 * standalone posts they made for company B (content + media) shown on company
 * A's calendar to every member of A. Posts made through a social account that
 * is attributed to another company are now dropped; legacy rows (no account, or
 * an account without a company) are unchanged.
 */
import { seed, invoke, failTable, CO_A, CO_B, CANARY_B } from '../helpers/routeAuthHarness';
import { bearer, USER_DUAL } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const calendar = require('../../../pages/api/calendar/activity-events').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const post = (id: string, account: string | null, content: string) => ({
  id, user_id: USER_DUAL, campaign_id: null, social_account_id: account, platform: 'linkedin',
  title: id, content, scheduled_for: '2026-06-15T09:00:00.000Z', status: 'scheduled',
  content_type: 'post', media_urls: [], media_types: [],
});

beforeEach(() => {
  seed({
    user_company_roles: [
      { user_id: USER_DUAL, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
      { user_id: USER_DUAL, company_id: CO_B, role: 'CONTENT_CREATOR', status: 'active' },
    ],
    social_accounts: [
      { id: 'acct-a', company_id: CO_A, user_id: USER_DUAL },
      { id: 'acct-b', company_id: CO_B, user_id: USER_DUAL },
      { id: 'acct-legacy', company_id: null, user_id: USER_DUAL },
    ],
    scheduled_posts: [
      post('p-a', 'acct-a', 'for company A'),
      post('p-b', 'acct-b', `for company B ${CANARY_B}`),
      post('p-legacy', 'acct-legacy', 'legacy account'),
      post('p-none', null, 'no account'),
    ],
  });
});

const get = (companyId: string, who: Parameters<typeof bearer>[0] | null) =>
  invoke(calendar, { method: 'GET', query: { companyId, start: '2026-06-01', end: '2026-06-30' }, headers: who ? bearer(who) : {} });
const ids = (body: unknown) => (Array.isArray(body) ? body : []).map((e: { scheduled_post_id?: string }) => e.scheduled_post_id).filter(Boolean).sort();

describe('GET /api/calendar/activity-events — standalone posts stay in their company', () => {
  it('unauthenticated → 401', async () => {
    expect((await get(CO_A, null)).status).toBe(401);
  });

  it('member of A asking for B → 403', async () => {
    expect((await get(CO_B, 'A')).status).toBe(403);
  });

  it('THE LEAK: A\'s calendar no longer shows the shared member\'s post made through B\'s account', async () => {
    const r = await get(CO_A, 'A');
    expect(r.status).toBe(200);
    expect(ids(r.body)).toEqual(['p-a', 'p-legacy', 'p-none']);
    expect(JSON.stringify(r.body)).not.toContain(CANARY_B);
  });

  it('B\'s calendar still shows it (and not A\'s account post)', async () => {
    const r = await get(CO_B, 'B');
    expect(r.status).toBe(200);
    expect(ids(r.body)).toEqual(['p-b', 'p-legacy', 'p-none']);
  });

  it('the account lookup failing fails closed → 500, nothing returned', async () => {
    failTable('social_accounts');
    const r = await get(CO_A, 'A');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain(CANARY_B);
  });
});
