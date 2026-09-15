/**
 * SEC91-W2E-1 (P3) — the rest of the server derived the client IP from the FIRST hop
 * of X-Forwarded-For, which the client writes.
 *
 * SEC-E2 added lib/security/clientIp.ts (getTrustedClientIp) and SEC91-W2B moved every
 * pages/api/auth/** route onto it. The remaining readers — public tracking / capture
 * routes, the domain-verification routes, the access-request limiter, the admin rate
 * limiter, and the super-admin / bridge / capability audit fields — now use it too
 * (getTrustedClientIp for 'unknown'-defaulting keys, getTrustedClientIpOrNull for
 * nullable fields).
 *
 * Off Vercel (VERCEL unset, no TRUSTED_PROXY_HOPS) a spoofed X-Forwarded-For must not
 * become the rate-limit key or the recorded IP: the socket peer is used. On Vercel the
 * edge-set client address (x-real-ip == the edge-overwritten first XFF hop) is used,
 * i.e. production behaviour is unchanged.
 *
 * Fixtures use documentation addresses only (RFC 5737).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: null, error: 'NO_TOKEN' }),
}));

// IP-keyed limiter (lib/auth/rateLimit): record the key, deny, so routes stop at 429.
const mockRateLimitKeys: string[] = [];
jest.mock('../../../lib/auth/rateLimit', () => {
  const actual = jest.requireActual('../../../lib/auth/rateLimit');
  return {
    ...actual,
    checkRateLimit: jest.fn(async (key: string) => {
      mockRateLimitKeys.push(key);
      return { allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 60, bypassed: false };
    }),
  };
});

// Security audit sink: record every event (ip field is what we check).
const mockAudit: Array<Record<string, unknown>> = [];
jest.mock('../../security/audit/SecurityAuditService', () => {
  const actual = jest.requireActual('../../security/audit/SecurityAuditService');
  return {
    ...actual,
    logSecurityEvent: jest.fn(async (e: Record<string, unknown>) => { mockAudit.push(e); }),
    logCookieSuperAdminUsage: jest.fn(async (e: Record<string, unknown>) => { mockAudit.push(e); }),
  };
});

jest.mock('../../services/domainEligibilityService', () => ({
  checkDomainEligibility: jest.fn(async () => ({ eligible: true, result: 'eligible' })),
  isNonWorkEmailDomain: jest.fn(),
}));
jest.mock('../../../lib/auth/domainEligibilityModel', () => ({ reviewableResults: new Set<string>() }));

// website-events/track boundaries.
const mockTrackKeys: string[] = [];
let mockTrackAllow = false;
jest.mock('../../services/trackingRateLimitService', () => ({
  checkInMemoryRateLimit: jest.fn((key: string) => {
    mockTrackKeys.push(key);
    return mockTrackAllow ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: 1000 };
  }),
  isLikelyBot: jest.fn(() => false),
}));
jest.mock('../../services/websiteDomainEnforcementService', () => {
  const actual = jest.requireActual('../../services/websiteDomainEnforcementService');
  return { ...actual, checkWebsiteOrigin: jest.fn(async () => ({ allowed: true })) };
});
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: jest.fn(async () => ({ sessionId: 'fake-session-1' })),
  persistCampaignTouchpoint: jest.fn(async () => undefined),
}));
jest.mock('../../services/leadIntelligenceActivation', () => ({ triggerVisitorSessionIntelligence: jest.fn() }));
jest.mock('../../services/leadIntelligenceTelemetry', () => ({
  recordVisitorContext: jest.fn(),
  recordEventIngestion: jest.fn(),
}));

// website/lead-capture boundaries.
const mockCaptureInputs: Array<{ ip: string | null }> = [];
jest.mock('../../services/leadCaptureProtection', () => ({
  evaluateCaptureProtection: jest.fn(async (input: { ip: string | null }) => {
    mockCaptureInputs.push(input);
    return { allowed: false, httpStatus: 429, reason: 'rate_limited', retryAfterMs: 1000 };
  }),
}));
jest.mock('../../services/leadCaptureService', () => ({
  captureWebsiteLead: jest.fn(),
  LeadCaptureError: class LeadCaptureError extends Error {},
}));
jest.mock('../../services/tenantResolutionService', () => ({ resolveTenantForWebsite: jest.fn(async () => null) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const harness = require('../helpers/routeAuthHarness');
const route = (p: string) => require(`../../../pages/api/${p}`).default;
/* eslint-enable @typescript-eslint/no-var-requires */

