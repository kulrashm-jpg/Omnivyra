/**
 * Unread-error census: POST /api/social/publish. Two F sites before any publish:
 *   - resolving the connected account: a FAILED read answered 422 "No connected account";
 *   - saving the resolved account onto the post: a FAILED write went unread and the publish went
 *     ahead with the row not naming its account.
 * Both now answer 500 BEFORE publishNow is reached.
 */
const mockDb = { acctFails: false, patchFails: false, patched: [] as unknown[] };
const mockPublishNow = jest.fn(async () => ({ status: 'PUBLISHED' }));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'u1' }, error: null }) }));
jest.mock('../../services/rbacService', () => ({ isSuperAdmin: async () => false }));
jest.mock('../../db/queries', () => ({
  getScheduledPost: async () => ({ id: 'p1', user_id: 'u1', platform: 'linkedin', content: 'hello', media_urls: [], campaign_id: null, social_account_id: null, status: 'scheduled' }),
}));
jest.mock('../../db/scheduledPostsStore', () => ({ updatePostPublishStatus: async () => undefined }));
jest.mock('../../services/publishNowService', () => ({ publishNow: (...a: unknown[]) => (mockPublishNow as any)(...a) }));
jest.mock('../../../lib/campaign/publishAuthorization', () => ({ authorizePostPublish: () => ({ authorized: true }) }));
jest.mock('../../services/engagementCapabilityMap', () => ({ resolveEngagementCapability: () => ({ status: 'api_verified' }) }));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/publishReadinessValidator', () => ({
  validatePublishReadiness: () => ({ ok: true, warnings: [] }),
  assertMediaAccessible: async () => null,
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => (table === 'social_accounts' && mockDb.acctFails
        ? { data: null, error: { message: 'connection reset' } }
        : { data: { id: 'sa1' }, error: null });
      b.update = (p: unknown) => {
        mockDb.patched.push(p);
        const u: any = { eq: () => Promise.resolve(mockDb.patchFails ? { error: { message: 'write refused' } } : { error: null }) };
        return u;
      };
      return b;
    },
  },
}));

import handler from '../../../pages/api/social/publish';

async function call(body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (handler as any)({ method: 'POST', body, headers: {} }, res);
  return res;
}

beforeEach(() => {
  mockDb.acctFails = false; mockDb.patchFails = false; mockDb.patched.length = 0;
  mockPublishNow.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('the connected-account lookup FAILS: 500, not 422 "no connected account"; nothing published', async () => {
  mockDb.acctFails = true;
  const res = await call({ post_id: 'p1' });
  expect(res.statusCode).toBe(500);
  expect(mockPublishNow).not.toHaveBeenCalled();
});

it('saving the resolved account FAILS: 500 before any publish', async () => {
  mockDb.patchFails = true;
  const res = await call({ post_id: 'p1' });
  expect(res.statusCode).toBe(500);
  expect(mockPublishNow).not.toHaveBeenCalled();
});

it('NEGATIVE CONTROL (dry run): the account is resolved and saved, 200 DRY_RUN', async () => {
  const res = await call({ post_id: 'p1', dry_run: true });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ status: 'DRY_RUN', social_account_id: 'sa1' });
  expect(mockDb.patched).toEqual([{ social_account_id: 'sa1' }]);
});
