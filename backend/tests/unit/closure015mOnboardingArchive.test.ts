/**
 * Closure-015M — R-14 (onboarding activation of invited memberships) and R-15 (archive status).
 *
 *   R-14  POST /api/onboarding/setup-company activated ANY 'invited' membership of the caller by row
 *         id — no invitation, expiry, revocation or single-use check, and no role check, so an
 *         invited SUPER_ADMIN row became ACTIVE platform authority. Both branches (public-email
 *         Path A, work-email domain branch) now go through acceptInvitationViaOnboarding: an
 *         invitation role only (never SUPER_ADMIN), a pending unexpired invitation for this
 *         company + verified email, the INVITATION's role, claimed single-use and conditionally.
 *         team/accept-invite gets the same explicit role check.
 *   R-15  archive-abandoned wrote companies.status = 'archived', which companies_status_check
 *         (active | inactive | suspended) refuses — every archive failed (verified on a throwaway
 *         Postgres). Archive is now the established reversible disable (status 'inactive' via
 *         disable_company_cascade), refused while an active SUPER_ADMIN membership exists.
 *
 * REAL: setup-company, team/accept-invite, archive-abandoned, acceptInvitationViaOnboarding,
 * orgOwnershipRecoveryService, insertAuditLogStrict, requireCapability chain — over the
 * routeAuthHarness tables. FAKED (I/O only): auth identity, rate limits, signup telemetry, website
 * validation, company matching, credit grants, crawl / profile bootstrap, security-audit sink, the
 * disable RPC (modelled as the deployed baseline function). In-memory: not Postgres.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { seed, rows, calls, invoke } from '../helpers/routeAuthHarness';

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
jest.mock('../../services/validatedWebsiteService', () => ({
  deriveWebsiteFromEmail: () => '',
  resolveValidatedWebsite: async () => ({ canonicalWebsite: '' }),
}));
jest.mock('../../services/companyMatchService', () => ({
  ...jest.requireActual('../../services/companyMatchService'),
  findMatchingCompany: jest.fn(async () => null),
}));
jest.mock('../../services/initialFreeCreditService', () => ({ grantInitialFreeCredit: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/earnCreditsService', () => ({ grantEarnCredit: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/companyProfile/refinementHelpers', () => ({ crawlWebsiteSources: jest.fn(async () => ({})), mergeDiscoveredSocialProfiles: jest.fn(() => ({})) }));
jest.mock('../../services/companyMembershipIntegrityService', () => ({ SELF_REGISTERED_JOIN_SOURCE: 'self_registered', selectCompatibleCompanyRole: jest.fn(() => null) }));
jest.mock('../../services/claimedDomainNotifyService', () => ({ notifyAdminAndProspectOfClaimedDomain: jest.fn(async () => undefined) }));
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
import teamAcceptInviteRoute from '../../../pages/api/team/accept-invite';
import archiveRoute from '../../../pages/api/super-admin/companies/archive-abandoned';
import { acceptInvitationViaOnboarding } from '../../services/onboardingInvitationAcceptance';
import bootstrapRoute from '../../../pages/api/admin/bootstrap-super-admin';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CO = '15151515-0000-4000-8000-0000000000c1';   // invited-into company
const CO_W = '15151515-0000-4000-8000-0000000000c2'; // work-email domain company (acme.test)
const OTHER = '15151515-0000-4000-8000-0000000000c3';
const P = '44444444-4444-4444-8444-444444444444';
const U = 'u-invitee';
const EMAIL = 'invitee@gmail.com';     // public-email → Path A
const WORK = 'invitee@acme.test';      // work email → domain branch
const PSA = 'u-psa';
const CADMIN = 'u-cadmin';
const FUTURE = (ms = 7 * 86400_000) => new Date(Date.now() + ms).toISOString();
const PAST = () => new Date(Date.now() - 60_000).toISOString();
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const inv = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', email: EMAIL, company_id: CO, role: 'CONTENT_CREATOR', token_hash: 'h1',
  accepted_at: null, revoked_at: null, expires_at: FUTURE(), ...over,
});
function world(member: Record<string, unknown> = {}, invitations: Record<string, unknown>[] = [inv()]) {
  seed({
    companies: [
      { id: CO, name: 'Invited Co', status: 'active' },
      { id: CO_W, name: 'Acme', status: 'active', admin_email_domain: 'acme.test' },
      { id: OTHER, name: 'Other', status: 'active' },
      { id: P, name: 'Platform', status: 'active' },
    ],
    users: [{ id: U, email: EMAIL, name: 'Invitee', industry: null, status: 'invited', active_company_id: null }],
    user_company_roles: [
      { id: 'r-inv', user_id: U, company_id: CO, role: 'CONTENT_CREATOR', status: 'invited', ...member },
      { id: 'r-psa', user_id: PSA, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-cadmin', user_id: CADMIN, company_id: OTHER, role: 'COMPANY_ADMIN', status: 'active' },
    ],
    invitations,
    stepup_sessions: [{ id: 'su-psa', user_id: PSA, auth_session_id: `sess-${PSA}`, factor: 'webauthn', expires_at: FUTURE(300_000), consumed_at: null, revoked_at: null }],
    trusted_devices: [{ id: 'dev-psa', user_id: PSA, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(300_000), revoked_at: null }],
    audit_logs: [],
    api_idempotency_keys: [],
  });
}
const setup = (body: Record<string, unknown> = {}, email = EMAIL) =>
  invoke(setupCompanyRoute as never, { method: 'POST', body: { companyName: 'Whatever', ...body }, headers: { 'x-test-user': U, 'x-test-email': email } });
const row = (id = 'r-inv') => rows('user_company_roles').find((r) => r.id === id);
const invRow = (id = 'inv-1') => rows('invitations').find((i) => i.id === id);
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && ['update', 'insert', 'delete'].includes(c.op));

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockFail.clear();
  mockBeforeWrite.fn = null;
  mockRpc.fn = null;
  mockCascadeDisable.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('R-14 — onboarding never activates platform authority; ordinary invitations still work', () => {
  it('THE BYPASS CLOSED: an invited SUPER_ADMIN row (even with a valid invitation) → 403; stays invited; no membership/account write; audited', async () => {
    world({ role: 'SUPER_ADMIN' });
    const r = await setup();
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT' });
    expect(row()).toMatchObject({ role: 'SUPER_ADMIN', status: 'invited' });
    expect(membershipWrites()).toHaveLength(0);
    expect(calls().filter((c) => c.table === 'users' && c.op === 'update')).toHaveLength(0);
    expect(invRow()).toMatchObject({ accepted_at: null });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED', actor_user_id: U }));
  });

  it.each(['super_admin', ' Super_Admin ', 'FINANCE_ADMIN', 'CONTENT_ARCHITECT'])('a non-invitation role (%j) is refused the same way', async (role) => {
    world({ role });
    expect((await setup()).status).toBe(403);
    expect(row()).toMatchObject({ status: 'invited' });
  });

  it('ordinary invitation: activated with the INVITATION role, invitation consumed, same audit as the token flow', async () => {
    world();
    const r = await setup();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ companyId: CO });
    expect(row()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
    expect(invRow()).toMatchObject({ accepted_by: U });
    expect(invRow()!.accepted_at).toBeTruthy();
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'INVITATION_ACCEPTED', actor_user_id: U, metadata: expect.objectContaining({ via: 'onboarding', invitation_id: 'inv-1', role: 'CONTENT_CREATOR' }) }));
  });

  it('FORGED payload: role / companyId / status in the body are ignored; the stored row role is not trusted either — the invitation role wins', async () => {
    world({ role: 'COMPANY_ADMIN' }, [inv({ role: 'VIEW_ONLY' })]);
    const r = await setup({ role: 'SUPER_ADMIN', companyId: OTHER, status: 'active' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ companyId: CO });
    expect(row()).toMatchObject({ role: 'VIEW_ONLY', status: 'active' });
    expect(rows('user_company_roles').filter((m) => m.user_id === U && m.company_id === OTHER)).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>[], number, string]>([
    ['no invitation at all', [], 409, 'INVITATION_REQUIRED'],
    ['a REVOKED invitation', [inv({ revoked_at: PAST() })], 409, 'INVITATION_REQUIRED'],
    ['an already ACCEPTED invitation', [inv({ accepted_at: PAST() })], 409, 'INVITATION_REQUIRED'],
    ['an EXPIRED invitation', [inv({ expires_at: PAST() })], 410, 'INVITATION_EXPIRED'],
    ['an invitation for ANOTHER company (tenant isolation)', [inv({ company_id: OTHER })], 409, 'INVITATION_REQUIRED'],
    ['an invitation for ANOTHER email', [inv({ email: 'someone.else@gmail.com' })], 409, 'INVITATION_REQUIRED'],
  ])('%s → %i %s; membership stays invited; no write', async (_d, invitations, status, error) => {
    world({}, invitations);
    const r = await setup();
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error });
    expect(row()).toMatchObject({ status: 'invited' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('REPLAY: a second onboarding call after acceptance activates nothing more', async () => {
    world();
    expect((await setup()).status).toBe(200);
    const writesAfterFirst = membershipWrites().length;
    const r2 = await setup();
    expect(r2.status).not.toBe(500);
    expect(membershipWrites().length).toBe(writesAfterFirst);
    expect(rows('audit_logs').filter((a) => a.action === 'INVITATION_ACCEPTED')).toHaveLength(1);
  });

  it('CONCURRENT acceptance (two requests): exactly one wins the invitation claim; the other is 409; one audit row', async () => {
    world();
    const [a, b] = await Promise.all([setup(), setup()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(row()).toMatchObject({ status: 'active' });
    expect(rows('audit_logs').filter((x) => x.action === 'INVITATION_ACCEPTED')).toHaveLength(1);
  });

  it('race: the invitation is claimed elsewhere between the read and the claim → 409 INVITATION_ALREADY_USED; nothing activated', async () => {
    world();
    mockBeforeWrite.fn = (table, op) => { if (table === 'invitations' && op === 'update' && invRow()!.accepted_at === null) invRow()!.accepted_at = PAST(); };
    const r = await setup();
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'INVITATION_ALREADY_USED' });
    expect(row()).toMatchObject({ status: 'invited' });
  });

  it('race: the membership row changes (e.g. promoted to SUPER_ADMIN) before activation → 409 STALE_MEMBERSHIP; claim released; nothing activated', async () => {
    world();
    let n = 0;
    mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update' && ++n === 1) row()!.role = 'SUPER_ADMIN'; };
    const r = await setup();
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(row()).toMatchObject({ role: 'SUPER_ADMIN', status: 'invited' });
    expect(invRow()).toMatchObject({ accepted_at: null, accepted_by: null });
  });

  it('race: the membership is DEACTIVATED (status inactive) before activation → 409 STALE_MEMBERSHIP; it stays inactive; claim released', async () => {
    world();
    let n = 0;
    mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update' && ++n === 1) row()!.status = 'inactive'; };
    const r = await setup();
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(row()).toMatchObject({ status: 'inactive', role: 'CONTENT_CREATOR' });
    expect(invRow()).toMatchObject({ accepted_at: null, accepted_by: null });
  });

  it('failures: invitation lookup error → 503; invitation claim error → 500; no membership activated', async () => {
    world();
    mockFail.add('invitations:select:id, email, company_id, role, accepted_at, revoked_at, expires_at');
    expect((await setup()).status).toBe(503);
    mockFail.clear();
    world();
    mockFail.add('invitations:update');
    expect((await setup()).status).toBe(500);
    expect(row()).toMatchObject({ status: 'invited' });
  });

  it('WORK-EMAIL domain branch: the same governed acceptance (SUPER_ADMIN refused; ordinary accepted)', async () => {
    world({ company_id: CO_W, role: 'SUPER_ADMIN' }, [inv({ company_id: CO_W, email: WORK })]);
    const r1 = await setup({}, WORK);
    expect(r1.status).toBe(403);
    expect(row()).toMatchObject({ role: 'SUPER_ADMIN', status: 'invited' });

    world({ company_id: CO_W }, [inv({ company_id: CO_W, email: WORK })]);
    const r2 = await setup({}, WORK);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ companyId: CO_W });
    expect(row()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
  });

  it('source: no onboarding path flips an invited membership to active by id any more', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pages/api/onboarding/setup-company.ts'), 'utf8');
    expect(src).not.toMatch(/\.update\(\{\s*status:\s*'active',\s*accepted_at:\s*now,\s*updated_at:\s*now\s*\}\)/);
    expect(src.split('acceptInvitationViaOnboarding(').length - 1).toBe(2);
  });
});

describe('R-14 — the token acceptance flow refuses a non-invitation role explicitly (defence in depth)', () => {
  const token = 'tok-0123456789abcdef';
  const hash = createHash('sha256').update(token).digest('hex');
  const accept = () => invoke(teamAcceptInviteRoute as never, { method: 'POST', body: { token }, headers: { 'x-test-user': U, 'x-test-email': EMAIL } });

  it('an invitation row carrying SUPER_ADMIN (only possible if the DB CHECK is missing) → 403 before the claim', async () => {
    world({}, [inv({ token_hash: hash, role: 'SUPER_ADMIN' })]);
    const r = await accept();
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT' });
    expect(invRow()).toMatchObject({ accepted_at: null });
    expect(row()).toMatchObject({ status: 'invited' });
  });

  it('an ordinary invitation is still accepted by the token flow', async () => {
    world({}, [inv({ token_hash: hash })]);
    rows('users')[0].supabase_uid = `sb-${U}`;
    const r = await accept();
    expect(r.status).toBe(200);
    expect(row()).toMatchObject({ status: 'active', role: 'CONTENT_CREATOR' });
  });
});

describe('R-14 — acceptInvitationViaOnboarding (unit)', () => {
  it('a membership that is not invited (active / inactive / expired) is never (re)activated here', async () => {
    for (const status of ['active', 'inactive', 'expired']) {
      world({ status });
      const r = await acceptInvitationViaOnboarding({ userId: U, email: EMAIL, membership: { id: 'r-inv', company_id: CO, role: 'CONTENT_CREATOR', status } });
      expect(r).toMatchObject({ ok: false, status: 403 });
      expect(membershipWrites()).toHaveLength(0);
    }
  });

  it('an INVITATION carrying SUPER_ADMIN (possible only if the DB CHECK is missing) is refused even for an ordinary invited row; nothing claimed', async () => {
    world({}, [inv({ role: 'SUPER_ADMIN' })]);
    const r = await acceptInvitationViaOnboarding({ userId: U, email: EMAIL, membership: { id: 'r-inv', company_id: CO, role: 'CONTENT_CREATOR', status: 'invited' } });
    expect(r).toEqual({ ok: false, status: 403, error: 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT' });
    expect(invRow()).toMatchObject({ accepted_at: null });
    expect(row()).toMatchObject({ status: 'invited', role: 'CONTENT_CREATOR' });
  });

  it('the newest unexpired invitation decides when several are pending', async () => {
    world({}, [inv({ id: 'inv-old', role: 'VIEW_ONLY', expires_at: FUTURE(86400_000) }), inv({ id: 'inv-new', role: 'CONTENT_REVIEWER', expires_at: FUTURE(5 * 86400_000) })]);
    const r = await acceptInvitationViaOnboarding({ userId: U, email: EMAIL.toUpperCase(), membership: { id: 'r-inv', company_id: CO, role: 'CONTENT_CREATOR', status: 'invited' } });
    expect(r).toMatchObject({ ok: true, role: 'CONTENT_REVIEWER', invitationId: 'inv-new' });
    expect(invRow('inv-old')).toMatchObject({ accepted_at: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-15 — archive-abandoned uses the established disable state (status inactive)', () => {
  const archive = (who: string, body: Record<string, unknown>) =>
    invoke(archiveRoute as never, { method: 'POST', body: { reason: 'abandoned', ...body }, headers: { 'x-test-user': who, 'idempotency-key': `k-${Math.random()}` } });
  const company = (id: string) => rows('companies').find((c) => c.id === id);
  const abandoned = () => { world(); rows('user_company_roles').splice(0, rows('user_company_roles').length, ...rows('user_company_roles').filter((m) => m.company_id !== CO)); };

  it('success: an abandoned org becomes status inactive through the disable cascade; previousStatus reported', async () => {
    abandoned();
    const r = await archive(PSA, { orgId: CO });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, previousStatus: 'active', idempotent: false });
    expect(company(CO)).toMatchObject({ status: 'inactive' });
    expect(mockCascadeDisable).toHaveBeenCalledWith(CO, PSA, expect.stringContaining('archive_abandoned:'));
    expect(calls().filter((c) => c.table === 'companies' && c.op === 'update' && (c.payload as { status?: string })?.status === 'archived')).toHaveLength(0);
  });

  it('repeat archive is idempotent (already inactive): 200 idempotent, no second cascade', async () => {
    abandoned();
    company(CO)!.status = 'inactive';
    const r = await archive(PSA, { orgId: CO });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ idempotent: true, previousStatus: 'inactive' });
    expect(mockCascadeDisable).not.toHaveBeenCalled();
  });

  it('unauthorized: a company admin → 403; nothing changed', async () => {
    abandoned();
    expect((await archive(CADMIN, { orgId: CO })).status).toBe(403);
    expect(company(CO)).toMatchObject({ status: 'active' });
    expect(mockCascadeDisable).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN protection is NOT weakened: an active SUPER_ADMIN membership refuses the archive (force too) → 409', async () => {
    world({ role: 'SUPER_ADMIN', status: 'active' });
    const r = await archive(PSA, { orgId: CO, force: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SUPER_ADMIN_MEMBERSHIP' });
    expect(row()).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(mockCascadeDisable).not.toHaveBeenCalled();
  });

  it('the database guard refusal (activated after the check) maps to 409; other RPC failures → 500 DB_ERROR; company unchanged', async () => {
    abandoned();
    mockCascadeDisable.mockImplementationOnce(async () => { throw new Error('DISABLE_COMPANY_CASCADE_RPC_FAILED:COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'); });
    expect((await archive(PSA, { orgId: CO })).status).toBe(409);
    mockCascadeDisable.mockImplementationOnce(async () => { throw new Error('DISABLE_COMPANY_CASCADE_RPC_FAILED:boom'); });
    const r = await archive(PSA, { orgId: CO });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'DB_ERROR' });
    expect(company(CO)).toMatchObject({ status: 'active' });
  });

  it('failure: the super-admin lookup fails → 500 DB_ERROR (fail closed); not abandoned → 409 NOT_ABANDONED', async () => {
    abandoned();
    mockFail.add('user_company_roles:select:role');
    expect((await archive(PSA, { orgId: CO })).body).toMatchObject({ code: 'DB_ERROR' });
    mockFail.clear();
    world();
    rows('user_company_roles').find((m) => m.id === 'r-inv')!.status = 'active';
    expect((await archive(PSA, { orgId: CO })).status).toBe(409);
  });

  it('RESTORE compatibility: an archived (inactive) org is re-enabled by the ordinary enable path, and archive never wrote a value outside companies_status_check', async () => {
    abandoned();
    await archive(PSA, { orgId: CO });
    expect(['active', 'inactive', 'suspended']).toContain(company(CO)!.status);
    const companies = require('../../../pages/api/super-admin/companies').default;
    const r = await invoke(companies as never, { method: 'PATCH', body: { companyId: CO, status: 'active', reason: 'restore' }, headers: { 'x-test-user': PSA, 'idempotency-key': 'k-restore' } });
    expect(r.status).toBe(200);
    expect(company(CO)).toMatchObject({ status: 'active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D — bootstrap-super-admin adopts the governed assign_super_admin function', () => {
  const promote = (who: string, body: Record<string, unknown> = {}) => invoke(bootstrapRoute as never, {
    method: 'POST', body: { mode: 'promote', targetUserId: U, organizationId: CO, ...body }, headers: { 'x-test-user': who, 'idempotency-key': `k-${Math.random()}` },
  });
  const directGrantWrites = () => calls().filter((c) => c.table === 'user_company_roles' && ['update', 'insert'].includes(c.op));

  it('function deployed: ONE rpc call with (user, company); no direct membership write; 201 with the row id', async () => {
    world();
    const seen: unknown[] = [];
    mockRpc.fn = (fn, args) => { seen.push({ fn, args }); return fn === 'assign_super_admin' ? { data: [{ role_row_id: 'r-inv', company_id: CO }], error: null } : { data: null, error: null }; };
    const r = await promote(PSA);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, roleRowId: 'r-inv', organizationId: CO });
    expect(seen).toEqual([{ fn: 'assign_super_admin', args: { p_user_id: U, p_company_id: CO } }]);
    expect(directGrantWrites()).toHaveLength(0);
  });

  it.each([['SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE', 'company_not_active'], ['SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING', 'company_missing']])(
    'the database refuses (%s) → 409 %s; NO fallback to the direct write', async (msg, reason) => {
      world();
      mockRpc.fn = () => ({ data: null, error: { code: 'P0001', message: msg } });
      const r = await promote(PSA);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: reason });
      expect(directGrantWrites()).toHaveLength(0);
      expect(row()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'invited' });
    },
  );

  it('any other function error → 500; NO fallback to the direct write', async () => {
    world();
    mockRpc.fn = () => ({ data: null, error: { code: '40P01', message: 'deadlock detected' } });
    expect((await promote(PSA)).status).toBe(500);
    expect(directGrantWrites()).toHaveLength(0);
  });

  it('function NOT deployed (current state, PGRST202) → the existing two-statement path still grants', async () => {
    world();
    mockRpc.fn = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await promote(PSA);
    expect(r.status).toBe(201);
    expect(row()).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('authorization is unchanged: a company admin cannot promote (403) and the function is never called', async () => {
    world();
    mockRpc.fn = jest.fn(() => ({ data: [{ role_row_id: 'x' }], error: null }));
    expect((await promote(CADMIN)).status).toBe(403);
    expect(mockRpc.fn).not.toHaveBeenCalled();
  });
});
