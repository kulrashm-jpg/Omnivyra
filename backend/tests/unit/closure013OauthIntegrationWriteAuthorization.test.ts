/**
 * Closure-013 (D-3) — platform write authority on the OAuth / integration
 * management write routes.
 *
 * Closure-012 found, on real non-production infrastructure, that a VIEW_ONLY
 * tenant user holding a DIRECT capability_assignments grant of
 * INTEGRATION_PLATFORM_OAUTH_MANAGE plus a valid passkey step-up on a trusted
 * device passed authorization on platform-oauth-configs POST/DELETE and
 * analytics-provider-config POST (audit: `allowed` + `elevated_route_accessed`).
 * The same gap was found statically on provider-accounts (POST, PUT, DELETE),
 * curated-industry-sources (POST, PATCH, DELETE) and linkedin-media-smoke-test
 * (POST). A capability grant is not platform authority; every one of these
 * writes now also requires an active platform SUPER_ADMIN on a canonical
 * (non-bridge) principal, checked before any business read, write or provider
 * call, and a refusal is recorded as `elevated_route_denied`.
 *
 * Drives the REAL chain: route handler → requireCapability → resolvePrincipal
 * → resolveUserCapabilities (user_company_roles + capability_assignments) →
 * decideCapabilityWithStepUp → enforcePlatformWriteAuthority. Only I/O is
 * replaced: database rows, the identity/session lookup, the legacy bridge, the
 * security-audit sink, per-IP rate limiting, credential encryption and each
 * route's downstream effect (a spy that must stay untouched on denial). No real
 * provider is called; the LinkedIn upload is a spy.
 *
 * In-memory: proves the routes' ordering and decisions, NOT Postgres RLS.
 */

// ── Database fake ─────────────────────────────────────────────────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string; payload?: unknown }[] = [];
const mockReads: string[] = [];
function mockBuilder(table: string) {
  mockReads.push(table);
  let rows = [...(mockTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain, not: chain, contains: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    update: (p: unknown) => { mockWrites.push({ table, op: 'update', payload: p }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    insert: (p: unknown) => { mockWrites.push({ table, op: 'insert', payload: p }); return b; },
    upsert: (p: unknown) => { mockWrites.push({ table, op: 'upsert', payload: p }); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockBuilder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));

// ── Identity, session, bridge ─────────────────────────────────────────────────
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
  resolveSessionFromRequest: async (req: { headers: Record<string, string> }) => {
    const user = req.headers['x-test-user'];
    if (!user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  // 'all-caps' claims every capability, a SUPER_ADMIN membership and an active
  // passkey step-up: the strongest bridge principal there could be.
  resolveLegacyCookieSuperAdminPrincipal: async (req: { headers: Record<string, string> }) => {
    const kind = req.headers['x-test-bridge'];
    if (!kind) return null;
    const sec = jest.requireActual('../../../shared/contracts/security');
    const reg = jest.requireActual('../../security/capabilityRegistry');
    const allCaps = kind === 'all-caps';
    return {
      userId: 'legacy:cookie-super-admin', supabaseUid: 'legacy:cookie-super-admin', email: '', emailVerified: false,
      sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
      organizations: allCaps ? [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }] : [],
      activeOrgId: null,
      capabilities: allCaps ? [...sec.ALL_CAPABILITIES] : [...reg.legacyCookieSuperAdminCapabilities()],
      mfa: { enrolled: allCaps, factors: allCaps ? ['webauthn'] : [], lastVerifiedAt: null, phishingResistant: allCaps },
      device: { deviceId: null, trusted: allCaps, fingerprint: 'bridge' },
      stepUp: allCaps
        ? { active: true, expiresAt: new Date(Date.now() + 300_000), factor: 'webauthn', sessionId: 'su-bridge' }
        : { active: false, expiresAt: null, factor: null, sessionId: null },
      legacyCookieSuperAdmin: true,
    };
  },
}));
const mockSecurityAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockSecurityAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
let mockRateLimited = false;
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }) => {
    if (mockRateLimited) { res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }); return false; }
    return true;
  },
}));
// GET-only helpers of the routes under test; never reached by a write.
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null, error: 'NO_TOKEN' }) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => false, isSuperAdmin: async () => false }));

