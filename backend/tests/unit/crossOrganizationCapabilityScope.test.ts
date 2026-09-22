/**
 * CPG-060 — cross-organisation capability scope (security regression).
 *
 * THE DEFECT: `principal.capabilities` is the union of every organisation's
 * capabilities. An org-scoped check accepted it, so an ADMIN of company A who
 * was only a VIEWER/EDITOR in company B passed admin-only checks for B.
 *
 * These tests drive the REAL authorization path end to end:
 *   resolvePrincipal (IdentityResolver) → resolveUserCapabilities
 *   (CapabilityService) → requireCapability → decideCapability,
 * and two real route handlers. Only I/O is replaced: the database rows, the
 * identity lookup, the session lookup, the legacy bridge and the audit sink.
 * `requireCapability` is NOT mocked.
 */

// ── Database fake: a query builder over in-memory rows ───────────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string }[] = [];
function mockBuilder(table: string) {
  let rows = [...(mockTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    update: () => { mockWrites.push({ table, op: 'update' }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    insert: () => { mockWrites.push({ table, op: 'insert' }); return b; },
    upsert: () => { mockWrites.push({ table, op: 'upsert' }); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockBuilder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));

// ── Identity: the authenticated user is chosen by a test header ──────────────
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers: Record<string, string> }) => {
    const id = req.headers['x-test-user'];
    return id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async () => ({ ok: false, reason: 'NO_SESSION' }),
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  resolveLegacyCookieSuperAdminPrincipal: async () => null,
}));
const mockAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));

// Route plumbing and the ICP write service only (the authorization chain is real).
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockRatifyIcpVersion = jest.fn(async () => ({ versionId: 'v1', version: 1, supersededVersion: null }));
jest.mock('../../services/prospectIcp', () => ({
  IcpContractError: class IcpContractError extends Error { code = 'x'; },
  resolveIcpByKey: async () => 'icp-1',
  ratifyIcpVersion: (...a: unknown[]) => (mockRatifyIcpVersion as (...x: unknown[]) => unknown)(...a),
}));
jest.mock('../../services/userContextService', () => ({
  // Membership gate stays in the chain; the CAPABILITY decision is what is under test.
  enforceCompanyAccess: async ({ req }: { req: { headers: Record<string, string> } }) => ({ userId: req.headers['x-test-user'] }),
}));

import { resolvePrincipal } from '../../security/IdentityResolver';
import { requireCapability } from '../../security/requireCapability';
import { decideCapability, hasCapability, holdsCapabilityInOrganization } from '../../security/AuthorizationService';
import { capabilitiesForRole } from '../../security/capabilityRegistry';
import {
  IDENTITY_ADMIN_ASSIGN, ORGANIZATION_MANAGE, PROSPECT_ICP_MANAGE, PROSPECT_INGEST, SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';
import type { AuthenticatedPrincipal, Capability } from '../../../shared/contracts/security';
import ratifyRoute from '../../../pages/api/prospect-icp/ratify';
import selfJoinedRoute from '../../../pages/api/team/self-joined';

// ── Fixtures ────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN row

const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ user_id, company_id, role: r, status });
const assign = (user_id: string, capability: string, organization_id: string | null) =>
  ({ user_id, capability, organization_id, expires_at: null, revoked_at: null });

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockAudit.length = 0;
  mockRatifyIcpVersion.mockClear();
  mockTables.user_company_roles = [
    role('u-mixed-editor', A, 'COMPANY_ADMIN'), role('u-mixed-editor', B, 'CONTENT_CREATOR'),
    role('u-mixed-viewer', A, 'COMPANY_ADMIN'), role('u-mixed-viewer', B, 'VIEW_ONLY'),
    role('u-low', B, 'VIEW_ONLY'),
    role('u-admin-a', A, 'COMPANY_ADMIN'),
    role('u-admin-b', B, 'COMPANY_ADMIN'),
    role('u-inactive-admin-b', B, 'COMPANY_ADMIN', 'inactive'), role('u-inactive-admin-b', B, 'VIEW_ONLY'),
    role('u-inactive-only-b', B, 'COMPANY_ADMIN', 'inactive'),
    role('u-mixed-inactive', A, 'COMPANY_ADMIN'), role('u-mixed-inactive', B, 'COMPANY_ADMIN', 'inactive'), role('u-mixed-inactive', B, 'VIEW_ONLY'),
    role('u-super', P, 'SUPER_ADMIN'), role('u-super', B, 'VIEW_ONLY'),
    role('u-assign-b', A, 'VIEW_ONLY'), role('u-assign-b', B, 'VIEW_ONLY'),
    role('u-assign-global', B, 'VIEW_ONLY'),
  ];
  mockTables.capability_assignments = [
    assign('u-assign-b', PROSPECT_ICP_MANAGE, B),
    assign('u-assign-global', PROSPECT_ICP_MANAGE, null),
  ];
  mockTables.users = [];
});