import { getTrustedClientIpOrNull } from '../../../lib/security/clientIp';
import { requestIp } from '../../services/signupEventService';
import { requireAdminRateLimit } from '../../services/requestAccessService';
import { requireCapability } from '../../security/requireCapability';
import { getLegacySuperAdminSession } from '../../services/superAdminSession';
import { resolveLegacyCookieSuperAdminPrincipal } from '../../security/legacyCookieSuperAdminBridge';
import { _resetEnvCredentialRateLimit } from '../../../pages/api/admin/bootstrap-super-admin';

const SPOOFED = '198.51.100.7';
const PEER = '203.0.113.10';
const EDGE = '203.0.113.20';

const ENV_KEYS = [
  'VERCEL', 'TRUSTED_PROXY_HOPS', 'RATE_LIMIT_SALT',
  'CONTENT_ARCHITECT_USERNAME', 'CONTENT_ARCHITECT_PASSWORD',
  'SUPER_ADMIN_USERNAME', 'SUPER_ADMIN_PASSWORD',
];
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockRateLimitKeys.length = 0;
  mockAudit.length = 0;
  mockTrackKeys.length = 0;
  mockTrackAllow = false;
  mockCaptureInputs.length = 0;
  harness.seed();
});

type Out = { status: number; body: unknown };
function makeReq(p: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown; peer?: string | null; cookies?: Record<string, string> }) {
  return {
    method: opts.method ?? 'POST',
    url: `/api/${p}`,
    query: {},
    body: opts.body ?? {},
    headers: { ...(opts.headers ?? {}) },
    cookies: opts.cookies ?? {},
    socket: { remoteAddress: opts.peer === undefined ? PEER : opts.peer },
  } as any;
}
function makeRes(out: Out) {
  return {
    statusCode: 200, headersSent: false,
    status(c: number) { out.status = c; this.statusCode = c; return this; },
    json(b: unknown) { out.body = b; this.headersSent = true; return this; },
    send(b: unknown) { out.body = b; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
    setHeader() { return this; }, getHeader() { return undefined; }, removeHeader() { return this; },
    redirect() { this.headersSent = true; return this; }, on() { return this; }, once() { return this; },
  } as any;
}
async function call(p: string, opts: Parameters<typeof makeReq>[1] = {}): Promise<Out> {
  const out: Out = { status: 200, body: undefined };
  await route(p)(makeReq(p, opts), makeRes(out));
  return out;
}

const spoofed = { 'x-forwarded-for': `${SPOOFED}, ${PEER}` };
const vercelEdge = { 'x-real-ip': EDGE, 'x-forwarded-for': EDGE, 'x-vercel-forwarded-for': EDGE };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('getTrustedClientIpOrNull', () => {
  it('returns the same address as getTrustedClientIp, or null instead of "unknown"', () => {
    expect(getTrustedClientIpOrNull({ headers: spoofed, socket: { remoteAddress: PEER } })).toBe(PEER);
    expect(getTrustedClientIpOrNull({ headers: spoofed, socket: null })).toBeNull();
    process.env.VERCEL = '1';
    expect(getTrustedClientIpOrNull({ headers: vercelEdge, socket: { remoteAddress: PEER } })).toBe(EDGE);
  });
});

describe('domain/* rate-limit keys use the trusted client IP', () => {
  const DOMAIN_ROUTES: Array<[string, string]> = [
    ['domain/verify', 'POST'],
    ['domain/regenerate-token', 'POST'],
    ['domain/track-event', 'POST'],
    ['domain/verification-status', 'GET'],
  ];
  it.each(DOMAIN_ROUTES)('off-platform: a spoofed X-Forwarded-For does not choose the %s bucket', async (p, method) => {
    const r = await call(p, { method, headers: spoofed });
    expect(r.status).toBe(429);
    expect(mockRateLimitKeys).toEqual([PEER]);
  });
  it.each(DOMAIN_ROUTES)('COMPAT Vercel: %s keys on the edge-set client address', async (p, method) => {
    process.env.VERCEL = '1';
    const r = await call(p, { method, headers: vercelEdge });
    expect(r.status).toBe(429);
    expect(mockRateLimitKeys).toEqual([EDGE]);
  });
  it('no parseable address still keys "unknown" (contract kept)', async () => {
    await call('domain/verify', { headers: { 'x-forwarded-for': SPOOFED }, peer: null });
    expect(mockRateLimitKeys).toEqual(['unknown']);
  });
});

describe('access/request: the per-IP access-request limiter hashes the trusted client IP', () => {
  const ipHashFor = (ip: string) => sha(ip + 'fake-salt');
  const reqOpts = (headers: Record<string, string>) => ({
    headers: { ...headers, authorization: `Bearer ${harness.TOKENS.A}` },
    body: { companyName: 'Fake Co', useCase: 'fake use case' },
  });
  const limiterHashes = () => harness.calls()
    .filter((c: { table: string; filters: Record<string, unknown> }) => c.table === 'access_request_rate_limit' && c.filters.ip_hash)
    .map((c: { filters: Record<string, unknown> }) => c.filters.ip_hash);

  it('off-platform: a spoofed X-Forwarded-For does not pick the bucket (socket peer is hashed)', async () => {
    process.env.RATE_LIMIT_SALT = 'fake-salt';
    // The peer's bucket is full: the spoofed header must not escape it.
    harness.seed({ access_request_rate_limit: [{ ip_hash: ipHashFor(PEER), request_count: 3, window_start: new Date().toISOString() }] });
    const r = await call('access/request', reqOpts(spoofed));
    expect(r.status).toBe(429);
    expect(limiterHashes()).toEqual([ipHashFor(PEER)]);
    expect(limiterHashes()).not.toContain(ipHashFor(SPOOFED));
  });
  it('COMPAT Vercel: the edge-set client address is hashed', async () => {
    process.env.VERCEL = '1';
    process.env.RATE_LIMIT_SALT = 'fake-salt';
    harness.seed({ access_request_rate_limit: [{ ip_hash: ipHashFor(EDGE), request_count: 3, window_start: new Date().toISOString() }] });
    const r = await call('access/request', reqOpts(vercelEdge));
    expect(r.status).toBe(429);
    expect(limiterHashes()).toEqual([ipHashFor(EDGE)]);
  });
});

describe('website-events/track: rate-limit key and recorded ip_hash use the trusted client IP', () => {
  const body = { website_id: 'fake-website-1', anonymous_id: 'fake-anon-1', event_name: 'page_view' };
  it('off-platform: the rate-limit key is the socket peer, not the spoofed header', async () => {
    const r = await call('website-events/track', { headers: spoofed, body });
    expect(r.status).toBe(429);
    expect(mockTrackKeys).toEqual([`fake-website-1:${PEER}`]);
  });
  it('off-platform: the stored ip_hash is the socket peer hash', async () => {
    mockTrackAllow = true;
    harness.seed({ websites: [{ id: 'fake-website-1', company_id: harness.CO_A }] });
    const r = await call('website-events/track', { headers: spoofed, body });
    expect(r.status).toBe(202);
    const inserts = harness.writeCalls(['tracking_events']);
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as Record<string, unknown>).ip_hash).toBe(sha(PEER));
  });
  it('COMPAT Vercel: key and ip_hash are the edge-set client address', async () => {
    process.env.VERCEL = '1';
    mockTrackAllow = true;
    harness.seed({ websites: [{ id: 'fake-website-1', company_id: harness.CO_A }] });
    const r = await call('website-events/track', { headers: vercelEdge, body });
    expect(r.status).toBe(202);
    expect(mockTrackKeys).toEqual([`fake-website-1:${EDGE}`]);
    expect((harness.writeCalls(['tracking_events'])[0].payload as Record<string, unknown>).ip_hash).toBe(sha(EDGE));
  });
  it('no parseable address: key falls back to anonymous_id and ip_hash is null (contract kept)', async () => {
    mockTrackAllow = true;
    harness.seed({ websites: [{ id: 'fake-website-1', company_id: harness.CO_A }] });
    await call('website-events/track', { headers: { 'x-forwarded-for': SPOOFED }, body, peer: null });
    expect(mockTrackKeys).toEqual(['fake-website-1:fake-anon-1']);
    expect((harness.writeCalls(['tracking_events'])[0].payload as Record<string, unknown>).ip_hash).toBeNull();
  });
});

