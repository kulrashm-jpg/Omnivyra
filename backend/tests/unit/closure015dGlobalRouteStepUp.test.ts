/**
 * Closure-015D (Workstream A) — the five platform-wide withRBAC([SUPER_ADMIN])
 * routes: active platform super-admin authority (Closure-015C) plus, for the
 * two that can change the platform-global governance lock, the platform-controls
 * step-up (PLATFORM_CONTROLS_MANAGE: passkey on a trusted device, Closure-009).
 *
 *   unlock, restore-snapshot  → active platform SA + PLATFORM_CONTROLS_MANAGE step-up
 *   rebuild-projection,
 *   refresh-slots (session)   → active platform SA, no step-up (classification: owner decision)
 *   omnivyra/health (GET)     → active platform SA, read — no step-up
 *   refresh-slots (cron)      → CRON_SECRET bearer, unchanged
 *
 * REAL: the routes, withRBAC → enforceRole → getUserRole / isPlatformSuperAdmin,
 * requireActivePlatformSuperAdmin, requireCapability → resolvePrincipal
 * (IdentityResolver) → resolveUserCapabilities (CapabilityService) →
 * decideCapabilityWithStepUp → evaluateStepUp, enforcePlatformWriteAuthority —
 * all over the routeAuthHarness in-memory tables (user_company_roles,
 * capability_assignments, stepup_sessions, trusted_devices).
 * FAKED (I/O only): the identity provider / session lookup (by an x-test-user
 * header), the legacy cookie bridge (none), the security-audit sink (captured),
 * and each route's effect (spies that must stay untouched on denial).
 * In-memory: proves the routes' ordering and decisions, NOT Postgres/PostgREST.
 */
import { seed, invoke, failTable, CO_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';

const mockEffects = {
  releaseGovernanceLock: jest.fn(async () => undefined),
  restoreGovernanceSnapshot: jest.fn(async () => ({ restored: true })),
  rebuildGovernanceProjection: jest.fn(async () => undefined),
  runOpportunitySlotsScheduler: jest.fn(async () => ({ reopened: 0, companiesProcessed: 2, typesProcessed: 0, errors: [] })),
  getOmnivyraHealthReport: jest.fn(() => ({ status: 'disabled', endpoints: {}, avg_latency_ms: 0, success_rate: 0, last_error: 'omnivyra_disabled' })),
};
const mockSecurityAudit: Record<string, unknown>[] = [];

const testUser = (req: { headers?: Record<string, unknown> }): string | null => {
  const v = req?.headers?.['x-test-user'];
  return typeof v === 'string' && v ? v : null;
};

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' };
  },
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const user = req?.headers?.['x-test-user'];
    if (typeof user !== 'string' || !user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: async () => null }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockSecurityAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/GovernanceLockdownService', () => ({
  ...jest.requireActual('../../services/GovernanceLockdownService'),
  releaseGovernanceLock: (...a: unknown[]) => mockEffects.releaseGovernanceLock(...(a as [])),
}));
jest.mock('../../services/GovernanceSnapshotService', () => ({
  ...jest.requireActual('../../services/GovernanceSnapshotService'),
  restoreGovernanceSnapshot: (...a: unknown[]) => mockEffects.restoreGovernanceSnapshot(...(a as [])),
}));
jest.mock('../../services/GovernanceProjectionService', () => ({
  ...jest.requireActual('../../services/GovernanceProjectionService'),
  rebuildGovernanceProjection: (...a: unknown[]) => mockEffects.rebuildGovernanceProjection(...(a as [])),
}));
jest.mock('../../services/opportunitySlotsScheduler', () => ({
  runOpportunitySlotsScheduler: (...a: unknown[]) => mockEffects.runOpportunitySlotsScheduler(...(a as [])),
}));
jest.mock('../../services/omnivyraClientV1', () => ({
  getOmnivyraHealthReport: (...a: unknown[]) => mockEffects.getOmnivyraHealthReport(...(a as [])),
}));

