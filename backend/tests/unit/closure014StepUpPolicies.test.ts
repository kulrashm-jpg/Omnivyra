/**
 * Closure-014 (C) — the last three platform-tier write capabilities
 * (blog.publish.manage, cron.config.manage, intelligence.override.manage) now
 * register a passkey + trusted-device step-up; reads gated by them do not.
 *
 * Real: requireCapability → resolvePrincipal → resolveUserCapabilities →
 * decideCapabilityWithStepUp, the StepUpPolicyRegistry, and the cron-config /
 * queue-config route handlers. Faked: DB rows, identity/session lookup, the
 * runtime-config store (a spy that must stay untouched on refusal), the admin
 * audit sink, rate limiting and the idempotency wrapper (covered by
 * closure014IdempotencyAuthorization.test.ts).
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
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: async () => null }));
const mockAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: jest.fn(async () => undefined) }));
const mockSave = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../../services/adminRuntimeConfig', () => ({
  getCronAdminConfig: async () => ({ v: 1, jobs: {} }),
  getQueueAdminConfig: async () => ({ v: 1, queues: {} }),
  saveCronAdminConfig: (...a: unknown[]) => mockSave(...a),
  saveQueueAdminConfig: (...a: unknown[]) => mockSave(...a),
  validateCronConfig: (b: unknown) => ({ valid: true, error: null, config: b }),
  validateQueueConfig: (b: unknown) => ({ valid: true, error: null, config: b }),
}));

import cronConfig from '../../../pages/api/admin/cron-config';
import queueConfig from '../../../pages/api/admin/queue-config';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import {
  BLOG_PUBLISH_MANAGE, CRON_CONFIG_MANAGE, INTELLIGENCE_OVERRIDE_MANAGE, STEP_UP_REQUIRED_CAPABILITIES,
  SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE,
} from '../../../shared/contracts/security';

const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fp(): string { let h = 5381; for (const ch of '||') h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return `dj2-${h.toString(36)}`; }
function seedSuper(user: string, factor: 'webauthn' | 'totp' | null) {
  mockTables.user_company_roles.push({ user_id: user, company_id: P, role: 'SUPER_ADMIN', status: 'active' });
  if (factor) mockTables.stepup_sessions.push({ id: `su-${user}`, user_id: user, auth_session_id: `sess-${user}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });
  mockTables.trusted_devices.push({ id: `dev-${user}`, user_id: user, fingerprint: fp(), expires_at: FUTURE(), revoked_at: null });
}
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
async function call(h: unknown, user: string, method: string, body: unknown = {}) {
  const r = { statusCode: 200, body: undefined as unknown } as Record<string, unknown> & { statusCode: number; body: unknown };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  await (h as Handler)({ headers: { 'x-test-user': user }, method, url: '/x', socket: {}, cookies: {}, query: {}, body }, r);
  return { status: r.statusCode, code: (r.body as { code?: string } | undefined)?.code };
}

beforeEach(() => {
  for (const t of ['user_company_roles', 'capability_assignments', 'stepup_sessions', 'trusted_devices', 'users']) mockTables[t] = [];
  mockAudit.length = 0;
  mockSave.mockClear();
});

describe('policy registration', () => {
  it.each([BLOG_PUBLISH_MANAGE, CRON_CONFIG_MANAGE, INTELLIGENCE_OVERRIDE_MANAGE])('%s: passkey on a trusted device, fresh within 10 minutes', (c) => {
    expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(c);
    expect(getStepUpPolicy(c)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true, maxAgeSeconds: 600 });
  });
  it('invariant: EVERY platform-tier write capability registers a phishing-resistant, trusted-device step-up', () => {
    const write = PLATFORM_TIER_CAPABILITIES.filter((c) => c !== SUPER_ADMIN_DASHBOARD_VIEW && c !== CONSUMPTION_VIEW_AGGREGATE);
    for (const c of write) {
      expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(c);
      expect(getStepUpPolicy(c)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true });
    }
  });
});

describe.each([
  ['cron-config', cronConfig],
  ['queue-config', queueConfig],
])('%s route', (_n, route) => {
  it('GET (the 60s panel poll) needs NO step-up', async () => {
    seedSuper('u-sa', null);
    expect((await call(route, 'u-sa', 'GET')).status).toBe(200);
  });
  it('POST without step-up → 401 STEP_UP_REQUIRED, nothing saved', async () => {
    seedSuper('u-sa', null);
    expect(await call(route, 'u-sa', 'POST', { v: 1 })).toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('POST with a TOTP (non-phishing-resistant) step-up → 401, nothing saved', async () => {
    seedSuper('u-sa', 'totp');
    expect((await call(route, 'u-sa', 'POST', { v: 1 })).status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('POST with a passkey step-up on a trusted device → 200, saved once', async () => {
    seedSuper('u-sa', 'webauthn');
    expect((await call(route, 'u-sa', 'POST', { v: 1 })).status).toBe(200);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
