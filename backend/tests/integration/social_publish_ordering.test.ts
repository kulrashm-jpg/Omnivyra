/**
 * WSF-ORD-006 — /api/social/publish performs no side effect before ownership.
 *
 * THE DEFECT: the ownership check (post owner OR super-admin) sat BELOW the
 * capability, readiness and media-accessibility gates. Everything above it ran
 * for ANY authenticated caller against ANY post id, so a non-owner could:
 *
 *   - make the three rejection paths call logAuditEvent, inserting audit rows
 *     stamped with the POST OWNER's id as companyId;
 *   - make assertMediaAccessible issue outbound safeFetch probes at another
 *     tenant's media URLs — the route as a request-forwarding primitive;
 *   - read the post's platform and rejection reason out of the 400 body;
 *   - and, via the handler-wide catch{}, have an arbitrary post_id stamped
 *     status=FAILED when anything threw before ownership was settled.
 *
 * This suite drives the REAL handler, in the style of its sibling
 * social_publish_authorization.test.ts (R6-B), and asserts the sinks are never
 * reached rather than only asserting the status code.
 */

import {
  idempotencyHeaders,
  resetIdempotency,
  withIdempotencyTable,
} from '../utils/idempotency';

jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());

jest.mock('../../db/writeOwner', () => {
  const actual = jest.requireActual('../../db/writeOwner');
  return {
    ...actual,
    ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable(actual.ownedDbTable)),
  };
});

const mockPublishNow = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockIsSuperAdmin = jest.fn();
const mockAssertMediaAccessible = jest.fn();
const mockResolveCapability = jest.fn();
const mockValidateReadiness = jest.fn();
const mockLogAuditEvent = jest.fn(async () => undefined);
const mockUpdatePostPublishStatus = jest.fn(async (_p: Record<string, unknown>) => undefined);

/** Every `scheduled_posts` row patch the route performs through supabase. */
let postUpdates: Array<Record<string, unknown>> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.limit = () => builder;
      builder.single = () => Promise.resolve({ data: null, error: null });
      builder.maybeSingle = () =>
        table === 'social_accounts'
          ? Promise.resolve({ data: { id: 'acct-1' }, error: null })
          : Promise.resolve({ data: null, error: null });
      builder.update = (payload: Record<string, unknown>) => {
        if (table === 'scheduled_posts') postUpdates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return builder;
    },
  },
}));

jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: unknown[]) => mockGetScheduledPost(...a) }));
jest.mock('../../db/scheduledPostsStore', () => ({
  updatePostPublishStatus: (...a: unknown[]) => (mockUpdatePostPublishStatus as any)(...a),
}));
jest.mock('../../services/publishNowService', () => ({ publishNow: (...a: unknown[]) => mockPublishNow(...a) }));
jest.mock('../../services/rbacService', () => ({ isSuperAdmin: (...a: unknown[]) => mockIsSuperAdmin(...a) }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async (req: { headers?: Record<string, string> }) =>
    req.headers?.authorization ? { user: { id: 'user-1' }, error: null } : { user: null, error: 'no auth' }),
}));
jest.mock('../../services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: (...a: unknown[]) => mockResolveCapability(...a),
}));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: (...a: unknown[]) => (mockLogAuditEvent as any)(...a) }));
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: (...a: unknown[]) => mockValidateReadiness(...a),
  assertMediaAccessible: (...a: unknown[]) => mockAssertMediaAccessible(...a),
}));

import handler from '../../../pages/api/social/publish';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}

const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', body, headers: { ...idempotencyHeaders(), authorization: 'Bearer t' } }) as never;

/** `user-1` is the caller; `user-2` is somebody else's post. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  user_id: 'user-1',
  platform: 'linkedin',
  content: 'Hello world.',
  content_type: 'post',
  media_urls: [],
  status: 'scheduled',
  campaign_id: null,
  platform_post_id: null,
  is_thread_start: false,
  social_account_id: 'acct-1',
  scheduled_for: '2026-09-01T09:00:00Z',
  ...over,
});

async function call(over: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  mockGetScheduledPost.mockResolvedValue(row(over));
  const res = mockRes();
  await handler(post({ post_id: 'post-1', ...body }), res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetIdempotency();
  postUpdates = [];
  mockIsSuperAdmin.mockResolvedValue(false);
  mockResolveCapability.mockReturnValue({ status: 'api_verified' });
  mockValidateReadiness.mockReturnValue({ ok: true, warnings: [] });
  mockAssertMediaAccessible.mockResolvedValue(null);
  mockPublishNow.mockResolvedValue({
    status: 'PUBLISHED', external_post_id: 'ext-1', post_url: 'https://x/1',
    timestamp: '2026-09-01T09:00:00Z',
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/** Everything the route must not touch before it knows who owns the post. */
function expectNoPreOwnershipSideEffects() {
  expect(mockResolveCapability).not.toHaveBeenCalled();
  expect(mockValidateReadiness).not.toHaveBeenCalled();
  expect(mockAssertMediaAccessible).not.toHaveBeenCalled();
  expect(mockLogAuditEvent).not.toHaveBeenCalled();
  expect(mockPublishNow).not.toHaveBeenCalled();
  expect(mockUpdatePostPublishStatus).not.toHaveBeenCalled();
  expect(postUpdates).toEqual([]);
}

