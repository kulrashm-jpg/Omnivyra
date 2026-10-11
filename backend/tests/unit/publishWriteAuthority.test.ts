/**
 * Closure-005 — publish-recovery WRITES need platform authority, not the
 * dashboard-view capability.
 *
 * The three super-admin write routes are still gated by
 * requireCapability(SUPER_ADMIN_DASHBOARD_VIEW) (CPG-065 pins that), and now
 * additionally by requirePlatformWriteAuthority: an active platform
 * SUPER_ADMIN role on a canonical, non-bridge principal. A principal that
 * merely HOLDS the view capability — a direct `capability_assignments` grant,
 * or a legacy bridge principal — passes the capability gate and must still be
 * refused, with nothing called, written or audited.
 */
export {};

const mockRequireCapability = jest.fn();
const mockAudit = jest.fn(async () => undefined);
const mockResume = jest.fn();
const mockReconcileRow = jest.fn();

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: (...a: unknown[]) => mockRequireCapability(...a) }));
jest.mock('../../services/auditActorService', () => ({
  insertAuditLogStrict: (...a: unknown[]) => (mockAudit as (...x: unknown[]) => Promise<undefined>)(...a),
  SYSTEM_USER_ID: 'system',
}));
jest.mock('../../services/threadRuntime/threadPublishOrchestrator', () => ({
  resumeThreadPublish: (...a: unknown[]) => mockResume(...a),
}));
jest.mock('../../services/providerReconciliation/reconcileRow', () => ({
  reconcileRow: (...a: unknown[]) => mockReconcileRow(...a),
}));
const mockGetScheduledPost = jest.fn();
const mockSupabaseFrom = jest.fn();
jest.mock('../../db/queries', () => ({
  getScheduledPost: (...a: unknown[]) => mockGetScheduledPost(...a),
  updateScheduledPostOnPublish: jest.fn(async () => ({ applied: true })),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (...a: unknown[]) => mockSupabaseFrom(...a) } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));

import reconcilePublishHandler from '../../../pages/api/super-admin/publish/reconcile';
import resumeHandler from '../../../pages/api/super-admin/threads/[threadId]/resume';
import threadReconcileHandler from '../../../pages/api/super-admin/threads/[threadId]/reconcile';
import { reconcileUncertainPublish } from '../../services/publishOutcomeReconciliation';
import { hasPlatformWriteAuthority } from '../../security/platformWriteAuthority';

type Principal = { userId: string; legacyCookieSuperAdmin: boolean; organizations: Array<{ organizationId: string; role: string; status: 'active' | 'invited' | 'inactive' | 'deactivated' }> };

const PLATFORM_ADMIN: Principal = {
  userId: 'admin-1', legacyCookieSuperAdmin: false,
  organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }],
};
/** Holds super_admin.dashboard.view through a direct capability grant; a tenant admin, not a platform admin. */
const VIEW_GRANT: Principal = {
  userId: 'support-1', legacyCookieSuperAdmin: false,
  organizations: [{ organizationId: 'org-a', role: 'COMPANY_ADMIN', status: 'active' }],
};
/** A legacy bridge principal (sentinel user, no organizations). */
const BRIDGE: Principal = { userId: 'legacy-bridge', legacyCookieSuperAdmin: true, organizations: [] };
/** Even a bridge principal presenting a SUPER_ADMIN membership is not a canonical principal. */
const BRIDGE_WITH_ROLE: Principal = { ...PLATFORM_ADMIN, userId: 'legacy-bridge', legacyCookieSuperAdmin: true };
const LAPSED_ADMIN: Principal = {
  userId: 'ex-admin', legacyCookieSuperAdmin: false,
  organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'deactivated' }],
};

