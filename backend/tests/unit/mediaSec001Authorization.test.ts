/**
 * MEDIA-SEC-001 — characterization of `/api/media/*` authorization.
 *
 * Before this program all three routes below ran with NO authentication and NO
 * ownership check against the SERVICE-ROLE client:
 *   • GET  /api/media/list    — unscoped read across every tenant
 *   • GET  /api/media/[id]    — read any tenant's row by id
 *   • DELETE /api/media/[id]  — destroy any tenant's file + storage object
 *   • POST /api/media/link    — attach any media to any scheduled post
 *
 * `media_files` and `scheduled_posts` are USER-anchored (both carry `user_id`
 * and no `company_id`), so the tenant boundary is row ownership. These tests
 * pin that model across every caller class, including the deliberate decision
 * that a COMPANY_ADMIN is NOT granted access to another user's media — no
 * company-level sharing is introduced by this security fix.
 */
import { createApiRequestMock, createMockRes } from '../utils/setupApiTest';

// Route factory is pass-through; these tests are about authorization only.
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

const getSupabaseUserFromRequest = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => getSupabaseUserFromRequest(...a),
}));

const isPlatformSuperAdmin = jest.fn();
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  isPlatformSuperAdmin: (...a: unknown[]) => isPlatformSuperAdmin(...a),
}));

const listMediaFiles = jest.fn();
const getMediaFile = jest.fn();
const deleteMediaFile = jest.fn();
const linkMediaToPost = jest.fn();
jest.mock('../../services/mediaService', () => ({
  listMediaFiles: (...a: unknown[]) => listMediaFiles(...a),
  getMediaFile: (...a: unknown[]) => getMediaFile(...a),
  deleteMediaFile: (...a: unknown[]) => deleteMediaFile(...a),
  linkMediaToPost: (...a: unknown[]) => linkMediaToPost(...a),
  getPostMedia: jest.fn(),
}));

/** Rows keyed by table then id, used by the ownership lookups. */
const rows: Record<string, Record<string, { user_id: string | null } | undefined>> = {
  media_files: {},
  scheduled_posts: {},
};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let wantedId = '';
    const chain: any = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        wantedId = val;
        return chain;
      },
      maybeSingle: async () => ({ data: rows[table]?.[wantedId] ?? null, error: null }),
    };
    return chain;
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const listHandler = require('../../../pages/api/media/list').default;
const idHandler = require('../../../pages/api/media/[id]').default;
const linkHandler = require('../../../pages/api/media/link').default;

const OWNER = 'user-owner';
const OTHER = 'user-other';
const ADMIN = 'user-platform-admin';

function asAnonymous() {
  getSupabaseUserFromRequest.mockResolvedValue({ user: null, error: 'no session' });
}
function asUser(id: string, platformAdmin = false) {
  getSupabaseUserFromRequest.mockResolvedValue({ user: { id }, error: null });
  isPlatformSuperAdmin.mockResolvedValue(platformAdmin);
}

beforeEach(() => {
  jest.clearAllMocks();
  isPlatformSuperAdmin.mockResolvedValue(false);
  listMediaFiles.mockResolvedValue([]);
  rows.media_files = { 'media-1': { user_id: OWNER } };
  rows.scheduled_posts = { 'post-1': { user_id: OWNER } };
  getMediaFile.mockImplementation(async (id: string) =>
    id === 'media-1' ? { id: 'media-1', user_id: OWNER, file_name: 'a.png' } : null,
  );
});

// ── GET /api/media/list ────────────────────────────────────────────────
describe('MEDIA-SEC-001 — GET /api/media/list', () => {
  it('ANONYMOUS → 401, and the service is never reached', async () => {
    asAnonymous();
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(listMediaFiles).not.toHaveBeenCalled();
  });

  it('CORRECT TENANT → scoped to the caller, never to an unscoped read', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: {} }), res);
    expect(res.statusCode).toBe(200);
    // The pre-fix defect was `userId` being absent → no predicate at all.
    expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER }));
  });

  it('WRONG TENANT → a client-supplied user_id cannot widen the read', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: { user_id: OTHER } }), res);
    expect(res.statusCode).toBe(200);
    expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER }));
    expect(listMediaFiles).not.toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
  });

  it('COMPANY ADMIN (not platform admin) → still only their own media', async () => {
    asUser(OTHER, false); // a company admin is not a platform SUPER_ADMIN
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: { user_id: OWNER } }), res);
    expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
  });

  it('SUPER ADMIN → may target another owner explicitly', async () => {
    asUser(ADMIN, true);
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: { user_id: OWNER } }), res);
    expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER }));
  });

  it('SUPER ADMIN without user_id → still defaults to their own media', async () => {
    asUser(ADMIN, true);
    const res = createMockRes();
    await listHandler(createApiRequestMock({ method: 'GET', query: {} }), res);
    expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ userId: ADMIN }));
  });

  it('limit is bounded and never NaN', async () => {
    asUser(OWNER);
    for (const [input, expected] of [['5000', 200], ['abc', 50], ['-1', 50]] as const) {
      listMediaFiles.mockClear();
      await listHandler(
        createApiRequestMock({ method: 'GET', query: { limit: input } }),
        createMockRes(),
      );
      expect(listMediaFiles).toHaveBeenCalledWith(expect.objectContaining({ limit: expected }));
    }
  });
});