describe('website/lead-capture: the abuse-protection IP is the trusted client IP', () => {
  it('off-platform: a spoofed X-Forwarded-For is not the protection IP', async () => {
    const r = await call('website/lead-capture', { headers: spoofed, body: { email: 'someone@example.test' } });
    expect(r.status).toBe(429);
    expect(mockCaptureInputs.map((i) => i.ip)).toEqual([PEER]);
  });
  it('COMPAT Vercel: the edge-set client address is the protection IP', async () => {
    process.env.VERCEL = '1';
    await call('website/lead-capture', { headers: vercelEdge, body: { email: 'someone@example.test' } });
    expect(mockCaptureInputs.map((i) => i.ip)).toEqual([EDGE]);
  });
  it('no parseable address: ip is null (contract kept)', async () => {
    await call('website/lead-capture', { headers: { 'x-forwarded-for': SPOOFED }, body: {}, peer: null });
    expect(mockCaptureInputs.map((i) => i.ip)).toEqual([null]);
  });
});

describe('tracking/link-click: the recorded ip_hash is the trusted client IP', () => {
  const ipHashRecorded = () => {
    const inserts = harness.writeCalls(['audit_logs']);
    expect(inserts).toHaveLength(1);
    return ((inserts[0].payload as Record<string, unknown>).metadata as Record<string, unknown>).ip_hash;
  };
  it('off-platform: the socket peer is hashed, not the spoofed header', async () => {
    const r = await call('tracking/link-click', { headers: spoofed, body: { tracking_url: 'https://example.test/x' } });
    expect(r.status).toBe(200);
    expect(ipHashRecorded()).toBe(sha(PEER));
  });
  it('COMPAT Vercel: the edge-set client address is hashed', async () => {
    process.env.VERCEL = '1';
    await call('tracking/link-click', { headers: vercelEdge, body: {} });
    expect(ipHashRecorded()).toBe(sha(EDGE));
  });
  it('no parseable address: ip_hash is null (contract kept)', async () => {
    await call('tracking/link-click', { headers: { 'x-forwarded-for': SPOOFED }, body: {}, peer: null });
    expect(ipHashRecorded()).toBeNull();
  });
});