type Req = { headers: Record<string, string>; query: Record<string, unknown>; body: unknown; method?: string; url?: string; socket?: unknown };
const req = (user: string, extra: Partial<Req> = {}): Req =>
  ({ headers: { 'x-test-user': user, ...(extra.headers ?? {}) }, query: extra.query ?? {}, body: extra.body ?? {}, method: extra.method ?? 'POST', url: '/api/test', socket: {} });

function fakeRes() {
  const r: { statusCode: number; body: unknown; headers: Record<string, unknown> } & Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
}

async function principalOf(user: string, extra: Partial<Req> = {}): Promise<AuthenticatedPrincipal> {
  const r = await resolvePrincipal(req(user, extra) as never);
  if (r.ok !== true) throw new Error(`principal for ${user} did not resolve`);
  return r.principal;
}
async function gate(user: string, capability: Capability, organizationId: string, extra: Partial<Req> = {}) {
  const res = fakeRes();
  const out = await requireCapability(req(user, extra) as never, res as never, { capability, organizationId, reason: 'cpg-060 test' });
  return { ok: out.ok === true, status: res.statusCode, body: res.body as Record<string, unknown> | undefined };
}
const decide = async (user: string, capability: Capability, organizationId?: string) =>
  decideCapability(await principalOf(user), { capability, organizationId, reason: 'cpg-060 test' });

const TENANT_ADMIN_ONLY: Capability[] = [PROSPECT_ICP_MANAGE, PROSPECT_INGEST, ORGANIZATION_MANAGE];

// ── Preconditions: the fixture really reproduces the defect's shape ──────────
describe('CPG-060 precondition — the union holds the capability, the target role does not', () => {
  it('a mixed-role principal is an active member of B and its UNION holds admin-only capabilities', async () => {
    const p = await principalOf('u-mixed-viewer');
    for (const cap of TENANT_ADMIN_ONLY) expect(p.capabilities).toContain(cap);   // from A
    expect(p.organizations.some((m) => m.organizationId === B && m.status === 'active')).toBe(true);
    for (const cap of TENANT_ADMIN_ONLY) expect(capabilitiesForRole('VIEW_ONLY')).not.toContain(cap);
    expect(p.capabilityScope!.byOrganization[A]).toEqual(expect.arrayContaining(TENANT_ADMIN_ONLY));
    for (const cap of TENANT_ADMIN_ONLY) expect(p.capabilityScope!.byOrganization[B]).not.toContain(cap);
  });
});

describe('CPG-060 (1) mixed-role denial — admin in A, lower role in B, acting on B', () => {
  it.each(['u-mixed-editor', 'u-mixed-viewer'])('%s is refused on the real requireCapability path', async (user) => {
    const g = await gate(user, PROSPECT_ICP_MANAGE, B);
    expect(g.ok).toBe(false);
    expect(g.status).toBe(403);
  });

  it.each(TENANT_ADMIN_ONLY)('decideCapability refuses %s in B with CAPABILITY_NOT_HELD', async (cap) => {
    const d = await decide('u-mixed-viewer', cap, B);
    expect(d).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });

  it('the denial is audited as "not held in the target organisation"', async () => {
    await decide('u-mixed-viewer', PROSPECT_ICP_MANAGE, B);
    expect(mockAudit.some((e) => e.decision === 'denied' && String(e.reason).includes('not held in the target organisation') && e.organizationId === B)).toBe(true);
  });
});

