/**
 * e1 (2026-11-12, 05 breadth check) - setup-company disclosed matchedCompanyId, matchedCompanyName and
 * the admin's name (falling back to the admin's EMAIL local-part) on ANY match, including a name-only
 * or typed-website match, and emailed the matched company's admin on every such probe. Now the
 * disclosure and the admin notice follow the binding evidence: only a match proven by the user's
 * VERIFIED email domain names the company + admin display name (never id, never email) and notifies
 * the admin; a name / typed-website match answers only { companyExists: true, taken: true }.
 * Harness: closure015m's routeAuthHarness wiring (real setup-company over in-memory tables).
 */
import { seed, calls, invoke } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
const mockFail = new Set<string>();
const mockBeforeWrite: { fn: ((table: string, op: string) => void) | null } = { fn: null };
/** supabase.rpc model (null → harness default). */
const mockRpc: { fn: ((fn: string, args: unknown) => unknown) | null } = { fn: null };
function mockFailing(): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order', 'not', 'maybeSingle', 'single']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: 'forced failure' } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  failing.single = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  const origSelect = builder.select as (cols?: string, opts?: unknown) => Record<string, unknown>;
  builder.select = (cols?: string, opts?: unknown) => (mockFail.has(`${table}:select:${cols}`) ? mockFailing() : origSelect(cols, opts));
  for (const op of ['update', 'delete', 'insert'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockBeforeWrite.fn) mockBeforeWrite.fn(table, op);
      return mockFail.has(`${table}:${op}`) ? mockFailing() : orig(p);
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  const rpc = (fn: string, args?: unknown) => (mockRpc.fn ? Promise.resolve(mockRpc.fn(fn, args)) : fake.rpc(fn, args));
  const wrapped = { ...fake, rpc, from: (t: string) => mockWrap(fake.from(t), t) };
  return { supabase: wrapped, default: wrapped, getSupabase: () => wrapped, supabaseAdmin: wrapped };
});
jest.mock('../../db/writeOwner', () => {
  const base = require('../helpers/routeAuthHarness').writeOwnerModule();
  return { ownedDbTable: (t: string) => mockWrap(base.ownedDbTable(t), t) };
});
const ident = (req: { headers?: Record<string, unknown> }) => {
  const id = req?.headers?.['x-test-user'];
  const email = (req?.headers?.['x-test-email'] as string | undefined) ?? `${String(id)}@example.test`;
  return typeof id === 'string' && id ? { id, email } : null;
};
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const u = ident(req);
    return u ? { user: { id: u.id, email: u.email, emailVerified: true }, error: null } : { user: null, error: 'MISSING_AUTH' };
  },
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers?: Record<string, unknown> }) => {
    const u = ident(req);
    return u ? { user: { id: u.id, supabaseUid: `sb-${u.id}`, email: u.email, emailVerified: true }, error: null } : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const u = ident(req);
    if (!u) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${u.id}`, user_id: u.id, created_at: now, last_seen_at: now } };
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
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: jest.fn(async () => undefined),
  ensureSignupCorrelationId: jest.fn(async () => 'corr-test'),
  requestIp: () => '127.0.0.1',
  requestUserAgent: () => 'jest',
}));
let mockCanonical = '';
jest.mock('../../services/validatedWebsiteService', () => ({
  deriveWebsiteFromEmail: () => '',
  resolveValidatedWebsite: async () => ({ canonicalWebsite: mockCanonical }),
}));
let mockMatch: Record<string, unknown> | null = null;
jest.mock('../../services/companyMatchService', () => ({
  ...jest.requireActual('../../services/companyMatchService'),
  findMatchingCompany: jest.fn(async () => mockMatch),
}));
jest.mock('../../services/initialFreeCreditService', () => ({ grantInitialFreeCredit: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/earnCreditsService', () => ({ grantEarnCredit: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/companyProfile/refinementHelpers', () => ({ crawlWebsiteSources: jest.fn(async () => ({})), mergeDiscoveredSocialProfiles: jest.fn(() => ({})) }));
jest.mock('../../services/companyMembershipIntegrityService', () => ({ SELF_REGISTERED_JOIN_SOURCE: 'self_registered', selectCompatibleCompanyRole: jest.fn(() => null) }));
const mockNotified: unknown[] = [];
let mockAdminNotice = 'sent';
jest.mock('../../services/claimedDomainNotifyService', () => ({
  notifyAdminAndProspectOfClaimedDomain: jest.fn(async (_db: unknown, input: unknown) => { mockNotified.push(input); return { adminNotice: mockAdminNotice }; }),
}));
jest.mock('../../services/companyIdentityDriftService', () => ({ monitorCompanyIdentityDrift: jest.fn(async () => undefined) }));
jest.mock('../../services/companyIdentityWriter', () => ({ createCompanyIdentity: jest.fn(async () => ({ id: 'never' })) }));
jest.mock('../../services/domainRecordService', () => ({ saveDomainRecord: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/companyProfile/enrichmentProvenance', () => ({ buildDiscoveredProvenance: jest.fn(() => ({})) }));
jest.mock('../../services/companyBootstrapService', () => ({ bootstrapCompanyProfile: jest.fn(async () => ({})) }));
jest.mock('../../services/crawl/crawlEventService', () => ({ emitCrawlEvent: jest.fn(async () => undefined) }));
const mockCascadeDisable = jest.fn(async (companyId: string) => {
  const h = require('../helpers/routeAuthHarness');
  for (const c of h.rows('companies')) if (c.id === companyId) c.status = 'inactive';
  for (const m of h.rows('user_company_roles')) if (m.company_id === companyId && m.status === 'active') m.status = 'inactive';
  return { affectedUsers: 0, revokedRoles: 0, revokedSessions: 0 };
});
jest.mock('../../services/lifecycleGovernance', () => ({
  cascadeDisableCompany: (...a: unknown[]) => mockCascadeDisable(...(a as [string])),
  softDeleteCompanyWithCascade: jest.fn(),
  hardDeleteCompany: jest.fn(async () => ({ ok: false, code: 'FUNCTION_MISSING' })),
}));
import setupCompanyRoute from '../../../pages/api/onboarding/setup-company';

const CO_W = '15151515-0000-4000-8000-0000000000c2';   // acme.test
const OTHER = '15151515-0000-4000-8000-0000000000c3';  // other.test (website only)
const U = 'u-prospect';
const WORK = 'prospect@acme.test';
const ADMIN = 'u-admin';
function world(adminName: string | null = 'Ada Admin') {
  seed({
    companies: [
      { id: CO_W, name: 'Acme', status: 'active', admin_email_domain: 'acme.test' },
      { id: OTHER, name: 'Other Co', status: 'active', website_domain: 'other.test' },
    ],
    users: [
      { id: U, email: WORK, name: 'Prospect', industry: null, status: 'active', active_company_id: null },
      { id: ADMIN, email: 'ada@acme.test', name: adminName, status: 'active' },
    ],
    user_company_roles: [{ id: 'r-admin', user_id: ADMIN, company_id: CO_W, role: 'COMPANY_ADMIN', status: 'active' }],
    invitations: [],
    audit_logs: [],
    api_idempotency_keys: [],
  });
}
const setup = (body: Record<string, unknown> = {}) =>
  invoke(setupCompanyRoute as never, { method: 'POST', body: { companyName: 'Acme', ...body }, headers: { 'x-test-user': U, 'x-test-email': WORK } });
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && ['update', 'insert', 'delete'].includes(c.op));
const leaks = (body: unknown) => {
  const s = JSON.stringify(body);
  return ['Acme', CO_W, 'Ada', 'ada@', 'Other Co', OTHER].filter((x) => s.includes(x));
};

beforeEach(() => {
  mockSecurityAudit.length = 0; mockFail.clear(); mockBeforeWrite.fn = null; mockRpc.fn = null;
  mockNotified.length = 0; mockAdminNotice = 'sent'; mockMatch = null; mockCanonical = '';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('findMatchingCompany path', () => {
  for (const evidence of ['name', 'entered_website'] as const) {
    it(`a ${evidence} match discloses nothing about the company and notifies nobody`, async () => {
      world();
      mockMatch = { company_id: CO_W, company_name: 'Acme', match_type: evidence === 'name' ? 'name' : 'website_domain', evidence };
      const r = await setup();
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ companyExists: true, taken: true });
      expect(leaks(r.body)).toEqual([]);
      expect(mockNotified).toEqual([]);
      expect(membershipWrites()).toEqual([]);
    });
  }

  it('a VERIFIED email-domain match names the company + admin display name (never id/email) and notifies', async () => {
    world();
    mockMatch = { company_id: CO_W, company_name: 'Acme', match_type: 'admin_email_domain', evidence: 'verified_email_domain' };
    const r = await setup();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ companyExists: true, matchedCompanyName: 'Acme', adminName: 'Ada Admin', joinRequested: true });
    expect(mockNotified).toHaveLength(1);
    expect(membershipWrites()).toEqual([]);
  });

  it('verified match: joinRequested is false when the admin notice did not go out', async () => {
    world();
    mockAdminNotice = 'failed';
    mockMatch = { company_id: CO_W, company_name: 'Acme', match_type: 'admin_email_domain', evidence: 'verified_email_domain' };
    expect((await setup()).body.joinRequested).toBe(false);
  });

  it("an admin with no display name is null - never the email's local-part", async () => {
    world(null);
    mockMatch = { company_id: CO_W, company_name: 'Acme', match_type: 'admin_email_domain', evidence: 'verified_email_domain' };
    const r = await setup();
    expect(r.body.adminName).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain('ada');
  });
});

describe('domain-first lookup path (no findMatchingCompany match)', () => {
  it('the verified email domain matches: names the company and notifies', async () => {
    world();
    const r = await setup({ companyName: 'Brand New' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ companyExists: true, matchedCompanyName: 'Acme', adminName: 'Ada Admin', joinRequested: true });
    expect(r.body.matchedCompanyId).toBeUndefined();
    expect(mockNotified).toHaveLength(1);
  });

  it("only the TYPED website matches another company: 'taken', nothing disclosed, nobody notified", async () => {
    world();
    mockCanonical = 'https://other.test';
    const r = await setup({ companyName: 'Brand New', website: 'https://other.test' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ companyExists: true, taken: true });
    expect(leaks(r.body)).toEqual([]);
    expect(mockNotified).toEqual([]);
  });
});