describe('admin/bootstrap-super-admin: the env-credential limiter keys on the trusted client IP', () => {
  beforeEach(() => {
    _resetEnvCredentialRateLimit();
    process.env.SUPER_ADMIN_USERNAME = 'fake-admin-user';
    process.env.SUPER_ADMIN_PASSWORD = 'fake-admin-password';
  });
  const attempt = (xff: string) => call('admin/bootstrap-super-admin', {
    headers: { 'x-forwarded-for': xff },
    body: { mode: 'env-credential', username: 'fake-admin-user', password: 'fake-wrong', bootstrapToken: 'fake-token', targetUserId: 'fake-target' },
  });
  it('off-platform: rotating a spoofed X-Forwarded-For does not reset the failure bucket', async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i += 1) statuses.push((await attempt(`198.51.100.${i}`)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const ips = mockAudit.map((e) => e.ip);
    expect(new Set(ips)).toEqual(new Set([PEER]));
  });
});

describe('super-admin/content-architect-login: audit ip_address is the trusted client IP', () => {
  it('off-platform: a failed login records the socket peer, not the raw X-Forwarded-For', async () => {
    process.env.CONTENT_ARCHITECT_USERNAME = 'fake-ca-user';
    process.env.CONTENT_ARCHITECT_PASSWORD = 'fake-ca-password';
    const r = await call('super-admin/content-architect-login', { headers: spoofed, body: { username: 'fake-ca-user', password: 'fake-wrong' } });
    expect(r.status).toBe(403);
    const rows = harness.writeCalls(['super_admin_audit_logs']);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as Record<string, unknown>).ip_address).toBe(PEER);
  });
});