// ── GET / DELETE /api/media/[id] ───────────────────────────────────────
describe('MEDIA-SEC-001 — /api/media/[id]', () => {
  it('ANONYMOUS GET → 401, nothing read', async () => {
    asAnonymous();
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(401);
    expect(getMediaFile).not.toHaveBeenCalled();
  });

  it('ANONYMOUS DELETE → 401, nothing destroyed', async () => {
    asAnonymous();
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'DELETE', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(401);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('CORRECT TENANT GET → 200 with the row', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe('media-1');
  });

  it('CORRECT TENANT DELETE → 200 and the delete is executed', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'DELETE', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(deleteMediaFile).toHaveBeenCalledWith('media-1');
  });

  it('WRONG TENANT GET → 404 (not 403: no existence oracle)', async () => {
    asUser(OTHER);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Media file not found' });
  });

  it('WRONG TENANT DELETE → 404 and the delete is NOT executed', async () => {
    asUser(OTHER);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'DELETE', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(404);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('a foreign id and a non-existent id are INDISTINGUISHABLE', async () => {
    asUser(OTHER);
    const foreign = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'media-1' } }), foreign);
    const missing = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'nope' } }), missing);
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toEqual(missing.body);
  });

  it('COMPANY ADMIN (not platform admin) → 404 on another user\'s media', async () => {
    asUser(OTHER, false);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'DELETE', query: { id: 'media-1' } }), res);
    expect(res.statusCode).toBe(404);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('SUPER ADMIN → may read and delete across owners', async () => {
    asUser(ADMIN, true);
    const get = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'media-1' } }), get);
    expect(get.statusCode).toBe(200);

    const del = createMockRes();
    await idHandler(createApiRequestMock({ method: 'DELETE', query: { id: 'media-1' } }), del);
    expect(del.statusCode).toBe(200);
    expect(deleteMediaFile).toHaveBeenCalledWith('media-1');
  });

  it('a row with a NULL owner is not readable by an ordinary user (fail closed)', async () => {
    getMediaFile.mockResolvedValue({ id: 'orphan', user_id: null });
    asUser(OTHER);
    const res = createMockRes();
    await idHandler(createApiRequestMock({ method: 'GET', query: { id: 'orphan' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ── POST /api/media/link ───────────────────────────────────────────────
describe('MEDIA-SEC-001 — POST /api/media/link', () => {
  const body = { scheduled_post_id: 'post-1', media_file_id: 'media-1' };

  it('ANONYMOUS → 401, nothing linked', async () => {
    asAnonymous();
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(401);
    expect(linkMediaToPost).not.toHaveBeenCalled();
  });

  it('CORRECT TENANT owning BOTH sides → 200', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(200);
    expect(linkMediaToPost).toHaveBeenCalledWith('post-1', 'media-1', 0);
  });

  it('owns the POST but NOT the media → 404 (cannot pull in a stranger\'s asset)', async () => {
    rows.media_files['media-1'] = { user_id: OTHER };
    asUser(OWNER);
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(404);
    expect(linkMediaToPost).not.toHaveBeenCalled();
  });

  it('owns the MEDIA but NOT the post → 404 (cannot publish from a stranger\'s post)', async () => {
    rows.scheduled_posts['post-1'] = { user_id: OTHER };
    asUser(OWNER);
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(404);
    expect(linkMediaToPost).not.toHaveBeenCalled();
  });

  it('WRONG TENANT owning neither → 404', async () => {
    asUser(OTHER);
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(404);
    expect(linkMediaToPost).not.toHaveBeenCalled();
  });

  it('SUPER ADMIN → may link across owners', async () => {
    rows.media_files['media-1'] = { user_id: OWNER };
    rows.scheduled_posts['post-1'] = { user_id: OTHER };
    asUser(ADMIN, true);
    const res = createMockRes();
    await linkHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(200);
  });

  it('missing / non-string ids → 400 before any ownership lookup', async () => {
    asUser(OWNER);
    const res = createMockRes();
    await linkHandler(
      createApiRequestMock({ method: 'POST', body: { scheduled_post_id: 'post-1' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(linkMediaToPost).not.toHaveBeenCalled();
  });

  it('display_order is coerced to a safe non-negative integer', async () => {
    asUser(OWNER);
    await linkHandler(
      createApiRequestMock({ method: 'POST', body: { ...body, display_order: 'abc' } }),
      createMockRes(),
    );
    expect(linkMediaToPost).toHaveBeenCalledWith('post-1', 'media-1', 0);
  });
});