// ── Route side effects (every protected effect is a spy) ───────────────────────
const fx = {
  encryptCredential: jest.fn((v: string) => `enc:${v.length}`),
  decryptCredential: jest.fn(() => ''),
  upsertAnalyticsProviderConfig: jest.fn(async () => undefined),
  getAnalyticsProviderConfigSummary: jest.fn(async () => ({ provider: 'google_analytics' })),
  buildCredentialEnvelope: jest.fn(() => '{"v":1}'),
  createProviderAccount: jest.fn(async () => ({ id: 'acc-new', credentials_encrypted: 'x' })),
  updateProviderAccount: jest.fn(async (id: string) => ({ id, credentials_encrypted: 'x' })),
  deactivateProviderAccount: jest.fn(async () => undefined),
  listAccountsForApi: jest.fn(async () => []),
  getSocialAccount: jest.fn(async () => ({ id: 'sa-1', platform: 'linkedin', platform_user_id: 'li-1' })),
  getToken: jest.fn(async () => ({ access_token: 'synthetic-not-a-token' })),
  getOrUploadLinkedInAsset: jest.fn(async () => ({ ok: true, result: { kind: 'image', fromCache: false } })),
  insertAuditLogStrict: jest.fn(async () => undefined),
  savePageSpeedConfig: jest.fn(async () => ({ provider: 'google_pagespeed', hasStoredKey: true, keyDisplay: '•••••••• (encrypted)' })),
};
const via = (k: keyof typeof fx) => (...a: unknown[]) => (fx[k] as (...x: unknown[]) => unknown)(...a);
jest.mock('../../auth/credentialEncryption', () => ({ encryptCredential: via('encryptCredential'), decryptCredential: via('decryptCredential') }));
jest.mock('../../services/analyticsProviderConfigService', () => ({
  upsertAnalyticsProviderConfig: via('upsertAnalyticsProviderConfig'),
  getAnalyticsProviderConfigSummary: via('getAnalyticsProviderConfigSummary'),
  getDefaultAnalyticsProviderScopes: () => ['openid'],
  getDefaultAnalyticsRedirectUri: () => 'https://app.example.test/callback',
}));
jest.mock('../../services/providerAccountService', () => ({
  buildCredentialEnvelope: via('buildCredentialEnvelope'),
  createProviderAccount: via('createProviderAccount'),
  updateProviderAccount: via('updateProviderAccount'),
  deactivateProviderAccount: via('deactivateProviderAccount'),
  listAccountsForApi: via('listAccountsForApi'),
}));
jest.mock('../../db/queries', () => ({ getSocialAccount: via('getSocialAccount') }));
jest.mock('../../auth/tokenStore', () => ({ getToken: via('getToken') }));
jest.mock('../../adapters/linkedin/linkedinMediaUpload', () => ({
  getOrUploadLinkedInAsset: via('getOrUploadLinkedInAsset'),
  inferLinkedInMediaKind: () => 'image',
}));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: via('insertAuditLogStrict'), SYSTEM_USER_ID: 'system' }));
jest.mock('../../services/pageSpeedProviderConfigService', () => ({
  PageSpeedSaveError: class PageSpeedSaveError extends Error {},
  savePageSpeedConfig: via('savePageSpeedConfig'),
  getPageSpeedConfigSummary: async () => ({ provider: 'google_pagespeed' }),
  checkPageSpeedConfig: async () => ({ provider: 'google_pagespeed' }),
}));

import oauthConfigsRoute from '../../../pages/api/super-admin/platform-oauth-configs';
import analyticsConfigRoute from '../../../pages/api/super-admin/analytics-provider-config';
import pageSpeedConfigRoute from '../../../pages/api/super-admin/pagespeed-config';
import providerAccountsRoute from '../../../pages/api/provider-accounts/index';
import providerAccountRoute from '../../../pages/api/provider-accounts/[id]';
import curatedSourcesRoute from '../../../pages/api/super-admin/curated-industry-sources';
import linkedinSmokeRoute from '../../../pages/api/super-admin/linkedin-media-smoke-test';
import { enforcePlatformWriteAuthority } from '../../security/platformWriteAuthority';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN rows
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ user_id, company_id, role: r, status });
const assign = (user_id: string, capability: string) => ({ user_id, capability, organization_id: null, expires_at: null, revoked_at: null });
const stepUp = (user_id: string, factor: string) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const trustedDevice = (user_id: string) =>
  ({ id: `dev-${user_id}`, user_id, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });

