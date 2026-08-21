/**
 * Phase 2Z-AF — the tenant binding survives the cross-organization waiver.
 *
 * Waiving the ACTOR-membership precondition must not loosen anything about the
 * TARGET. These tests pin the two properties that keep the waiver safe once the
 * request is past authorization:
 *
 *   - the target company must exist (a waived actor cannot conjure a tenant);
 *   - the membership write is bounded to exactly (user_id, company_id), so
 *     provisioning one tenant can never disturb a membership in another.
 */

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(),
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(),
}));
jest.mock('../../services/invitationService', () => ({
  createAndSendInvitation: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: jest.fn(async () => true),
}));
jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: (h: unknown) => h,
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/domainRecordService', () => ({
  saveDomainRecord: jest.fn(async () => ({ ok: true })),
  reassignDomain: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/auditActorService', () => ({
  insertAuditLogStrict: jest.fn(async () => undefined),
  SYSTEM_USER_ID: 'system-user',
}));
jest.mock('../../services/domainVerificationService', () => ({
  logDomainUnverifiedUsageForCompany: jest.fn(async () => undefined),
}));

// ── A recording Supabase double ──────────────────────────────────────────────
// Records every table operation with its filters so the tests can assert on
// exactly which rows a write could have reached.

interface RecordedOp {
  table: string;
  kind: 'select' | 'update' | 'insert';
  filters: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

const ops: RecordedOp[] = [];
/** Result handed back to the next terminal read (`limit` / `maybeSingle`). */
let nextRead: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(),
    from: (table: string) => {
      const op: RecordedOp = { table, kind: 'select', filters: {} };
      const builder: Record<string, unknown> = {
        select: () => { op.kind = 'select'; ops.push(op); return builder; },
        update: (payload: Record<string, unknown>) => {
          op.kind = 'update'; op.payload = payload; ops.push(op); return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          op.kind = 'insert'; op.payload = payload; ops.push(op);
          return Promise.resolve({ error: null });
        },
        eq: (column: string, value: unknown) => { op.filters[column] = value; return builder; },
        limit: () => Promise.resolve(nextRead),
        maybeSingle: () => Promise.resolve(nextRead),
        // Update chains terminate on `.eq(...)`, which is awaited directly.
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return builder;
    },
  },
}));

import { handleUsersPost, handleUsersDelete } from '../../apiHandlers/superAdmin/usersMutations';
import { handleUsersPatch } from '../../apiHandlers/superAdmin/usersRead';
import { upsertUserCompanyRole } from '../../apiHandlers/superAdmin/usersShared';
import { requireCapability } from '../../security/requireCapability';

const TARGET_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const OTHER_ORG = '73e5fa6f-0000-4000-8000-000000000001';
const TARGET_USER = '7fe51fbc-31a8-418b-b69f-ad687109deca';

function mockRes() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
    setHeader() { return this; },
  };
  return { res, captured };
}

beforeEach(() => {
  ops.length = 0;
  nextRead = { data: null, error: null };
  // The actor is authorized — this suite is about what happens AFTER the
  // waiver, so authorization is stubbed as granted.
  (requireCapability as jest.Mock).mockResolvedValue({
    ok: true,
    principal: { userId: 'platform-admin-1' },
  });
});

describe('Test 4 — a waived actor still cannot target a nonexistent company', () => {
  it('CRITICAL: an unknown companyId is rejected COMPANY_NOT_FOUND', async () => {
    nextRead = { data: null, error: null }; // companies lookup finds nothing
    const { res, captured } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ error: 'COMPANY_NOT_FOUND' });
  });

  it('no membership row is written when the company does not exist', async () => {
    nextRead = { data: null, error: null };
    const { res } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );

    const writes = ops.filter((o) => o.table === 'user_company_roles' && o.kind !== 'select');
    expect(writes).toEqual([]);
  });

  it('the company existence check is bound to the supplied companyId', async () => {
    nextRead = { data: null, error: null };
    const { res } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );

    const lookup = ops.find((o) => o.table === 'companies');
    expect(lookup).toBeDefined();
    expect(lookup?.filters).toEqual({ id: TARGET_ORG });
  });

  it('authorization runs before any company or membership access', async () => {
    nextRead = { data: null, error: null };
    const { res } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );

    expect(requireCapability).toHaveBeenCalledTimes(1);
    const passed = (requireCapability as jest.Mock).mock.calls[0][2];
    // The target tenant is what gets bound into the authorization decision.
    expect(passed.organizationId).toBe(TARGET_ORG);
    expect(passed.capability).toBe('identity.admin.assign');
  });

  it('a denied authorization stops the handler before the company lookup', async () => {
    (requireCapability as jest.Mock).mockResolvedValue({ ok: false, sent: true });
    const { res } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );

    expect(ops).toEqual([]);
  });

  it('an invalid role is rejected rather than written', async () => {
    nextRead = { data: { id: TARGET_ORG }, error: null };
    const { res, captured } = mockRes();

    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'ROOT' } } as never,
      res as never,
    );

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ error: 'ROLE_NOT_ALLOWED' });
    expect(ops.filter((o) => o.table === 'user_company_roles')).toEqual([]);
  });
});