import unlockRoute from '../../../pages/api/governance/unlock';
import restoreRoute from '../../../pages/api/governance/restore-snapshot';
import rebuildRoute from '../../../pages/api/governance/rebuild-projection';
import refreshSlotsRoute from '../../../pages/api/opportunities/refresh-slots';
import healthRoute from '../../../pages/api/omnivyra/health';
import { PLATFORM_CONTROLS_MANAGE, STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN rows
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const PAST = () => new Date(Date.now() - 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ user_id, company_id, role: r, status });
const stepUp = (user_id: string, factor: string, expires_at = FUTURE()) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at, consumed_at: null, revoked_at: null });
/** IdentityResolver's device fingerprint for a request with no UA / language / cookies. */
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const trustedDevice = (user_id: string) =>
  ({ id: `dev-${user_id}`, user_id, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });

const SUPER = 'u-super';                    // active SA, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';   // active SA, trusted device, no step-up session
const SUPER_STALE = 'u-super-stale';        // active SA, trusted device, EXPIRED passkey step-up
const SUPER_TOTP = 'u-super-totp';          // active SA, trusted device, TOTP step-up (not phishing-resistant)
const SUPER_UNTRUSTED = 'u-super-untrusted';// active SA, passkey step-up, untrusted device
const INVITED = 'u-invited';                // SUPER_ADMIN row in CO_A only INVITED; passkey + trusted device
const INACTIVE = 'u-inactive';              // SUPER_ADMIN row INACTIVE; passkey + trusted device
const EXPIRED = 'u-expired';                // SUPER_ADMIN row status EXPIRED; passkey + trusted device
const NOBODY = 'u-nobody';                  // authenticated, no membership at all
const CADMIN = 'u-cadmin';                  // active COMPANY_ADMIN of CO_A; passkey + trusted device
/** VIEW_ONLY tenant user with a DIRECT PLATFORM_CONTROLS_MANAGE grant, passkey step-up, trusted device. */
const GRANTEE = 'u-grantee';
const STEPPED = [SUPER, SUPER_UNTRUSTED, INVITED, INACTIVE, EXPIRED, CADMIN, GRANTEE];

function world() {
  seed({
    user_company_roles: [
      role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_STALE, P, 'SUPER_ADMIN'),
      role(SUPER_TOTP, P, 'SUPER_ADMIN'), role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
      role(INVITED, CO_A, 'SUPER_ADMIN', 'invited'), role(INACTIVE, P, 'SUPER_ADMIN', 'inactive'),
      role(EXPIRED, P, 'SUPER_ADMIN', 'expired'), role(CADMIN, CO_A, 'COMPANY_ADMIN'), role(GRANTEE, CO_A, 'VIEW_ONLY'),
    ],
    capability_assignments: [
      { user_id: GRANTEE, capability: PLATFORM_CONTROLS_MANAGE, organization_id: null, expires_at: null, revoked_at: null },
    ],
    stepup_sessions: [...STEPPED.map((u) => stepUp(u, 'webauthn')), stepUp(SUPER_TOTP, 'totp'), stepUp(SUPER_STALE, 'webauthn', PAST())],
    trusted_devices: [SUPER, SUPER_NO_STEPUP, SUPER_STALE, SUPER_TOTP, INVITED, INACTIVE, EXPIRED, CADMIN, GRANTEE].map(trustedDevice),
    users: [],
  });
}