function mockRes() {
  const res: { statusCode: number; body: Record<string, unknown> | null; status: (c: number) => typeof res; json: (b: Record<string, unknown>) => typeof res; setHeader: () => typeof res } = {
    statusCode: 0, body: null,
    status: (c: number) => { res.statusCode = c; return res; },
    json: (b: Record<string, unknown>) => { res.body = b; return res; },
    setHeader: () => res,
  };
  return res;
}
type Handler = (rq: Record<string, unknown>, rs: ReturnType<typeof mockRes>) => Promise<void>;
async function call(handler: unknown, req: Record<string, unknown>) {
  const res = mockRes();
  await (handler as Handler)({ method: 'POST', headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}
const routes: Array<[string, unknown, Record<string, unknown>]> = [
  ['POST /api/super-admin/publish/reconcile', reconcilePublishHandler,
    { body: { scheduled_post_id: 'sp-1', resolution: 'not_published', note: 'checked' } }],
  ['POST /api/super-admin/threads/[threadId]/resume', resumeHandler, { query: { threadId: 'root-1' } }],
  ['POST /api/super-admin/threads/[threadId]/reconcile', threadReconcileHandler, { query: { threadId: 'row-1' } }],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockResume.mockResolvedValue({ status: 'PUBLISHED', root_id: 'root-1', total_nodes: 2, published_count: 2, failed_count: 0, blocked_count: 0, timestamp: 't' });
  mockReconcileRow.mockResolvedValue({ ran: true, analysis: { platform: 'twitter', kind: 'present', lookup: { confidence: 'high' } } });
  mockGetScheduledPost.mockResolvedValue({ id: 'sp-1', status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: null });
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    update: () => chain, eq: () => chain, is: () => chain,
    select: async () => ({ data: [{ id: 'sp-1' }], error: null }),
  });
  mockSupabaseFrom.mockReturnValue(chain);
});

describe.each(routes)('%s', (_name, handler, req) => {
  it.each([
    ['a direct view-capability grant (not a platform SUPER_ADMIN)', VIEW_GRANT],
    ['a legacy bridge principal', BRIDGE],
    ['a bridge principal presenting a SUPER_ADMIN membership', BRIDGE_WITH_ROLE],
    ['a deactivated SUPER_ADMIN membership', LAPSED_ADMIN],
  ])('%s passes the view gate but is refused 403: no service call, no write, no audit', async (_who, principal) => {
    mockRequireCapability.mockResolvedValue({ ok: true, principal });
    const res = await call(handler, req);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockReconcileRow).not.toHaveBeenCalled();
    expect(mockGetScheduledPost).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('no principal at all: the capability gate answers (401) and nothing runs', async () => {
    mockRequireCapability.mockImplementation(async (_rq: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ code: 'NOT_AUTHENTICATED' });
      return { ok: false, sent: true };
    });
    const res = await call(handler, req);
    expect(res.statusCode).toBe(401);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockReconcileRow).not.toHaveBeenCalled();
  });

  it('a platform SUPER_ADMIN may perform it, and it is audited under that actor', async () => {
    mockRequireCapability.mockResolvedValue({ ok: true, principal: PLATFORM_ADMIN });
    const res = await call(handler, req);
    expect(res.statusCode).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1' }));
  });
});

describe('the reconciliation service is its own boundary', () => {
  it.each([['view grant', VIEW_GRANT], ['bridge', BRIDGE], ['bridge with role', BRIDGE_WITH_ROLE], ['lapsed admin', LAPSED_ADMIN]])(
    'called directly by a %s: forbidden before any read or write',
    async (_who, actor) => {
      const r = await reconcileUncertainPublish({ scheduledPostId: 'sp-1', resolution: 'not_published', actor, note: 'x' });
      expect(r).toEqual({ status: 'forbidden' });
      expect(mockGetScheduledPost).not.toHaveBeenCalled();
      expect(mockSupabaseFrom).not.toHaveBeenCalled();
    },
  );

  it('called directly by a platform SUPER_ADMIN: proceeds', async () => {
    const r = await reconcileUncertainPublish({ scheduledPostId: 'sp-1', resolution: 'not_published', actor: PLATFORM_ADMIN, note: 'x' });
    expect(r).toMatchObject({ status: 'reconciled' });
  });

  it('hasPlatformWriteAuthority', () => {
    expect(hasPlatformWriteAuthority(PLATFORM_ADMIN)).toBe(true);
    for (const p of [VIEW_GRANT, BRIDGE, BRIDGE_WITH_ROLE, LAPSED_ADMIN, null, undefined]) expect(hasPlatformWriteAuthority(p)).toBe(false);
  });
});
