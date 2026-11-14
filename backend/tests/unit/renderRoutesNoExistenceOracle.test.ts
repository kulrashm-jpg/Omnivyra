/**
 * render-image / render-status: no existence oracle (e9 follow-up, 2026-11-11).
 *
 * Before: both routes read daily_content_plans on the service-role client and answered
 * "Row not found: <id>" / 409 NOT_A_CREATOR_ROW / 403 "Company unresolved." BEFORE
 * enforceCompanyAccess, so any caller (signed in or not) could tell a missing plan id from a
 * foreign one and learn a foreign row's intent_type. Now (authorizedPlanRow.ts):
 *   - the rendering flag is still answered first;
 *   - an unauthenticated caller gets 401 and NO row is read;
 *   - unknown, company-unresolvable and foreign plan ids get the SAME 404 body;
 *   - the intent_type 409 is reached only by an authorized caller.
 * In-memory harness: proves route ordering, not Postgres RLS.
 */
import {
  seed, invoke, calls, CAMPAIGN_A, UNKNOWN_ID, USER_A,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());

import renderImageHandler from '../../../pages/api/activity-workspace/[id]/render-image';
import renderStatusHandler from '../../../pages/api/activity-workspace/[id]/render-status';
import { loadAuthorizedPlanRow } from '../../services/creator/rendering/authorizedPlanRow';

const PLAN_CREATOR = 'plan-c-0-0000-0000-00000000000c';
const PLAN_TEXT = 'plan-t-0-0000-0000-00000000000t';
const PLAN_ORPHAN = 'plan-o-0-0000-0000-00000000000o';
const NOT_FOUND = { error: 'Not found', code: 'NOT_FOUND' };

function world() {
  seed({
    daily_content_plans: [
      { id: PLAN_CREATOR, campaign_id: CAMPAIGN_A, intent_type: 'creator', content: {}, content_type: 'image', platform: 'linkedin', organization_id: null },
      { id: PLAN_TEXT, campaign_id: CAMPAIGN_A, intent_type: 'text', content: {}, content_type: 'text', platform: 'linkedin', organization_id: null },
      { id: PLAN_ORPHAN, campaign_id: 'camp-none-0000-0000-000000000000', intent_type: 'creator', content: {}, content_type: 'image', platform: 'linkedin', organization_id: null },
    ],
  });
}

const ENV_KEYS = ['ENABLE_CREATOR_RENDERING', 'ENABLE_CREATOR_RENDER_QUEUE'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; process.env[k] = 'true'; } });
afterAll(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const ROUTES = [
  ['render-image', renderImageHandler, 'POST'],
  ['render-status', renderStatusHandler, 'GET'],
] as const;

const planReads = () => calls().filter((c) => c.table === 'daily_content_plans' || c.table === 'campaigns');

describe.each(ROUTES)('%s: auth and access before anything about the row is disclosed', (_name, handler, method) => {
  const call = (planId: string, as: 'A' | 'B' | null) =>
    invoke(handler as never, { method, query: { id: planId }, body: {}, as });

  it('flag OFF still answers first (404 RENDERING/QUEUE disabled), before auth', async () => {
    world();
    process.env.ENABLE_CREATOR_RENDERING = 'false';
    try {
      const r = await call(PLAN_CREATOR, null);
      expect(r.status).toBe(404);
      expect((r.body as { code?: string }).code).toMatch(/DISABLED/);
      expect(planReads()).toEqual([]);
    } finally { process.env.ENABLE_CREATOR_RENDERING = 'true'; }
  });

  it('unauthenticated: the SAME 401 for an existing, a text and a missing plan, and no row is read', async () => {
    world();
    const a = await call(PLAN_CREATOR, null);
    const b = await call(PLAN_TEXT, null);
    const c = await call(UNKNOWN_ID, null);
    expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(planReads()).toEqual([]);
  });

  it('a non-member gets the SAME 404 for a foreign Creator row, a foreign text row, an orphan row and a missing id', async () => {
    world();
    const foreign = await call(PLAN_CREATOR, 'B');
    const foreignText = await call(PLAN_TEXT, 'B');
    const orphan = await call(PLAN_ORPHAN, 'B');
    const missing = await call(UNKNOWN_ID, 'B');
    for (const r of [foreign, foreignText, orphan, missing]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(NOT_FOUND);
      expect(r.extraSends).toEqual([]);
    }
  });

  it('a member on a missing id also gets the uniform 404 (no "Row not found: <id>" echo)', async () => {
    world();
    const r = await call(UNKNOWN_ID, 'A');
    expect(r.status).toBe(404);
    expect(r.body).toEqual(NOT_FOUND);
  });

  it('the intent_type 409 is reached only by an authorized member', async () => {
    world();
    const r = await call(PLAN_TEXT, 'A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_A_CREATOR_ROW' });
  });

  it('a plan-store read error answers 500 without echoing the id', async () => {
    world();
    const { failTable } = jest.requireActual('../helpers/routeAuthHarness');
    failTable('daily_content_plans', 'select');
    const r = await call(PLAN_CREATOR, 'A');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain(PLAN_CREATOR);
  });
});

describe('loadAuthorizedPlanRow returns the AUTHORIZED principal', () => {
  it('a member gets the row, its company and the UserContext enforceCompanyAccess granted (render-image uses it as created_by)', async () => {
    world();
    let got: Awaited<ReturnType<typeof loadAuthorizedPlanRow>> = null;
    const r = await invoke((async (req: any, res: any) => {
      got = await loadAuthorizedPlanRow(req, res, PLAN_CREATOR, 'id, intent_type');
      if (got) res.status(200).json({ ok: true });
    }) as never, { method: 'GET', as: 'A' });
    expect(r.status).toBe(200);
    expect(got).not.toBeNull();
    expect(got!.row).toMatchObject({ id: PLAN_CREATOR, intent_type: 'creator' });
    expect(got!.access.userId).toBe(USER_A);
  });
});