type Route = { name: string; handler: unknown; method: 'GET' | 'POST'; body: Record<string, unknown>; effect: jest.Mock; stepUp: boolean };
const ROUTES: Route[] = [
  { name: 'POST /api/governance/unlock', handler: unlockRoute, method: 'POST', body: {}, effect: mockEffects.releaseGovernanceLock, stepUp: true },
  { name: 'POST /api/governance/restore-snapshot', handler: restoreRoute, method: 'POST', body: { snapshotId: 'snap-of-company-b' }, effect: mockEffects.restoreGovernanceSnapshot, stepUp: true },
  { name: 'POST /api/governance/rebuild-projection', handler: rebuildRoute, method: 'POST', body: { campaignId: CAMPAIGN_B }, effect: mockEffects.rebuildGovernanceProjection, stepUp: false },
  { name: 'POST /api/opportunities/refresh-slots', handler: refreshSlotsRoute, method: 'POST', body: {}, effect: mockEffects.runOpportunitySlotsScheduler, stepUp: false },
  { name: 'GET /api/omnivyra/health', handler: healthRoute, method: 'GET', body: {}, effect: mockEffects.getOmnivyraHealthReport, stepUp: false },
];
const STEP_UP_ROUTES = ROUTES.filter((r) => r.stepUp);
const NO_STEP_UP_ROUTES = ROUTES.filter((r) => !r.stepUp);

function call(r: Route, who: string | null, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const h = { ...(who ? { 'x-test-user': who } : {}), ...headers };
  const payload = { ...r.body, companyId: CO_A, ...extra };
  return r.method === 'GET'
    ? invoke(r.handler as never, { method: 'GET', query: payload, headers: h })
    : invoke(r.handler as never, { method: 'POST', body: payload, headers: h });
}

beforeEach(() => {
  world();
  mockSecurityAudit.length = 0;
  for (const m of Object.values(mockEffects)) m.mockClear();
  delete process.env.CRON_SECRET;
});

describe('policy wiring (registry facts the routes rely on)', () => {
  it('PLATFORM_CONTROLS_MANAGE requires step-up: passkey (phishing-resistant) on a trusted device', () => {
    expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(PLATFORM_CONTROLS_MANAGE);
    expect(getStepUpPolicy(PLATFORM_CONTROLS_MANAGE)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true });
  });
});

describe.each(STEP_UP_ROUTES)('$name — active platform SA + PLATFORM_CONTROLS_MANAGE step-up', (r) => {
  it('active platform SA with a valid passkey step-up on a trusted device → 200, effect runs once, elevated access audited', async () => {
    const res = await call(r, SUPER);
    expect(res.status).toBe(200);
    expect(r.effect).toHaveBeenCalledTimes(1);
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: PLATFORM_CONTROLS_MANAGE, decision: 'elevated_route_accessed', actorUserId: SUPER }));
  });

  it.each([
    ['no step-up session', SUPER_NO_STEPUP],
    ['an expired step-up session', SUPER_STALE],
    ['a TOTP (not phishing-resistant) step-up', SUPER_TOTP],
    ['a passkey step-up on an untrusted device', SUPER_UNTRUSTED],
  ])('active platform SA with %s → refused with STEP_UP_REQUIRED, effect never runs', async (_d, who) => {
    const res = await call(r, who);
    expect([401, 403]).toContain(res.status);
    expect(res.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(r.effect).not.toHaveBeenCalled();
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed')).toBe(false);
  });
});

describe.each(NO_STEP_UP_ROUTES)('$name — active platform SA, no step-up', (r) => {
  it('active platform SA WITHOUT any step-up session → 200, effect runs once', async () => {
    const res = await call(r, SUPER_NO_STEPUP);
    expect(res.status).toBe(200);
    expect(r.effect).toHaveBeenCalledTimes(1);
  });
});

describe.each(ROUTES)('$name — non-platform principals never reach the effect (even with a valid passkey step-up)', (r) => {
  it.each([
    ['an INVITED SUPER_ADMIN membership', INVITED],
    ['an INACTIVE SUPER_ADMIN membership', INACTIVE],
    ['an EXPIRED SUPER_ADMIN membership', EXPIRED],
    ['no membership at all', NOBODY],
    ['an active COMPANY_ADMIN of the requested company', CADMIN],
    ['a VIEW_ONLY member holding a DIRECT platform-controls grant', GRANTEE],
  ])('%s → 403, effect never runs, no elevated access recorded', async (_d, who) => {
    const res = await call(r, who);
    expect(res.status).toBe(403);
    expect(r.effect).not.toHaveBeenCalled();
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed')).toBe(false);
  });

  it('unauthenticated → 401, effect never runs', async () => {
    const res = await call(r, null);
    expect(res.status).toBe(401);
    expect(r.effect).not.toHaveBeenCalled();
  });

  it('membership lookup failure fails CLOSED for the active platform SA → never 200, effect never runs', async () => {
    failTable('user_company_roles');
    const res = await call(r, SUPER);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(r.effect).not.toHaveBeenCalled();
  });
});