const SUPER = 'u-super';                       // active SUPER_ADMIN, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';      // active SUPER_ADMIN, no step-up session
const SUPER_TOTP = 'u-super-totp';             // active SUPER_ADMIN, TOTP step-up (not phishing-resistant)
const SUPER_UNTRUSTED = 'u-super-untrusted';   // active SUPER_ADMIN, passkey step-up, untrusted device
const SUPER_DEACTIVATED = 'u-super-deact';     // DEACTIVATED SUPER_ADMIN row, valid passkey step-up, trusted device
/** The Closure-012 principal: VIEW_ONLY with DIRECT grants, valid passkey step-up, trusted device. */
const GRANTEE = 'u-grantee';
/** An ordinary tenant administrator with no grants (valid passkey step-up, trusted device). */
const TENANT_ADMIN = 'u-tenant-admin';

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockReads.length = 0;
  mockSecurityAudit.length = 0;
  mockRateLimited = false;
  for (const f of Object.values(fx)) f.mockClear();
  mockTables.user_company_roles = [
    role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_TOTP, P, 'SUPER_ADMIN'),
    role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'), role(SUPER_DEACTIVATED, P, 'SUPER_ADMIN', 'deactivated'),
    role(GRANTEE, A, 'VIEW_ONLY'), role(TENANT_ADMIN, A, 'COMPANY_ADMIN'),
  ];
  mockTables.capability_assignments = [assign(GRANTEE, SUPER_ADMIN_DASHBOARD_VIEW), assign(GRANTEE, INTEGRATION_PLATFORM_OAUTH_MANAGE)];
  mockTables.stepup_sessions = [
    stepUp(SUPER, 'webauthn'), stepUp(SUPER_TOTP, 'totp'), stepUp(SUPER_UNTRUSTED, 'webauthn'),
    stepUp(SUPER_DEACTIVATED, 'webauthn'), stepUp(GRANTEE, 'webauthn'), stepUp(TENANT_ADMIN, 'webauthn'),
  ];
  mockTables.trusted_devices = [
    trustedDevice(SUPER), trustedDevice(SUPER_NO_STEPUP), trustedDevice(SUPER_TOTP),
    trustedDevice(SUPER_DEACTIVATED), trustedDevice(GRANTEE), trustedDevice(TENANT_ADMIN),
  ];
  mockTables.users = [];
  mockTables.platform_oauth_configs = [];
  mockTables.api_provider_accounts = [{ id: 'acc-1', api_source_id: 'src-1', account_name: 'Primary' }];
  mockTables.curated_industry_sources = [{ id: 'cs-1', source_name: 'Existing' }];
  mockTables.scheduled_posts = [{ id: 'sp-1', creator_attachment_metadata: null }];
});

