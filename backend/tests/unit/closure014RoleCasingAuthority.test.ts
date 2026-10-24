/**
 * Closure-014 (A) — SUPER_ADMIN role casing: the capability layer and the
 * platform-authority layer agree, fail-closed.
 *
 * Before: capabilitiesForRole upper-cased roles, so an active `super_admin`
 * membership received every SUPER_ADMIN capability, while every authority
 * predicate (isPlatformSuperAdminPrincipal, rbacService, startup check)
 * compared exactly. Now only the exact canonical `SUPER_ADMIN` spelling, with
 * status 'active', yields SUPER_ADMIN capabilities and platform authority.
 *
 * Drives the REAL chain: requireCapability → resolvePrincipal →
 * resolveUserCapabilities (user_company_roles + capability_assignments) →
 * decision. Only I/O is replaced. In-memory: not Postgres RLS.
 */
const mockTables: Record<string, Record<string, unknown>[]> = {};
function mockBuilder(table: string) {
  let rows = [...(mockTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain, not: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockBuilder(t) } }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers: Record<string, string> }) => {
    const id = req.headers['x-test-user'];
    return id ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null } : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers: Record<string, string> }) => {
    const user = req.headers['x-test-user'];
    if (!user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  resolveLegacyCookieSuperAdminPrincipal: async (req: { headers: Record<string, string> }) => {
    if (!req.headers['x-test-bridge']) return null;
    const sec = jest.requireActual('../../../shared/contracts/security');
    return {
      userId: 'legacy:cookie-super-admin', supabaseUid: 'legacy:cookie-super-admin', email: '', emailVerified: false,
      sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
      organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }], activeOrgId: null,
      capabilities: [...sec.ALL_CAPABILITIES],
      mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: null, phishingResistant: true },
      device: { deviceId: null, trusted: true, fingerprint: 'bridge' },
      stepUp: { active: true, expiresAt: new Date(Date.now() + 300_000), factor: 'webauthn', sessionId: 'su-bridge' },
      legacyCookieSuperAdmin: true,
    };
  },
}));
const mockAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));