describe('cross-company identifiers', () => {
  it('restore-snapshot: an invited SUPER_ADMIN of A naming A with B\'s snapshot id → 403 before the service', async () => {
    const res = await invoke(restoreRoute as never, { method: 'POST', body: { snapshotId: 'snap-of-company-b', companyId: CO_A }, headers: { 'x-test-user': INVITED } });
    expect(res.status).toBe(403);
    expect(mockEffects.restoreGovernanceSnapshot).not.toHaveBeenCalled();
  });

  it('rebuild-projection: an invited SUPER_ADMIN of A naming A with B\'s campaign id → 403 before the service', async () => {
    const res = await invoke(rebuildRoute as never, { method: 'POST', body: { campaignId: CAMPAIGN_B, companyId: CO_A }, headers: { 'x-test-user': INVITED } });
    expect(res.status).toBe(403);
    expect(mockEffects.rebuildGovernanceProjection).not.toHaveBeenCalled();
  });

  it('the stepped-up active platform SA keeps platform-wide authority (restores B\'s snapshot while naming A)', async () => {
    const res = await invoke(restoreRoute as never, { method: 'POST', body: { snapshotId: 'snap-of-company-b', companyId: CO_A }, headers: { 'x-test-user': SUPER } });
    expect(res.status).toBe(200);
    expect(mockEffects.restoreGovernanceSnapshot).toHaveBeenCalledWith('snap-of-company-b');
  });
});

describe('refresh-slots cron path is unchanged', () => {
  const SECRET = 'c15d-test-cron-secret-not-real';
  const refresh = ROUTES.find((r) => r.handler === refreshSlotsRoute) as Route;

  it('a valid CRON_SECRET bearer runs the scheduler with no membership and no step-up', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await invoke(refreshSlotsRoute as never, { method: 'POST', body: {}, headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(200);
    expect(mockEffects.runOpportunitySlotsScheduler).toHaveBeenCalledTimes(1);
  });

  it('a wrong secret falls through to the session path: an invited SUPER_ADMIN is still refused', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await call(refresh, INVITED, {}, { authorization: 'Bearer wrong-secret' });
    expect(res.status).toBe(403);
    expect(mockEffects.runOpportunitySlotsScheduler).not.toHaveBeenCalled();
  });

  it('with no CRON_SECRET configured, a bearer cannot match it (empty secret is never accepted)', async () => {
    const res = await invoke(refreshSlotsRoute as never, { method: 'POST', body: {}, headers: { authorization: 'Bearer ' } });
    expect(res.status).toBe(401);
    expect(mockEffects.runOpportunitySlotsScheduler).not.toHaveBeenCalled();
  });
});

describe('health route policy (read-only)', () => {
  it('GET returns only the in-process Omnivyra report fields — no step-up demanded of a read', async () => {
    const health = ROUTES.find((r) => r.handler === healthRoute) as Route;
    const res = await call(health, SUPER_NO_STEPUP);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['avg_latency_ms', 'endpoints', 'last_error', 'status', 'success_rate']);
  });

  it('a non-GET method is refused before any report is built', async () => {
    const res = await invoke(healthRoute as never, { method: 'POST', body: { companyId: CO_A }, headers: { 'x-test-user': SUPER } });
    expect(res.status).toBe(405);
    expect(mockEffects.getOmnivyraHealthReport).not.toHaveBeenCalled();
  });
});
