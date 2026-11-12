/**
 * SECURITY (2026-11-12, e9: BLOCKING): GET /api/campaigns/ai/plan-status/[jobId] returned a job's
 * partial / full plan to ANY signed-in user. The access check passed the campaign's user_id as a
 * companyId to getUserCompanyRole and then tested only that the caller was authenticated, and a failed
 * or owner-less campaign read skipped even that. Now: authenticate first; every read checked; company
 * membership required; unknown / unresolvable / foreign job -> the SAME 404.
 * In-memory harness: proves route ordering and authorization, not Postgres RLS.
 */
import { seed, invoke, calls, failTable, CAMPAIGN_A, CAMPAIGN_B, CANARY_B, UNKNOWN_ID } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());

import handler from '../../../pages/api/campaigns/ai/plan-status/[jobId]';

const JOB_A = 'job-a-00-0000-0000-00000000000a';
const JOB_B = 'job-b-00-0000-0000-00000000000b';
const JOB_ORPHAN = 'job-o-00-0000-0000-00000000000o';
const NOT_FOUND = { error: 'Not found', code: 'NOT_FOUND' };

function world() {
  seed({
    campaign_plan_jobs: [
      { id: JOB_A, campaign_id: CAMPAIGN_A, status: 'layer2', partial_result: { draft: 'A partial plan' }, updated_at: '2026-11-12T10:00:00Z' },
      { id: JOB_B, campaign_id: CAMPAIGN_B, status: 'layer2', partial_result: { draft: `B secret ${CANARY_B}` }, updated_at: '2026-11-12T10:00:00Z' },
      { id: JOB_ORPHAN, campaign_id: 'camp-none-0000-0000-000000000000', status: 'layer2', partial_result: { draft: 'orphan' }, updated_at: '2026-11-12T10:00:00Z' },
    ],
    campaign_week_plan: [
      { campaign_id: CAMPAIGN_B, source: 'v2_pipeline', blueprint: { total_posts: 9, secret: CANARY_B }, snapshot_hash: 'h', created_at: '2026-11-12' },
    ],
  });
}
const get = (jobId: string, as: 'A' | 'B' | 'SUPER' | null) => invoke(handler as never, { method: 'GET', query: { jobId }, as });
const reads = () => calls().filter((c) => c.table === 'campaign_plan_jobs' || c.table === 'campaigns');

describe('plan-status: company membership is required, and nothing leaks', () => {
  it('ANONYMOUS: 401, the same for an existing and an unknown job, and no row is read', async () => {
    world();
    const a = await get(JOB_A, null);
    const u = await get(UNKNOWN_ID, null);
    expect([a.status, u.status]).toEqual([401, 401]);
    expect(u.body).toEqual(a.body);
    expect(reads()).toEqual([]);
  });

  it('the OWNER company member sees its job', async () => {
    world();
    const r = await get(JOB_A, 'A');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ jobId: JOB_A, status: 'layer2', partial: { draft: 'A partial plan' } });
  });

  it('a member of ANOTHER company gets the SAME 404 as an unknown or an orphan job, and no data leaks', async () => {
    world();
    const foreign = await get(JOB_B, 'A');
    const unknown = await get(UNKNOWN_ID, 'A');
    const orphan = await get(JOB_ORPHAN, 'A');
    for (const r of [foreign, unknown, orphan]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(NOT_FOUND);
    }
    expect(JSON.stringify(foreign.body)).not.toContain(CANARY_B);
  });

  it('a COMPLETED foreign job does not leak its full plan either', async () => {
    world();
    seed({
      campaign_plan_jobs: [{ id: JOB_B, campaign_id: CAMPAIGN_B, status: 'complete', partial_result: null, updated_at: '2026-11-12' }],
      campaign_week_plan: [{ campaign_id: CAMPAIGN_B, source: 'v2_pipeline', blueprint: { total_posts: 9, secret: CANARY_B }, snapshot_hash: 'h', created_at: '2026-11-12' }],
    });
    const r = await get(JOB_B, 'A');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(CANARY_B);
  });

  it.each([
    ['the job read', 'campaign_plan_jobs', 'PLAN_JOB_UNAVAILABLE'],
    ['the campaign read', 'campaigns', 'CAMPAIGN_UNAVAILABLE'],
  ])('%s errors -> 503 (retryable), never an unchecked answer', async (_l, table, code) => {
    world();
    failTable(table, 'select');
    const r = await get(JOB_A, 'A');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code, retryable: true });
  });

  it('a completed job whose plan read errors -> 503, never "processing at 95%" forever', async () => {
    world();
    seed({
      campaign_plan_jobs: [{ id: JOB_A, campaign_id: CAMPAIGN_A, status: 'complete', partial_result: null, updated_at: '2026-11-12' }],
    });
    failTable('campaign_week_plan', 'select');
    const r = await get(JOB_A, 'A');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'PLAN_UNAVAILABLE' });
  });
});
