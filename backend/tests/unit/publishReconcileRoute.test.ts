/**
 * Closure-002 — POST /api/super-admin/publish/reconcile.
 *
 * The explicit, auditable human path out of an uncertain publish outcome:
 * capability-gated like the thread resume route, nothing reaches the service
 * before the gate, every outcome maps to a distinct status, and only a
 * reconciliation that was applied writes the audit row.
 */
export {};

const mockReconcile = jest.fn();
const mockRequireCapability = jest.fn();
const mockAudit = jest.fn(async () => undefined);

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: (...a: unknown[]) => mockRequireCapability(...a) }));
jest.mock('../../services/auditActorService', () => ({
  insertAuditLogStrict: (...a: unknown[]) => (mockAudit as (...x: unknown[]) => Promise<undefined>)(...a),
  SYSTEM_USER_ID: 'system',
}));
jest.mock('../../services/publishOutcomeReconciliation', () => ({
  reconcileUncertainPublish: (...a: unknown[]) => mockReconcile(...a),
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));

import handler from '../../../pages/api/super-admin/publish/reconcile';

function mockRes() {
  const res: { statusCode: number; body: Record<string, unknown> | null; status: (c: number) => typeof res; json: (b: Record<string, unknown>) => typeof res; setHeader: () => void } = {
    statusCode: 0, body: null,
    status: (c: number) => { res.statusCode = c; return res; },
    json: (b: Record<string, unknown>) => { res.body = b; return res; },
    setHeader: () => undefined,
  };
  return res;
}
async function call(body: Record<string, unknown>, method = 'POST') {
  const res = mockRes();
  await (handler as unknown as (rq: Record<string, unknown>, rs: typeof res) => Promise<void>)({ method, body, headers: {} }, res);
  return res;
}
const BODY = { scheduled_post_id: 'sp-1', resolution: 'not_published', note: 'checked the platform' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'admin-1' } });
  mockReconcile.mockResolvedValue({ status: 'reconciled', resolution: 'not_published', previous_error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
});

describe('POST /api/super-admin/publish/reconcile', () => {
  it('a caller without the capability reaches neither the service nor the audit log', async () => {
    mockRequireCapability.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ error: 'FORBIDDEN' });
      return { ok: false };
    });
    const res = await call(BODY);
    expect(res.statusCode).toBe(403);
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('applies the reconciliation with the authenticated actor and writes an audit row', async () => {
    const res = await call(BODY);
    expect(res.statusCode).toBe(200);
    expect(mockReconcile).toHaveBeenCalledWith(expect.objectContaining({
      scheduledPostId: 'sp-1', resolution: 'not_published', actorUserId: 'admin-1', note: 'checked the platform',
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      action: 'SUPER_ADMIN_PUBLISH_RECONCILE',
      metadata: expect.objectContaining({ scheduled_post_id: 'sp-1', resolution: 'not_published', previous_error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }),
    }));
  });

  it.each([
    [{ status: 'invalid', reason: 'note is required' }, 400],
    [{ status: 'not_found' }, 404],
    [{ status: 'not_uncertain', current_status: 'published', current_error_code: null }, 409],
    [{ status: 'changed' }, 409],
  ])('service outcome %o → %i, no audit row', async (outcome, code) => {
    mockReconcile.mockResolvedValue(outcome);
    const res = await call(BODY);
    expect(res.statusCode).toBe(code);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('rejects a missing post id before the capability check, and non-POST methods', async () => {
    expect((await call({ resolution: 'published' })).statusCode).toBe(400);
    expect((await call(BODY, 'GET')).statusCode).toBe(405);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