import { requireCapability } from '../../security/requireCapability';
import { capabilitiesForRole } from '../../security/capabilityRegistry';
import { isPlatformSuperAdminPrincipal, PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { hasPlatformWriteAuthority } from '../../security/platformWriteAuthority';
import {
  BILLING_GRANT_FREE_CREDITS, CONSUMPTION_VIEW_AGGREGATE, SUPER_ADMIN_DASHBOARD_VIEW, type Capability,
} from '../../../shared/contracts/security';

const P = '44444444-4444-4444-8444-444444444444';
const A = '11111111-1111-4111-8111-111111111111';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fp(): string { let h = 5381; for (const ch of '||') h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return `dj2-${h.toString(36)}`; }

type Who = { user?: string; bridge?: boolean } | null;
/** Seed one principal: memberships, direct grants, step-up factor (or none) and a trusted device. */
function seed(user: string, roles: Array<[string, string]>, grants: string[] = [], factor: 'webauthn' | 'totp' | null = 'webauthn') {
  for (const [role, status] of roles) mockTables.user_company_roles.push({ user_id: user, company_id: role === 'SUPER_ADMIN' || /super/i.test(role) ? P : A, role, status });
  for (const capability of grants) mockTables.capability_assignments.push({ user_id: user, capability, organization_id: null, expires_at: null, revoked_at: null });
  if (factor) mockTables.stepup_sessions.push({ id: `su-${user}`, user_id: user, auth_session_id: `sess-${user}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });
  mockTables.trusted_devices.push({ id: `dev-${user}`, user_id: user, fingerprint: fp(), expires_at: FUTURE(), revoked_at: null });
}
function fakeRes() {
  const r = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, unknown> } as Record<string, unknown> & { statusCode: number; body: unknown };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { (r.headers as Record<string, unknown>)[k] = v; return r; };
  return r;
}
async function gate(who: Who, capability: Capability, method = 'POST') {
  const headers: Record<string, string> = {};
  if (who?.user) headers['x-test-user'] = who.user;
  if (who?.bridge) headers['x-test-bridge'] = '1';
  const res = fakeRes();
  const out = await requireCapability({ headers, method, url: '/api/x', socket: {}, cookies: {}, query: {}, body: {} } as never, res as never, { capability, reason: 'closure-014 casing test' });
  return { ok: out.ok, status: res.statusCode, code: (res.body as { code?: string } | undefined)?.code };
}

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const t of ['user_company_roles', 'capability_assignments', 'stepup_sessions', 'trusted_devices', 'users']) mockTables[t] = [];
  mockAudit.length = 0;
});

describe('capabilitiesForRole — SUPER_ADMIN only under its exact canonical spelling', () => {
  it('SUPER_ADMIN yields every platform-tier capability', () => {
    for (const c of PLATFORM_TIER_CAPABILITIES) expect(capabilitiesForRole('SUPER_ADMIN')).toContain(c);
  });
  it.each(['super_admin', 'Super_Admin', 'SUPER_admin', 'sUPER_ADMIN', ' SUPER_ADMIN', 'SUPER_ADMIN ', 'SUPER ADMIN', 'SUPERADMIN'])(
    '%j yields NO capabilities (fail-closed; agrees with the exact authority predicate)', (r) => {
      expect(capabilitiesForRole(r)).toEqual([]);
    });
  it('tenant roles keep their historical case-insensitive mapping (no tenant regression)', () => {
    expect(capabilitiesForRole('company_admin')).toEqual(capabilitiesForRole('COMPANY_ADMIN'));
    expect(capabilitiesForRole('view_only')).toEqual(capabilitiesForRole('VIEW_ONLY'));
    expect(capabilitiesForRole('Content_Creator').length).toBeGreaterThan(0);
  });
});

describe('isPlatformSuperAdminPrincipal / hasPlatformWriteAuthority — exact role, active status, non-bridge', () => {
  const m = (role: string, status: string) => ({ organizations: [{ organizationId: P, role, status }] });
  it('only an active exact SUPER_ADMIN membership is platform authority', () => {
    expect(isPlatformSuperAdminPrincipal(m('SUPER_ADMIN', 'active') as never)).toBe(true);
    for (const [r, s] of [['super_admin', 'active'], ['Super_Admin', 'active'], ['SUPER_ADMIN', 'inactive'], ['SUPER_ADMIN', 'deactivated'], ['SUPER_ADMIN', 'invited'], ['SUPER_ADMIN', 'expired']]) {
      expect(isPlatformSuperAdminPrincipal(m(r, s) as never)).toBe(false);
    }
  });
  it('a bridge principal is never platform write authority, whatever it claims', () => {
    expect(hasPlatformWriteAuthority({ userId: 'b', organizations: [{ organizationId: P, role: 'SUPER_ADMIN', status: 'active' }], legacyCookieSuperAdmin: true } as never)).toBe(false);
    expect(hasPlatformWriteAuthority(null)).toBe(false);
  });
});

describe('the real requireCapability chain — a platform-tier WRITE', () => {
  const W = BILLING_GRANT_FREE_CREDITS;
  it('active SUPER_ADMIN + passkey step-up + trusted device → authorized', async () => {
    seed('u-sa', [['SUPER_ADMIN', 'active']]);
    expect(await gate({ user: 'u-sa' }, W)).toMatchObject({ ok: true });
  });
  it.each(['super_admin', 'Super_Admin', 'SUPER_admin'])('active %j (no exact row) → refused, never authorized', async (role) => {
    seed('u-x', [[role, 'active']]);
    const r = await gate({ user: 'u-x' }, W);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(mockAudit.some((e) => e.decision === 'allowed' || e.decision === 'elevated_route_accessed')).toBe(false);
  });
  it('active super_admin PLUS a direct grant of the write capability → 403 PLATFORM_SUPER_ADMIN_REQUIRED (grant is not authority)', async () => {
    seed('u-x', [['super_admin', 'active']], [W]);
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 403, code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
  });
  it.each(['inactive', 'expired', 'invited'])('SUPER_ADMIN with status %s → refused', async (status) => {
    seed('u-x', [['SUPER_ADMIN', status]]);
    expect((await gate({ user: 'u-x' }, W)).ok).toBe(false);
  });
  it('a deactivated SUPER_ADMIN that still holds direct grants → 403 PLATFORM_SUPER_ADMIN_REQUIRED', async () => {
    seed('u-x', [['SUPER_ADMIN', 'inactive']], [W]);
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 403, code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
  });
  it('tenant VIEW_ONLY with a direct write grant and valid step-up → 403 PLATFORM_SUPER_ADMIN_REQUIRED', async () => {
    seed('u-x', [['VIEW_ONLY', 'active']], [W]);
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 403, code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
  });
  it('tenant COMPANY_ADMIN with a direct write grant and valid step-up → 403 PLATFORM_SUPER_ADMIN_REQUIRED', async () => {
    seed('u-x', [['COMPANY_ADMIN', 'active']], [W]);
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 403, code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
  });
  it('a bridge principal claiming every capability → refused', async () => {
    const r = await gate({ bridge: true }, W);
    expect(r.ok).toBe(false);
    expect([401, 403]).toContain(r.status);
  });
  it('no principal → 401 NOT_AUTHENTICATED', async () => {
    expect(await gate(null, W)).toMatchObject({ ok: false, status: 401, code: 'NOT_AUTHENTICATED' });
  });
  it('active SUPER_ADMIN with NO step-up → 401 STEP_UP_REQUIRED (not weakened)', async () => {
    seed('u-x', [['SUPER_ADMIN', 'active']], [], null);
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 401, code: 'STEP_UP_REQUIRED' });
  });
  it('active SUPER_ADMIN with a TOTP (non-phishing-resistant) step-up → 401', async () => {
    seed('u-x', [['SUPER_ADMIN', 'active']], [], 'totp');
    expect(await gate({ user: 'u-x' }, W)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('read-only platform capabilities', () => {
  it.each([SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE])('%s via an exact active SUPER_ADMIN role → allowed (GET)', async (c) => {
    seed('u-sa', [['SUPER_ADMIN', 'active']]);
    expect((await gate({ user: 'u-sa' }, c, 'GET')).ok).toBe(true);
  });
  it.each([SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE])('%s via a lowercase super_admin role → no longer granted', async (c) => {
    seed('u-x', [['super_admin', 'active']]);
    expect(await gate({ user: 'u-x' }, c, 'GET')).toMatchObject({ ok: false, status: 403, code: 'CAPABILITY_NOT_HELD' });
  });
  it('a direct read grant still authorizes its read (unchanged)', async () => {
    seed('u-x', [['VIEW_ONLY', 'active']], [SUPER_ADMIN_DASHBOARD_VIEW]);
    expect((await gate({ user: 'u-x' }, SUPER_ADMIN_DASHBOARD_VIEW, 'GET')).ok).toBe(true);
  });
});