describe('Test 6 — membership isolation', () => {
  it('CRITICAL: a fresh attachment is bounded to (user_id, company_id)', async () => {
    nextRead = { data: [], error: null }; // no existing row for this pair
    const result = await upsertUserCompanyRole(TARGET_USER, TARGET_ORG, 'COMPANY_ADMIN');

    expect(result).toEqual({ ok: true });

    const read = ops.find((o) => o.table === 'user_company_roles' && o.kind === 'select');
    expect(read?.filters).toEqual({ user_id: TARGET_USER, company_id: TARGET_ORG });

    const insert = ops.find((o) => o.table === 'user_company_roles' && o.kind === 'insert');
    expect(insert?.payload).toMatchObject({
      user_id: TARGET_USER,
      company_id: TARGET_ORG,
      role: 'COMPANY_ADMIN',
    });
  });

  it('no statement touches any organization other than the target', async () => {
    nextRead = { data: [], error: null };
    await upsertUserCompanyRole(TARGET_USER, TARGET_ORG, 'COMPANY_ADMIN');

    const mentions = JSON.stringify(ops);
    expect(mentions).toContain(TARGET_ORG);
    expect(mentions).not.toContain(OTHER_ORG);
  });

  it('an existing row for the SAME pair is updated by its primary key only', async () => {
    nextRead = { data: [{ id: 'role-row-1', role: 'VIEW_ONLY', status: 'active' }], error: null };
    const result = await upsertUserCompanyRole(TARGET_USER, TARGET_ORG, 'COMPANY_ADMIN');

    expect(result).toEqual({ ok: true });
    const update = ops.find((o) => o.table === 'user_company_roles' && o.kind === 'update');
    // Bounded to one row id — it cannot fan out across a user's other tenants.
    expect(update?.filters).toEqual({ id: 'role-row-1' });
    expect(update?.payload).toMatchObject({ role: 'COMPANY_ADMIN' });
  });

  it('no delete is ever issued against user_company_roles', async () => {
    nextRead = { data: [{ id: 'role-row-1', role: 'VIEW_ONLY', status: 'active' }], error: null };
    await upsertUserCompanyRole(TARGET_USER, TARGET_ORG, 'COMPANY_ADMIN');
    expect(ops.every((o) => o.kind !== ('delete' as never))).toBe(true);
  });

  it('the attachment lands as `invited`, not `active`', async () => {
    // Documented, not incidental: the row only becomes active once the
    // invitation is accepted, so tenant-guarded routes still gate on acceptance.
    nextRead = { data: [], error: null };
    await upsertUserCompanyRole(TARGET_USER, TARGET_ORG, 'COMPANY_ADMIN');
    const insert = ops.find((o) => o.table === 'user_company_roles' && o.kind === 'insert');
    expect(insert?.payload).toMatchObject({ status: 'invited' });
  });
});

describe('2Z-AF fall-through — a denied mutation must not become 405', () => {
  // The route shell (pages/api/super-admin/users.ts) dispatches with
  // `if (await handleUsersX(req, res)) return;` and ends in a trailing
  // res.status(405). A guard denial writes its own response and then returned
  // FALSY, so the shell walked on and set 405 over the top of it. Each handler
  // must now report HANDLED.
  const denied = () => {
    (requireCapability as jest.Mock).mockImplementation(async (_req, res) => {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_ORG_MEMBER' });
      return { ok: false, sent: true };
    });
  };

  it('CRITICAL: a denied POST reports handled, so the shell cannot reach 405', async () => {
    denied();
    const { res, captured } = mockRes();
    const handled = await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );
    expect(handled).toBeTruthy();
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ code: 'NOT_ORG_MEMBER' });
  });

  it('CRITICAL: a denied PATCH reports handled', async () => {
    denied();
    const { res, captured } = mockRes();
    const handled = await handleUsersPatch(
      { method: 'PATCH', headers: {}, body: { userId: TARGET_USER, companyId: TARGET_ORG, status: 'active' } } as never,
      res as never,
    );
    expect(handled).toBeTruthy();
    expect(captured.status).toBe(403);
  });

  it('CRITICAL: a denied DELETE reports handled', async () => {
    denied();
    const { res, captured } = mockRes();
    const handled = await handleUsersDelete(
      { method: 'DELETE', headers: {}, body: { userId: TARGET_USER, companyId: TARGET_ORG } } as never,
      res as never,
    );
    expect(handled).toBeTruthy();
    expect(captured.status).toBe(403);
  });

  it('the denial is the REAL authorization response, not a fabricated success', async () => {
    denied();
    const { res, captured } = mockRes();
    await handleUsersPost(
      { method: 'POST', headers: {}, body: { email: 'op@example.test', companyId: TARGET_ORG, role: 'COMPANY_ADMIN' } } as never,
      res as never,
    );
    expect(captured.status).not.toBe(200);
    expect(captured.status).not.toBe(201);
    expect(captured.status).not.toBe(405);
    expect(ops.filter((o) => o.table === 'user_company_roles')).toEqual([]);
  });

  it('a handler still declines a method it does not own (the shell may 405 legitimately)', async () => {
    const { res } = mockRes();
    // An OPTIONS request owns no handler — every one must return falsy so the
    // shell's 405 remains reachable for genuinely unsupported methods.
    expect(await handleUsersPost({ method: 'OPTIONS', headers: {}, body: {} } as never, res as never)).toBeFalsy();
    expect(await handleUsersPatch({ method: 'OPTIONS', headers: {}, body: {} } as never, res as never)).toBeFalsy();
    expect(await handleUsersDelete({ method: 'OPTIONS', headers: {}, body: {} } as never, res as never)).toBeFalsy();
  });
});
