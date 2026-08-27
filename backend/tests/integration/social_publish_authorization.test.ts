/**
 * R6-B — /api/social/publish converges with the canonical publish authorization.
 *
 * Before R6-B this route validated platform capability and media but read
 * neither `status` nor `campaign_id`, so a campaign post could be published
 * straight past the release decision made in the planner (P1/B1). R6-A proved
 * the exposure was latent rather than realized (zero campaign-linked rows in
 * that state live), and that closing it costs nothing for standalone
 * publishing — the two stage-then-publish surfaces create
 * `status='scheduled'`, `campaign_id=null` rows.
 *
 * This suite exercises the REAL handler, not a re-implementation of it.
 *
 * The two properties that matter most:
 *   - a campaign-linked DRAFT can no longer be published here, at all
 *   - a standalone SCHEDULED post still publishes, because PromotionWorkspace
 *     depends on exactly that
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  idempotencyHeaders,
  resetIdempotency,
  withIdempotencyTable,
} from '../utils/idempotency';

// This route adopted the caller-scoped withIdempotency middleware, so the
// suite must supply an authenticated caller and a working key table — the
// repository's canonical harness (see campaign_scheduler_integrity.test.ts).
// AUTHENTICATION only: the route's own authorization still runs and is what
// this suite asserts.
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());

jest.mock('../../db/writeOwner', () => {
  const actual = jest.requireActual('../../db/writeOwner');
  return {
    ...actual,
    ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable(actual.ownedDbTable)),
  };
});

/* ── Mocks: everything the route touches except the seam under test ─────── */

const mockPublishNow = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockIsSuperAdmin = jest.fn();
const mockAssertMediaAccessible = jest.fn();
const mockResolveCapability = jest.fn();
const mockValidateReadiness = jest.fn();

/** Rows returned for `campaigns` lookups, keyed by id. */
let campaignRows: Record<string, { status?: string } | null> = {};
/** Set to simulate an unreadable campaign (fail-closed path). */
let campaignReadError: { message: string } | null = null;
/** Every `scheduled_posts` update the route performs. */
let postUpdates: Array<Record<string, unknown>> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        if (col === 'id') builder.__id = String(val);
        return builder;
      };
      builder.in = () => builder;
      builder.limit = () => builder;
      builder.single = () => {
        if (table === 'campaigns') {
          if (campaignReadError) return Promise.resolve({ data: null, error: campaignReadError });
          const id = builder.__id;
          return Promise.resolve({ data: campaignRows[id] ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      builder.maybeSingle = () => {
        if (table === 'social_accounts') {
          return Promise.resolve({ data: { id: 'acct-1' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      builder.update = (payload: Record<string, unknown>) => {
        if (table === 'scheduled_posts') postUpdates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return builder;
    },
  },
}));

// The campaigns lookup filters by id; capture it so `single()` can answer.
jest.mock('../../db/queries', () => ({
  getScheduledPost: (...a: unknown[]) => mockGetScheduledPost(...a),
}));
jest.mock('../../db/scheduledPostsStore', () => ({
  updatePostPublishStatus: jest.fn(async (p: Record<string, unknown>) => { postUpdates.push(p); }),
}));
jest.mock('../../services/publishNowService', () => ({
  publishNow: (...a: unknown[]) => mockPublishNow(...a),
}));
jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: (...a: unknown[]) => mockIsSuperAdmin(...a),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async (req: { headers?: Record<string, string> }) =>
    req.headers?.authorization ? { user: { id: 'user-1' }, error: null } : { user: null, error: 'no auth' }),
}));
jest.mock('../../services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: (...a: unknown[]) => mockResolveCapability(...a),
}));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: (...a: unknown[]) => mockValidateReadiness(...a),
  assertMediaAccessible: (...a: unknown[]) => mockAssertMediaAccessible(...a),
}));

import handler from '../../../pages/api/social/publish';

/* ── Harness ────────────────────────────────────────────────────────────── */

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}

const post = (body: Record<string, unknown>, authed = true) =>
  ({
    method: 'POST',
    body,
    headers: {
      ...idempotencyHeaders(),
      ...(authed ? { authorization: 'Bearer t' } : {}),
    },
  }) as never;

/** A scheduled_posts row as `select('*')` returns it. */
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
  campaignRows = {};
  campaignReadError = null;
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