describe("WSF-ORD-006 — a non-owner reaches none of the route's side effects", () => {
  it('THE EXPLOIT (audit): an unsupported platform used to insert an audit row stamped with the owner — now 403, no audit', async () => {
    mockResolveCapability.mockReturnValue({ status: 'unsupported', reason: 'Publishing is not supported on threads.' });
    const res = await call({ user_id: 'user-2', platform: 'threads' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden: you do not own this post' });
    expectNoPreOwnershipSideEffects();
  });

  it('THE EXPLOIT (audit): a readiness rejection used to insert an audit row — now 403, no audit', async () => {
    mockValidateReadiness.mockReturnValue({ ok: false, code: 'MEDIA_REQUIRED', message: 'Instagram needs media', warnings: [], context: {} });
    const res = await call({ user_id: 'user-2', platform: 'instagram' });
    expect(res.statusCode).toBe(403);
    expectNoPreOwnershipSideEffects();
  });

  it("THE EXPLOIT (SSRF-shaped): the route used to safeFetch another tenant's media URLs — now 403, no probe", async () => {
    const res = await call({ user_id: 'user-2', media_urls: ['https://cdn.example.test/private/asset.png'] });
    expect(res.statusCode).toBe(403);
    expect(mockAssertMediaAccessible).not.toHaveBeenCalled();
    expectNoPreOwnershipSideEffects();
  });

  it('THE EXPLOIT (disclosure): the 403 body reveals neither the platform nor any rejection reason', async () => {
    mockResolveCapability.mockReturnValue({ status: 'unsupported', reason: 'Publishing is not supported on threads.' });
    const res = await call({ user_id: 'user-2', platform: 'threads' });
    expect(JSON.stringify(res.body)).not.toMatch(/threads|not supported/i);
  });

  it('THE EXPLOIT (status stamp): a throw before ownership no longer marks an arbitrary post FAILED', async () => {
    mockGetScheduledPost.mockRejectedValue(new Error('lookup exploded'));
    const res = mockRes();
    await handler(post({ post_id: 'somebody-elses-post' }), res);
    expect(res.statusCode).toBe(500);
    expect(mockUpdatePostPublishStatus).not.toHaveBeenCalled();
  });

  it('a missing post is still a 404 and still writes nothing', async () => {
    mockGetScheduledPost.mockResolvedValue(null);
    const res = mockRes();
    await handler(post({ post_id: 'nope' }), res);
    expect(res.statusCode).toBe(404);
    expectNoPreOwnershipSideEffects();
  });
});

describe('WSF-ORD-006 — the owner and the super-admin are unaffected', () => {
  it('the owner still publishes → 200, and the gates still ran in their old order', async () => {
    const res = await call({ media_urls: ['https://cdn.example.test/a.png'] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED' });
    expect(mockResolveCapability).toHaveBeenCalledTimes(1);
    expect(mockValidateReadiness).toHaveBeenCalledTimes(1);
    expect(mockAssertMediaAccessible).toHaveBeenCalledTimes(1);
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it("a super-admin still publishes somebody else's post → 200", async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    const res = await call({ user_id: 'user-2' });
    expect(res.statusCode).toBe(200);
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it("the owner's unsupported platform still answers 400 and still writes its audit row", async () => {
    mockResolveCapability.mockReturnValue({ status: 'unsupported', reason: 'Publishing is not supported on threads.' });
    const res = await call({ platform: 'threads' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'ACTION_NOT_SUPPORTED', platform: 'threads' });
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("the owner's readiness rejection still answers 400 and still writes its audit row", async () => {
    mockValidateReadiness.mockReturnValue({ ok: false, code: 'MEDIA_REQUIRED', message: 'Instagram needs media', warnings: [], context: {} });
    const res = await call({ platform: 'instagram' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'MEDIA_REQUIRED' });
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("the owner's dead media still answers 400 and still writes its audit row", async () => {
    mockAssertMediaAccessible.mockResolvedValue({ code: 'MEDIA_UNREACHABLE', message: 'asset is gone' });
    const res = await call({ media_urls: ['https://cdn.example.test/a.png'] });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'MEDIA_UNREACHABLE' });
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("a failure AFTER ownership still marks the owner's post FAILED (behaviour preserved)", async () => {
    mockPublishNow.mockRejectedValue(new Error('adapter exploded'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(mockUpdatePostPublishStatus).toHaveBeenCalledWith(
      expect.objectContaining({ post_id: 'post-1', status: 'FAILED', last_error: 'adapter exploded' }),
    );
  });

  it('dry_run for the owner still answers DRY_RUN and never publishes', async () => {
    const res = await call({}, { dry_run: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'DRY_RUN' });
    expect(mockPublishNow).not.toHaveBeenCalled();
  });
});
