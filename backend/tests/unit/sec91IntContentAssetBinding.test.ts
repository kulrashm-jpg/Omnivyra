/**
 * STEP 3AH-91 integration — findings W2-G surfaced outside its registry.
 *
 * SEC91-W2G-N1 (P2): POST /api/content/approve and /api/content/reject proved
 * membership of the body `companyId` (+ a role via withRBAC) and then acted on
 * the body `assetId` without binding it to that company, so a role holder of
 * company A could approve or reject company B's content asset by id. The
 * approver was also a body field (attribution forgery). Now the asset's owning
 * company (asset → campaign → campaign_versions, the sibling regenerate.ts
 * guard) must equal the authorized company, and the approver is the principal.
 *
 * SEC91-W2G-N2 (P3): /api/company/blogs POST/DELETE checked membership only, so
 * VIEW_ONLY could create and delete blogs. Writes now need the content-authoring
 * role set (W2G-1 policy); reads are unchanged.
 *
 * The real guard chain runs; only the DB, identity provider and sinks are fake.
 */
import { seed, invoke, writeCalls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';
import { roleRows } from '../helpers/sec91W2AHarness';
import { as, w2gRoleRows, type W2GPrincipal } from '../helpers/sec91W2GHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const mockApprove = jest.fn(async (i: any) => ({ asset_id: i.assetId, status: 'reviewed' }));
const mockReject = jest.fn(async (i: any) => ({ asset_id: i.assetId, status: 'draft' }));
jest.mock('../../services/contentAssetService', () => ({
  approveContentAsset: (i: any) => mockApprove(i),
  rejectContentAsset: (i: any) => mockReject(i),
}));
const mockCreateBlog = jest.fn(async (_companyId: string, _userId: string, i: any) => ({ blog: { id: 'new-blog', ...i }, error: null }));
jest.mock('../../services/blogService', () => ({
  createBlog: (companyId: string, userId: string, i: any) => mockCreateBlog(companyId, userId, i),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const approve = require('../../../pages/api/content/approve').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reject = require('../../../pages/api/content/reject').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const blogs = require('../../../pages/api/company/blogs').default;

const ASSET_A = 'asset-a-0-0000-0000-00000000000a';
const ASSET_B = 'asset-b-0-0000-0000-00000000000b';
const ASSET_ORPHAN = 'asset-o-0-0000-0000-00000000000o';
const BLOG_A = 'blog-a-00-0000-0000-00000000000a';

beforeEach(() => {
  seed({
    user_company_roles: [...roleRows(), ...w2gRoleRows()],
    content_assets: [
      { asset_id: ASSET_A, campaign_id: CAMPAIGN_A, status: 'draft' },
      { asset_id: ASSET_B, campaign_id: CAMPAIGN_B, status: 'draft' },
      { asset_id: ASSET_ORPHAN, campaign_id: 'camp-without-version-row', status: 'draft' },
    ],
    blogs: [{ id: BLOG_A, company_id: CO_A, title: 'Blog A' }],
  });
  mockApprove.mockClear();
  mockReject.mockClear();
  mockCreateBlog.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const post = (h: any, who: W2GPrincipal, body: Record<string, unknown>) =>
  invoke(h, { method: 'POST', body, headers: as(who) });

describe('SEC91-W2G-N1 — content approve/reject bind the asset to the authorized company', () => {
  // Pre-existing (unchanged): withRBAC compares the NORMALISED membership role
  // (ADMIN → COMPANY_ADMIN, CONTENT_MANAGER → CONTENT_CREATOR) against the literal
  // list [SUPER_ADMIN, ADMIN, CONTENT_MANAGER], so on this tree only platform
  // super admins reach these handlers. N1 is therefore latent today and would
  // open the moment that list is corrected; the binding makes it safe either way.
  it('precondition (pre-existing role list): company roles are refused by withRBAC; platform super admin reaches the handler', async () => {
    for (const who of ['A', 'LEGACY_ADMIN', 'LEGACY_MANAGER', 'CREATOR', 'VIEWER'] as W2GPrincipal[]) {
      expect((await post(approve, who, { companyId: CO_A, assetId: ASSET_A })).status).toBe(403);
    }
    expect(mockApprove).not.toHaveBeenCalled();
    expect((await post(approve, 'SUPER', { companyId: CO_A, assetId: ASSET_A })).status).toBe(200);
  });

  it.each([
    ['approve', () => approve, () => mockApprove, {}],
    ['reject', () => reject, () => mockReject, { reason: 'Needs revisions' }],
  ])('CRITICAL (%s): naming company A with B’s asset → 403, B untouched', async (_n, h, sink, extra) => {
    const r = await post(h(), 'SUPER', { companyId: CO_A, assetId: ASSET_B, ...extra });
    expect(r.status).toBe(403);
    expect(sink()).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', () => approve, () => mockApprove, {}],
    ['reject', () => reject, () => mockReject, { reason: 'Needs revisions' }],
  ])('%s: unknown asset → 404; asset whose owner cannot be resolved → 403 (fail closed)', async (_n, h, sink, extra) => {
    expect((await post(h(), 'SUPER', { companyId: CO_A, assetId: 'asset-missing', ...extra })).status).toBe(404);
    expect((await post(h(), 'SUPER', { companyId: CO_A, assetId: ASSET_ORPHAN, ...extra })).status).toBe(403);
    expect(sink()).not.toHaveBeenCalled();
  });

  it('LEGITIMATE: the asset under its own company is approved; the approver is the principal, never the body', async () => {
    const r = await post(approve, 'SUPER', { companyId: CO_B, assetId: ASSET_B, approver: 'someone-else' });
    expect(r.status).toBe(200);
    expect(mockApprove).toHaveBeenCalledTimes(1);
    const arg = mockApprove.mock.calls[0][0] as { assetId: string; approver: string };
    expect(arg.assetId).toBe(ASSET_B);
    expect(arg.approver).not.toBe('someone-else');
    expect(arg.approver).toBe('user-s-00-0000-0000-00000000000s');
  });

  it('LEGITIMATE: the asset under its own company is rejected', async () => {
    const r = await post(reject, 'SUPER', { companyId: CO_A, assetId: ASSET_A, reason: 'Needs revisions' });
    expect(r.status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith({ assetId: ASSET_A, reason: 'Needs revisions' });
  });
});

describe('SEC91-W2G-N2 — /api/company/blogs writes need a content-authoring role', () => {
  const blogPost = (who: W2GPrincipal) => invoke(blogs, { method: 'POST', body: { company_id: CO_A, title: 'New post' }, headers: as(who) });
  const blogDelete = (who: W2GPrincipal) => invoke(blogs, { method: 'DELETE', query: { company_id: CO_A, id: BLOG_A }, headers: as(who) });

  it.each(['VIEWER', 'ENGAGER', 'LEGACY_VIEWER', 'SPLIT'] as W2GPrincipal[])('CRITICAL: read-only %s cannot create or delete company A blogs', async (who) => {
    expect((await blogPost(who)).status).toBe(403);
    expect((await blogDelete(who)).status).toBe(403);
    expect(mockCreateBlog).not.toHaveBeenCalled();
    expect(writeCalls(['blogs'])).toEqual([]);
  });

  it.each(['A', 'CREATOR', 'PUBLISHER', 'REVIEWER', 'SUPER'] as W2GPrincipal[])('LEGITIMATE: %s can still create and delete', async (who) => {
    expect((await blogPost(who)).status).not.toBe(403);
    expect(mockCreateBlog).toHaveBeenCalled();
    expect((await blogDelete(who)).status).toBe(200);
  });

  it('reads are unchanged for read-only roles', async () => {
    const r = await invoke(blogs, { method: 'GET', query: { company_id: CO_A }, headers: as('VIEWER') });
    expect(r.status).toBe(200);
  });

  it('a member of B only is still refused on company A (tenant binding unchanged)', async () => {
    expect((await blogPost('B')).status).toBe(403);
    expect((await blogDelete('B')).status).toBe(403);
  });
});