type Res = { statusCode: number; body: unknown; headers: Record<string, unknown> } & Record<string, unknown>;
function fakeRes(): Res {
  const r = { statusCode: 200, body: undefined, headers: {} } as Res;
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
}
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
interface Surface {
  name: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  handler: Handler;
  query?: Record<string, unknown>;
  body: Record<string, unknown>;
  /** The protected effect(s) an authorized call reaches and a denied one must not. */
  effects: jest.Mock[];
  /** DB writes an authorized call makes (table:op). */
  writes?: string[];
  /** A business read a denied call must never reach. */
  guardedRead?: string;
  /** The route rate-limits before authorization. */
  rateLimited?: boolean;
  /** An input the route rejects with its established validation response. */
  invalid: { body?: Record<string, unknown>; query?: Record<string, unknown>; status: number; error: string; arrange?: () => void };
}
const SMOKE_BODY = { scheduledPostId: 'sp-1', socialAccountId: 'sa-1', sourceUrl: 'https://media.example.test/a.jpg', mimeType: 'image/jpeg' };
const CURATED_BODY = { source_name: 'Industry Weekly', source_type: 'newsletter', source_identifier: 'industry-weekly', integration_mode: 'public' };
const SURFACES: Surface[] = [
  {
    name: 'POST platform-oauth-configs', method: 'POST', handler: oauthConfigsRoute as Handler,
    body: { platform: 'linkedin', client_id: 'synthetic-client', client_secret: 'synthetic-secret' },
    effects: [fx.encryptCredential], writes: ['platform_oauth_configs:upsert'],
    invalid: { body: { platform: 'not-a-platform', client_id: 'x' }, status: 400, error: 'Invalid platform' },
  },
  {
    name: 'DELETE platform-oauth-configs', method: 'DELETE', handler: oauthConfigsRoute as Handler,
    query: { platform: 'linkedin' }, body: {},
    effects: [], writes: ['platform_oauth_configs:delete'],
    invalid: { query: {}, status: 400, error: 'platform required' },
  },
  {
    name: 'POST analytics-provider-config', method: 'POST', handler: analyticsConfigRoute as Handler,
    body: { enabled: true, oauth_client_id: 'synthetic-client', oauth_client_secret: 'synthetic-secret' },
    effects: [fx.upsertAnalyticsProviderConfig],
    invalid: {
      body: { enabled: true, redirect_uri: 'javascript:alert(1)' }, status: 400, error: 'Invalid redirect_uri',
      arrange: () => { fx.upsertAnalyticsProviderConfig.mockImplementationOnce(async () => { throw new Error('Invalid redirect_uri'); }); },
    },
  },
  {
    // The application-level PageSpeed key every tenant report uses: same gate as the GA/GSC client.
    name: 'POST pagespeed-config', method: 'POST', handler: pageSpeedConfigRoute as Handler,
    body: { enabled: true, api_key: 'synthetic-placeholder-pagespeed-key-0000' },
    effects: [fx.savePageSpeedConfig], rateLimited: true,
    invalid: {
      body: { enabled: true, api_key: 'short' }, status: 400, error: 'That does not look like a Google API key.',
      arrange: () => { fx.savePageSpeedConfig.mockImplementationOnce(async () => { throw new Error('That does not look like a Google API key.'); }); },
    },
  },
  {
    name: 'POST provider-accounts', method: 'POST', handler: providerAccountsRoute as Handler,
    body: { api_source_id: 'src-1', account_name: 'Backup', credentials: { api_key_env_name: 'SYNTHETIC_API_KEY' } },
    effects: [fx.buildCredentialEnvelope, fx.createProviderAccount],
    invalid: { body: { account_name: 'Backup', credentials: {} }, status: 400, error: 'api_source_id required' },
  },
  {
    name: 'PUT provider-accounts/[id]', method: 'PUT', handler: providerAccountRoute as Handler,
    query: { id: 'acc-1' }, body: { account_name: 'Renamed' },
    effects: [fx.updateProviderAccount], guardedRead: 'api_provider_accounts',
    invalid: { body: { credentials: { api_key_env_name: 'not an env var name!' } }, status: 400, error: 'INVALID_ENV_VAR_NAME' },
  },
  {
    name: 'DELETE provider-accounts/[id]', method: 'DELETE', handler: providerAccountRoute as Handler,
    query: { id: 'acc-1' }, body: {},
    effects: [fx.deactivateProviderAccount], guardedRead: 'api_provider_accounts',
    invalid: { query: { id: 'acc-missing' }, status: 404, error: 'Account not found' },
  },
  {
    name: 'POST curated-industry-sources', method: 'POST', handler: curatedSourcesRoute as Handler,
    body: CURATED_BODY, effects: [], writes: ['curated_industry_sources:upsert'], rateLimited: true,
    invalid: { body: { source_name: 'No type' }, status: 400, error: 'source_name, source_type, and source_identifier are required' },
  },
  {
    name: 'PATCH curated-industry-sources', method: 'PATCH', handler: curatedSourcesRoute as Handler,
    body: { id: 'cs-1', ...CURATED_BODY }, effects: [], writes: ['curated_industry_sources:update'], rateLimited: true,
    invalid: { body: { id: 'cs-1', ...CURATED_BODY, integration_mode: 'scrape-everything' }, status: 400, error: 'Invalid integration_mode' },
  },
  {
    name: 'DELETE curated-industry-sources', method: 'DELETE', handler: curatedSourcesRoute as Handler,
    query: { id: 'cs-1' }, body: {}, effects: [], writes: ['curated_industry_sources:delete'], rateLimited: true,
    invalid: { query: {}, status: 400, error: 'id required' },
  },
  {
    name: 'POST linkedin-media-smoke-test', method: 'POST', handler: linkedinSmokeRoute as Handler,
    body: SMOKE_BODY, effects: [fx.getSocialAccount, fx.getToken, fx.getOrUploadLinkedInAsset], rateLimited: true,
    invalid: { body: { ...SMOKE_BODY, scheduledPostId: '' }, status: 400, error: 'scheduledPostId required (existing row id for URN cache write)' },
  },
];
const RATE_LIMITED = SURFACES.filter((s) => s.rateLimited);
/** The tables these routes read or write as business data (the identity chain's own reads are not listed). */
const BUSINESS_TABLES = new Set(['platform_oauth_configs', 'api_provider_accounts', 'curated_industry_sources', 'scheduled_posts', 'social_accounts', 'analytics_provider_configs']);