/* ────────────────────────────────────────────────────────────────────────
 * CAMPAIGN-LINKED
 * ──────────────────────────────────────────────────────────────────────── */

describe('campaign-linked publishing', () => {
  it('1. active campaign + released post → PUBLISHES', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    const res = await call({ campaign_id: 'camp-1', status: 'scheduled' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED' });
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it('2. DRAFT post → 409 PUBLISH_BLOCKED_POST_NOT_RELEASED, adapter never reached', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    const res = await call({ campaign_id: 'camp-1', status: 'draft' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_BLOCKED_POST_NOT_RELEASED' });
    expect(mockPublishNow).not.toHaveBeenCalled();
  });

  it('2b. a REVIEW-era post is equally impossible to publish here', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    for (const status of ['draft', 'pending', 'cancelled', 'review', '']) {
      mockPublishNow.mockClear();
      const res = await call({ campaign_id: 'camp-1', status });
      expect(res.statusCode).toBe(409);
      expect(mockPublishNow).not.toHaveBeenCalled();
    }
  });

  it('3. non-active campaign → 409 PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE', async () => {
    for (const status of ['paused', 'draft', 'planning', 'completed']) {
      campaignRows['camp-1'] = { status };
      mockPublishNow.mockClear();
      const res = await call({ campaign_id: 'camp-1', status: 'scheduled' });
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({ code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE' });
      expect(mockPublishNow).not.toHaveBeenCalled();
    }
  });

  it('12. an unreadable campaign FAILS CLOSED, exactly as the queue path does', async () => {
    campaignReadError = { message: 'connection reset' };
    const res = await call({ campaign_id: 'camp-1', status: 'scheduled' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE' });
    expect(mockPublishNow).not.toHaveBeenCalled();
  });

  it('12b. a MISSING campaign row also fails closed', async () => {
    campaignRows = {}; // lookup resolves to null
    const res = await call({ campaign_id: 'camp-ghost', status: 'scheduled' });
    expect(res.statusCode).toBe(409);
    expect(mockPublishNow).not.toHaveBeenCalled();
  });

  it('a denied request performs NO write — not even the social-account patch', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    await call({ campaign_id: 'camp-1', status: 'draft', social_account_id: null });
    expect(postUpdates).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * STANDALONE — must keep working
 * ──────────────────────────────────────────────────────────────────────── */

describe('standalone publishing is not forced through campaign semantics', () => {
  it('4. standalone + scheduled → PUBLISHES (PromotionWorkspace depends on this)', async () => {
    const res = await call({ campaign_id: null, status: 'scheduled' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED' });
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it('4b. no campaign lookup happens for a standalone post', async () => {
    // If the route consulted a campaign it would fail closed on the empty map.
    campaignRows = {};
    const res = await call({ campaign_id: null, status: 'scheduled' });
    expect(res.statusCode).toBe(200);
  });

  it('5. standalone + draft → 409 PUBLISH_BLOCKED_POST_NOT_RELEASED', async () => {
    const res = await call({ campaign_id: null, status: 'draft' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_BLOCKED_POST_NOT_RELEASED' });
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * RETRY · IDEMPOTENCY · ORDERING
 * ──────────────────────────────────────────────────────────────────────── */

describe('retry, idempotency and gate ordering', () => {
  it('6. a FAILED post remains manually retryable (campaign-linked and standalone)', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    const linked = await call({ campaign_id: 'camp-1', status: 'failed' });
    expect(linked.statusCode).toBe(200);

    mockPublishNow.mockClear();
    const alone = await call({ campaign_id: null, status: 'failed' });
    expect(alone.statusCode).toBe(200);
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it('6b. a post mid-flight (`publishing`) is still authorized', async () => {
    const res = await call({ campaign_id: null, status: 'publishing' });
    expect(res.statusCode).toBe(200);
  });

  it('7. an already-published post keeps its idempotent 200, not a 409', async () => {
    // Its status has legitimately moved past the release gate; the route must
    // defer to publishNow's platform_post_id short-circuit rather than re-judge.
    mockPublishNow.mockResolvedValue({
      status: 'PUBLISHED', external_post_id: 'ext-existing',
      post_url: 'https://x/existing', timestamp: 't',
    });
    const res = await call({
      campaign_id: 'camp-1', status: 'published', platform_post_id: 'ext-existing',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED', external_post_id: 'ext-existing' });
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it('7b. a published THREAD ROOT is still authorized (children may remain)', async () => {
    campaignRows['camp-1'] = { status: 'active' };
    const res = await call({
      campaign_id: 'camp-1', status: 'publishing',
      platform_post_id: 'root-1', is_thread_start: true,
    });
    expect(res.statusCode).toBe(200);
    expect(mockPublishNow).toHaveBeenCalledTimes(1);
  });

  it('8. a non-owner gets 403 BEFORE authorization, and learns nothing about release', async () => {
    campaignRows['camp-1'] = { status: 'paused' };
    mockIsSuperAdmin.mockResolvedValue(false);
    const res = await call({ campaign_id: 'camp-1', status: 'draft', user_id: 'someone-else' });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/campaign|release|PUBLISH_BLOCKED/i);
    expect(mockPublishNow).not.toHaveBeenCalled();
  });

  it('8b. a super-admin passes ownership but is STILL subject to authorization', async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    const res = await call({ campaign_id: null, status: 'draft', user_id: 'someone-else' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'PUBLISH_BLOCKED_POST_NOT_RELEASED' });
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * PRE-EXISTING GATES — unchanged
 * ──────────────────────────────────────────────────────────────────────── */

describe('the gates that already existed still behave exactly as before', () => {
  it('9. media accessibility failure still returns its own 400, before authorization', async () => {
    mockAssertMediaAccessible.mockResolvedValue({ code: 'MEDIA_UNREACHABLE', message: 'dead asset' });
    const res = await call({ media_urls: ['https://dead/1.jpg'], status: 'draft' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'MEDIA_UNREACHABLE' });
  });

  it('9b. publish-readiness failure still returns its own 400', async () => {
    mockValidateReadiness.mockReturnValue({
      ok: false, code: 'MEDIA_WOULD_BE_STRIPPED', message: 'would strip', warnings: [], context: {},
    });
    const res = await call({ status: 'scheduled' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'MEDIA_WOULD_BE_STRIPPED' });
  });

  it('10. capability failure still returns ACTION_NOT_SUPPORTED', async () => {
    mockResolveCapability.mockReturnValue({ status: 'unsupported', reason: 'no publish api' });
    const res = await call({ status: 'scheduled' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'ACTION_NOT_SUPPORTED' });
  });

  it('unauthenticated is still 401 and missing post still 404', async () => {
    const res1 = mockRes();
    await handler(post({ post_id: 'p' }, false), res1);
    expect(res1.statusCode).toBe(401);

    mockGetScheduledPost.mockResolvedValue(null);
    const res2 = mockRes();
    await handler(post({ post_id: 'nope' }), res2);
    expect(res2.statusCode).toBe(404);
  });

  it('dry_run on an authorized post still previews without publishing', async () => {
    const res = await call({ campaign_id: null, status: 'scheduled' }, { dry_run: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'DRY_RUN' });
    expect(mockPublishNow).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * SOURCE GATE
 * ──────────────────────────────────────────────────────────────────────── */

describe('11. SOURCE GATE — the predicate is reused, never reproduced', () => {
  const ROOT = join(__dirname, '../../..');
  const src = readFileSync(join(ROOT, 'pages/api/social/publish.ts'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

  it('imports and calls authorizePostPublish', () => {
    expect(code).toMatch(/import \{ authorizePostPublish \} from '[^']*publishAuthorization'/);
    expect(code).toContain('authorizePostPublish({');
  });

  it('does NOT reproduce the status vocabulary locally', () => {
    // The releasable set lives in publishAuthorization.ts and nowhere else.
    expect(code).not.toMatch(/RELEASABLE_POST_STATUSES\s*=/);
    expect(code).not.toMatch(/\[\s*'scheduled',\s*'publishing',\s*'failed'\s*\]/);
  });

  it('does not invent a new error code — it forwards the predicate verdict', () => {
    expect(code).toContain('code: authorization.code');
    expect(code).toContain('error: authorization.reason');
  });

  it('authorization sits AFTER the ownership check', () => {
    expect(code.indexOf('you do not own this post'))
      .toBeLessThan(code.indexOf('authorizePostPublish({'));
  });

  it('publishNowService itself was NOT modified by R6-B', () => {
    const svc = readFileSync(join(ROOT, 'backend/services/publishNowService.ts'), 'utf8');
    expect(svc).not.toContain('authorizePostPublish');
  });
});