describe('backend helpers use the trusted client IP', () => {
  const req = (headers: Record<string, string>, peer: string | null = PEER, extra: Record<string, unknown> = {}) =>
    ({ method: 'GET', url: '/api/fake-route', query: {}, body: {}, headers, cookies: {}, socket: { remoteAddress: peer }, ...extra }) as any;
  const res = () => makeRes({ status: 200, body: undefined });

  it('signupEventService.requestIp: socket peer off-platform, edge on Vercel, "unknown" when nothing parses', () => {
    expect(requestIp(req(spoofed))).toBe(PEER);
    expect(requestIp(req(spoofed, null))).toBe('unknown');
    process.env.VERCEL = '1';
    expect(requestIp(req(vercelEdge))).toBe(EDGE);
  });

  it('requestAccessService.requireAdminRateLimit keys on the socket peer off-platform', async () => {
    expect(await requireAdminRateLimit(req(spoofed), res(), 'rl:fake-admin')).toBe(false);
    expect(mockRateLimitKeys).toEqual([PEER]);
  });
  it('COMPAT Vercel: requireAdminRateLimit keys on the edge-set client address', async () => {
    process.env.VERCEL = '1';
    await requireAdminRateLimit(req(vercelEdge), res(), 'rl:fake-admin');
    expect(mockRateLimitKeys).toEqual([EDGE]);
  });

  it('requireCapability: the unauthenticated-attempt audit row carries the socket peer', async () => {
    const r = await requireCapability(req(spoofed), res(), { capability: 'super_admin.legacy' as any, reason: 'fake-sec91-w2e-test' });
    expect(r.ok).toBe(false);
    expect(mockAudit.map((e) => e.ip)).toEqual([PEER]);
  });
  it('COMPAT Vercel: requireCapability audit carries the edge-set client address', async () => {
    process.env.VERCEL = '1';
    await requireCapability(req(vercelEdge), res(), { capability: 'super_admin.legacy' as any, reason: 'fake-sec91-w2e-test' });
    expect(mockAudit.map((e) => e.ip)).toEqual([EDGE]);
  });

  it('superAdminSession: a rejected bridge cookie is audited with the socket peer', async () => {
    expect(getLegacySuperAdminSession(req(spoofed, PEER, { cookies: { super_admin_session: 'fake-not-a-signed-cookie' } }))).toBeNull();
    await new Promise((r) => setImmediate(r));
    expect(mockAudit.length).toBeGreaterThan(0);
    expect(new Set(mockAudit.map((e) => e.ip))).toEqual(new Set([PEER]));
  });

  it('legacyCookieSuperAdminBridge: a rejected bridge cookie is audited with the socket peer', async () => {
    const r = await resolveLegacyCookieSuperAdminPrincipal(req({ ...spoofed, cookie: 'super_admin_session=fake-not-a-signed-cookie' }));
    expect(r).toBeNull();
    expect(mockAudit.length).toBeGreaterThan(0);
    expect(new Set(mockAudit.map((e) => e.ip))).toEqual(new Set([PEER]));
  });
  it('COMPAT Vercel: the bridge audit carries the edge-set client address', async () => {
    process.env.VERCEL = '1';
    await resolveLegacyCookieSuperAdminPrincipal(req({ ...vercelEdge, cookie: 'super_admin_session=fake-not-a-signed-cookie' }));
    expect(new Set(mockAudit.map((e) => e.ip))).toEqual(new Set([EDGE]));
  });
});

describe('source pin: no server file reads X-Forwarded-For itself', () => {
  const ROOTS = ['pages/api', 'backend', 'lib'];
  /** The canonical resolvers — the only modules allowed to read forwarding headers. */
  const ALLOWED = new Set([
    'lib/security/clientIp.ts',
    'backend/auth/requestClientIp.ts',
    'backend/services/ai/trustedClientIp.ts',
  ]);
  /**
   * PENDING — files owned by a concurrent workstream awaiting the SEC91-W2E patch.
   * Empty since STEP 3AH-91 integration applied it to backend/security/TenantGuard.ts.
   */
  const PENDING = new Set<string>([]);
  const READ = /headers\s*\[\s*['"`]x-forwarded-for['"`]\s*\]|headers\s*\.\s*get\s*\(\s*['"`]x-forwarded-for['"`]\s*\)/i;

  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'tests') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.test\.(ts|tsx|js)$/.test(e.name)) files.push(full);
    }
  };
  for (const r of ROOTS) walk(path.join(process.cwd(), r));
  const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, '/');
  const offenders = files.filter((f) => READ.test(fs.readFileSync(f, 'utf8'))).map(rel);

  it('scans a non-trivial set of server files', () => {
    expect(files.length).toBeGreaterThan(500);
  });
  it('every other IP read goes through lib/security/clientIp (getTrustedClientIp)', () => {
    expect(offenders.filter((f) => !ALLOWED.has(f) && !PENDING.has(f))).toEqual([]);
  });
  it('the pending list is still accurate (remove an entry once its file is fixed)', () => {
    for (const f of PENDING) expect(offenders).toContain(f);
  });
});