describe('CPG-060 (2) the same user in the company where they ARE admin is allowed', () => {
  it.each(TENANT_ADMIN_ONLY)('%s in A is allowed', async (cap) => {
    expect(await decide('u-mixed-viewer', cap, A)).toMatchObject({ allowed: true });
  });
  it('requireCapability allows A', async () => {
    expect((await gate('u-mixed-editor', PROSPECT_ICP_MANAGE, A)).ok).toBe(true);
  });
  it("a genuine COMPANY_ADMIN of B is allowed in B — legitimate access unchanged", async () => {
    expect((await gate('u-admin-b', PROSPECT_ICP_MANAGE, B)).ok).toBe(true);
  });
});

describe('CPG-060 (3) a lower role alone is refused', () => {
  it('a VIEW_ONLY member of B cannot use an admin-only capability in B', async () => {
    const g = await gate('u-low', PROSPECT_ICP_MANAGE, B);
    expect(g.ok).toBe(false);
    expect(g.status).toBe(403);
  });
});

describe('CPG-060 (4) a non-member is refused (existing behaviour, unchanged)', () => {
  it('admin of A with no membership in B gets NOT_ORG_MEMBER', async () => {
    expect(await decide('u-admin-a', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
    expect((await gate('u-admin-a', PROSPECT_ICP_MANAGE, C)).ok).toBe(false);
  });
});

describe('CPG-060 (5) request-supplied authorization state is ignored', () => {
  const forged: Partial<Req> = {
    headers: { 'x-role': 'COMPANY_ADMIN', 'x-capabilities': PROSPECT_ICP_MANAGE, 'x-organization-id': A },
    query: { role: 'COMPANY_ADMIN', capability: PROSPECT_ICP_MANAGE, company_id: A, organizationId: A },
    body: { role: 'COMPANY_ADMIN', capabilities: [PROSPECT_ICP_MANAGE], organizationId: A, organization_role: 'COMPANY_ADMIN' },
  };
  it('forged role / capability / company in the request cannot unlock B', async () => {
    const g = await gate('u-mixed-viewer', PROSPECT_ICP_MANAGE, B, forged);
    expect(g.ok).toBe(false);
    expect(g.status).toBe(403);
  });
  it('the principal is built only from server rows', async () => {
    const p = await principalOf('u-mixed-viewer', forged);
    expect(p.organizations.find((m) => m.organizationId === B)!.role).toBe('VIEW_ONLY');
    expect(p.capabilityScope!.byOrganization[B]).not.toContain(PROSPECT_ICP_MANAGE);
  });
});

describe('CPG-060 (6) SUPER_ADMIN and platform-tier authorization are unchanged', () => {
  it('a platform SUPER_ADMIN keeps tenant-tier authority where it is a member', async () => {
    expect((await gate('u-super', PROSPECT_ICP_MANAGE, B)).ok).toBe(true);
    expect(await decide('u-super', ORGANIZATION_MANAGE, B)).toMatchObject({ allowed: true });
  });
  it('platform-tier capabilities without an organisation behave as before', async () => {
    expect(await decide('u-super', SUPER_ADMIN_DASHBOARD_VIEW)).toMatchObject({ allowed: true });
    expect(await decide('u-admin-b', SUPER_ADMIN_DASHBOARD_VIEW)).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });
  it('the cross-organisation identity-administration waiver still applies to a SUPER_ADMIN non-member', async () => {
    expect(await decide('u-super', IDENTITY_ADMIN_ASSIGN, C)).toMatchObject({ allowed: true });
  });
  it('the waiver is still refused to a tenant admin', async () => {
    expect((await decide('u-admin-a', IDENTITY_ADMIN_ASSIGN, C)).allowed).toBe(false);
  });
});

describe('CPG-060 (7) inactive membership grants nothing', () => {
  it('an INACTIVE admin row in B beside an active viewer row in B does not grant admin capability in B', async () => {
    expect(await decide('u-inactive-admin-b', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });
  it('an ONLY-inactive membership grants nothing: the inactive row contributes no capability at all', async () => {
    const p = await principalOf('u-inactive-only-b');
    expect(p.organizations.some((m) => m.organizationId === B && m.status === 'active')).toBe(false);
    expect(p.capabilities).not.toContain(PROSPECT_ICP_MANAGE);
    // The pre-existing check order tests "held at all" before membership, so this is CAPABILITY_NOT_HELD.
    expect(await decide('u-inactive-only-b', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });
});

describe('CPG-060 (8) per-organisation capability isolation', () => {
  it("a capability held in A never satisfies B, and B's never satisfies A", async () => {
    const p = await principalOf('u-mixed-viewer');
    expect(holdsCapabilityInOrganization(p, PROSPECT_ICP_MANAGE, A)).toBe(true);
    expect(holdsCapabilityInOrganization(p, PROSPECT_ICP_MANAGE, B)).toBe(false);
  });
  it('an assignment scoped to B works in B only', async () => {
    expect(await decide('u-assign-b', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: true });
    expect(await decide('u-assign-b', PROSPECT_ICP_MANAGE, A)).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });
  it('an assignment made with NO organisation is preserved as a deliberate global grant', async () => {
    expect(await decide('u-assign-global', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: true });
  });
  it('the scope-less fallback honours only ACTIVE roles in the target org', async () => {
    // The union holds the capability (admin in A), and B has an INACTIVE admin row beside an active viewer row.
    const { capabilityScope: _omit, ...unscoped } = await principalOf('u-mixed-inactive');
    void _omit;
    expect(unscoped.capabilities).toContain(PROSPECT_ICP_MANAGE);
    expect(unscoped.organizations.some((m) => m.organizationId === B && m.role === 'COMPANY_ADMIN' && m.status !== 'active')).toBe(true);
    expect(holdsCapabilityInOrganization(unscoped as AuthenticatedPrincipal, PROSPECT_ICP_MANAGE, B)).toBe(false);
    // …and the same holds on the normal scoped path.
    expect(await decide('u-mixed-inactive', PROSPECT_ICP_MANAGE, B)).toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
  });
  it('a principal without a capability scope falls back to the role held in the target org', async () => {
    const { capabilityScope: _omit, ...unscoped } = await principalOf('u-mixed-viewer');
    void _omit;
    expect(holdsCapabilityInOrganization(unscoped as AuthenticatedPrincipal, PROSPECT_ICP_MANAGE, B)).toBe(false);
    expect(holdsCapabilityInOrganization(unscoped as AuthenticatedPrincipal, PROSPECT_ICP_MANAGE, A)).toBe(true);
  });
  it('hasCapability: org-scoped calls are scoped; calls without an org keep their union semantics', async () => {
    const p = await principalOf('u-mixed-viewer');
    expect(hasCapability(p, PROSPECT_ICP_MANAGE, { organizationId: B })).toBe(false);
    expect(hasCapability(p, PROSPECT_ICP_MANAGE, { organizationId: A })).toBe(true);
    expect(hasCapability(p, PROSPECT_ICP_MANAGE)).toBe(true);
  });
});

describe('CPG-060 affected routes — real handlers, real authorization', () => {
  const call = async (route: (q: never, s: never) => unknown, r: Req) => { const res = fakeRes(); await route(r as never, res as never); return res; };

  it('POST /api/prospect-icp/ratify: mixed-role user is refused for B and nothing is written', async () => {
    const res = await call(ratifyRoute as never, req('u-mixed-viewer', { query: { company_id: B }, body: { icpKey: 'default', version: 1 } }));
    expect(res.statusCode).toBe(403);
    expect(mockRatifyIcpVersion).not.toHaveBeenCalled();
  });
  it('POST /api/prospect-icp/ratify: the same user ratifies in A', async () => {
    const res = await call(ratifyRoute as never, req('u-mixed-viewer', { query: { company_id: A }, body: { icpKey: 'default', version: 1 } }));
    expect(res.statusCode).toBe(200);
    expect(mockRatifyIcpVersion).toHaveBeenCalledWith(expect.objectContaining({ organizationId: A }));
  });
  it.each(['GET', 'DELETE', 'PATCH'])('%s /api/team/self-joined: mixed-role user is refused for B, no member data read or changed', async (method) => {
    const res = await call(selfJoinedRoute as never, req('u-mixed-viewer', { method, query: { companyId: B, userId: 'u-low' } }));
    expect(res.statusCode).toBe(403);
    expect(mockWrites).toEqual([]);
    expect(JSON.stringify(res.body ?? {})).not.toContain('redacted@example.test');
  });
});