async function call(s: Surface, who: { user?: string; bridge?: 'plain' | 'all-caps' } | null, over?: { body?: Record<string, unknown>; query?: Record<string, unknown> }) {
  const headers: Record<string, string> = {};
  if (who?.user) headers['x-test-user'] = who.user;
  if (who?.bridge) headers['x-test-bridge'] = who.bridge;
  const req = {
    headers, method: s.method, url: `/api/${s.name}`, socket: {}, cookies: {},
    query: { ...(over?.query ?? s.query ?? {}) }, body: { ...(over?.body ?? s.body) },
  };
  const res = fakeRes();
  await s.handler(req, res);
  return res;
}
const code = (r: Res) => (r.body as { code?: string } | undefined)?.code;
const businessReads = () => mockReads.filter((t) => BUSINESS_TABLES.has(t));
/** Zero business effects: no service or provider call, no business DB read or write, no business audit. */
function expectNothingHappened(s: Surface) {
  for (const e of s.effects) expect(e).not.toHaveBeenCalled();
  expect(fx.insertAuditLogStrict).not.toHaveBeenCalled();
  expect(fx.encryptCredential).not.toHaveBeenCalled();
  expect(mockWrites).toEqual([]);
  expect(businessReads()).toEqual([]);
}
const each = (list: Surface[]) => list.map((s) => [s.name, s] as const);

describe('the Closure-012 principal: VIEW_ONLY + DIRECT grants + valid passkey step-up on a trusted device', () => {
  it.each(each(SURFACES))('%s → 403 PLATFORM_SUPER_ADMIN_REQUIRED, nothing happens', async (_n, s) => {
    const r = await call(s, { user: GRANTEE });
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expectNothingHappened(s);
  });
  it.each(each(SURFACES))('%s → the refusal is audited as elevated_route_denied for the grantee', async (_n, s) => {
    await call(s, { user: GRANTEE });
    const denial = mockSecurityAudit.filter((e) => e.decision === 'elevated_route_denied');
    expect(denial).toHaveLength(1);
    expect(denial[0]).toMatchObject({ capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, actorUserId: GRANTEE, actorSessionId: `sess-${GRANTEE}` });
    expect(String(denial[0].reason)).toContain('PLATFORM_SUPER_ADMIN_REQUIRED');
  });
  it.each(each(SURFACES))('%s → the refused write leaves NO allowed / elevated_route_accessed row for the write capability', async (_n, s) => {
    await call(s, { user: GRANTEE });
    expect(mockSecurityAudit.filter((e) => e.capability === INTEGRATION_PLATFORM_OAUTH_MANAGE
      && (e.decision === 'allowed' || e.decision === 'elevated_route_accessed'))).toEqual([]);
  });
});

describe('an ordinary tenant administrator (no grants, valid passkey step-up, trusted device)', () => {
  it.each(each(SURFACES))('%s → denied, nothing happens', async (_n, s) => {
    const r = await call(s, { user: TENANT_ADMIN });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
});

describe('no authenticated principal', () => {
  it.each(each(SURFACES))('%s → 401, nothing happens', async (_n, s) => {
    const r = await call(s, null);
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
});

describe('legacy bridge principals', () => {
  it.each(each(SURFACES))('%s → a plain bridge principal is refused, nothing happens', async (_n, s) => {
    const r = await call(s, { bridge: 'plain' });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
  it.each(each(SURFACES))('%s → a bridge principal claiming every capability, a SUPER_ADMIN row and a step-up is refused, nothing happens', async (_n, s) => {
    const r = await call(s, { bridge: 'all-caps' });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
});

describe('a deactivated platform SUPER_ADMIN (valid passkey step-up, trusted device)', () => {
  it.each(each(SURFACES))('%s → denied, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_DEACTIVATED });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
});

describe('step-up is still required of an active SUPER_ADMIN', () => {
  it.each(each(SURFACES))('%s → no step-up → 401 STEP_UP_REQUIRED, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_NO_STEPUP });
    expect(r.statusCode).toBe(401);
    expect(code(r)).toBe('STEP_UP_REQUIRED');
    expectNothingHappened(s);
  });
  it.each(each(SURFACES))('%s → a TOTP (non-phishing-resistant) step-up → 401, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_TOTP });
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
  it.each(each(SURFACES))('%s → a passkey step-up on an UNTRUSTED device → 401, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_UNTRUSTED });
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
});

describe('rate limiting (the platform-wide controls)', () => {
  it.each(each(RATE_LIMITED))('%s → over the limit: 429 even for an authorized SUPER_ADMIN, nothing happens', async (_n, s) => {
    mockRateLimited = true;
    const r = await call(s, { user: SUPER });
    expect(r.statusCode).toBe(429);
    expectNothingHappened(s);
  });
});

describe('an active, stepped-up platform SUPER_ADMIN is not locked out', () => {
  it.each(each(SURFACES))('%s → authorized; the route reaches its effect', async (_n, s) => {
    const r = await call(s, { user: SUPER });
    expect([401, 403, 429]).not.toContain(r.statusCode);
    expect(r.statusCode).toBeLessThan(300);
    for (const e of s.effects) expect(e).toHaveBeenCalled();
    for (const w of s.writes ?? []) expect(mockWrites.map((x) => `${x.table}:${x.op}`)).toContain(w);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_denied')).toBe(false);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed' && e.actorUserId === SUPER)).toBe(true);
  });
  it.each(each(SURFACES))('%s → authorized but invalid input keeps its established validation response', async (_n, s) => {
    s.invalid.arrange?.();
    const r = await call(s, { user: SUPER }, { body: s.invalid.body, query: s.invalid.query });
    expect(r.statusCode).toBe(s.invalid.status);
    expect((r.body as { error?: string }).error).toBe(s.invalid.error);
  });
  it('linkedin smoke test: the business audit names the authenticated operator', async () => {
    await call(SURFACES.find((s) => s.name === 'POST linkedin-media-smoke-test')!, { user: SUPER });
    expect(fx.insertAuditLogStrict).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: SUPER, action: 'SUPER_ADMIN_LINKEDIN_SMOKE_TEST' }));
  });
});

describe('reads are unchanged', () => {
  it('GET platform-oauth-configs: an active SUPER_ADMIN still lists configurations without step-up', async () => {
    const res = fakeRes();
    await (oauthConfigsRoute as Handler)({ headers: { 'x-test-user': SUPER_NO_STEPUP }, method: 'GET', url: '/x', socket: {}, cookies: {}, query: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_denied')).toBe(false);
  });
  it('GET curated-industry-sources: the dashboard-view read is not given a write-authority check', async () => {
    const res = fakeRes();
    await (curatedSourcesRoute as Handler)({ headers: { 'x-test-user': GRANTEE }, method: 'GET', url: '/x', socket: {}, cookies: {}, query: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_denied')).toBe(false);
  });
});

describe('enforcePlatformWriteAuthority', () => {
  const req = { headers: { 'user-agent': 'jest' }, socket: {} } as never;
  const active = { userId: SUPER, organizations: [{ organizationId: P, role: 'SUPER_ADMIN', status: 'active' }], legacyCookieSuperAdmin: false } as never;
  it('allows an active canonical SUPER_ADMIN without writing a response or an audit row', async () => {
    const res = fakeRes();
    await expect(enforcePlatformWriteAuthority(req, res as never, active, INTEGRATION_PLATFORM_OAUTH_MANAGE, 'op')).resolves.toBe(true);
    expect(res.body).toBeUndefined();
    expect(mockSecurityAudit).toEqual([]);
  });
  it.each([
    ['a VIEW_ONLY membership', { userId: GRANTEE, organizations: [{ organizationId: A, role: 'VIEW_ONLY', status: 'active' }], legacyCookieSuperAdmin: false }],
    ['a deactivated SUPER_ADMIN membership', { userId: SUPER_DEACTIVATED, organizations: [{ organizationId: P, role: 'SUPER_ADMIN', status: 'deactivated' }], legacyCookieSuperAdmin: false }],
    ['a bridge principal with a SUPER_ADMIN membership', { userId: 'legacy:cookie-super-admin', organizations: [{ organizationId: P, role: 'SUPER_ADMIN', status: 'active' }], legacyCookieSuperAdmin: true }],
  ])('refuses %s: 403, one elevated_route_denied row naming the operation', async (_n, actor) => {
    const res = fakeRes();
    await expect(enforcePlatformWriteAuthority(req, res as never, actor as never, INTEGRATION_PLATFORM_OAUTH_MANAGE, 'some.op')).resolves.toBe(false);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expect(mockSecurityAudit).toHaveLength(1);
    expect(mockSecurityAudit[0]).toMatchObject({ decision: 'elevated_route_denied', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, userAgent: 'jest' });
    expect(String(mockSecurityAudit[0].reason)).toBe('some.op | PLATFORM_SUPER_ADMIN_REQUIRED');
  });
});
