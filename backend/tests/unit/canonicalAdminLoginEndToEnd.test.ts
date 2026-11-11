/**
 * e9 (C) CRITICAL, 2026-11-11: with the bridge cookies gone, both env-credential
 * logins fail closed (503) unless they mint a CANONICAL session. This proves the
 * canonical path still works END TO END, so no Super Admin / Content Architect
 * is locked out:
 *
 *   login (real route) -> omnivyra_session cookie (real SessionAuthorityService)
 *   -> capability route (real IdentityResolver + CapabilityService + requireCapability)
 *   -> step-up write: refused without a step-up session, allowed with a passkey
 *      step-up on a trusted device (real StepUpAuthorizationService policy).
 *
 * Only the DATABASE is in-memory (local fixtures, no real accounts). Stubbed:
 * the Supabase-token resolver (no bearer is sent, so it answers NO_TOKEN - the
 * branch that hands over to the canonical session), the audit sink, and the
 * startup identity probe.
 */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const fingerprintsAsked: string[] = [];

function table(name: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let payload: Row | Row[] | null = null;
  let limitN: number | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;
  const rows = () => (db[name] = db[name] ?? []);
  const matching = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = (): { data: unknown; error: null } => {
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const added = list.map((p) => ({ id: p.id ?? `${name}-${rows().length + 1}`, ...p }));
      rows().push(...added);
      return { data: added, error: null };
    }
    if (op === 'update') { const m = matching(); m.forEach((r) => Object.assign(r, payload)); return { data: m, error: null }; }
    if (op === 'delete') { const m = matching(); db[name] = rows().filter((r) => !m.includes(r)); return { data: m, error: null }; }
    let m = matching();
    if (orderBy) { const { col, asc } = orderBy; m = [...m].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1)); }
    return { data: limitN === null ? m : m.slice(0, limitN), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { if (name === 'trusted_devices' && c === 'fingerprint') fingerprintsAsked.push(String(v)); filters.push((r) => r[c] === v); return b; };
  b.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; };
  b.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; };
  b.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; };
  b.gt = (c: string, v: unknown) => { filters.push((r) => String(r[c]) > String(v)); return b; };
  b.gte = (c: string, v: unknown) => { filters.push((r) => String(r[c]) >= String(v)); return b; };
  b.lt = (c: string, v: unknown) => { filters.push((r) => String(r[c]) < String(v)); return b; };
  b.or = () => b;
  b.filter = () => b;
  b.ilike = (c: string, pat: string) => { const needle = String(pat).replace(/%/g, '').toLowerCase(); filters.push((r) => String(r[c] ?? '').toLowerCase().includes(needle)); return b; };
  b.order = (col: string, o?: { ascending?: boolean }) => { orderBy = { col, asc: o?.ascending !== false }; return b; };
  b.limit = (n: number) => { limitN = n; return b; };
  b.insert = (p: Row | Row[]) => { op = 'insert'; payload = p; return b; };
  b.upsert = (p: Row | Row[]) => { op = 'upsert'; payload = p; return b; };
  b.update = (p: Row) => { op = 'update'; payload = p; return b; };
  b.delete = () => { op = 'delete'; return b; };
  b.single = async () => { const r = run(); const d = r.data as Row[]; return { data: d[0] ?? null, error: d[0] ? null : { message: 'no rows' } }; };
  b.maybeSingle = async () => { const r = run(); const d = r.data as Row[]; return { data: d[0] ?? null, error: null }; };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t), rpc: async () => ({ data: null, error: null }) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: null, error: 'NO_TOKEN' }),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
  logCookieSuperAdminUsage: jest.fn(async () => undefined),
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../security/startup/superAdminIdentityCheck', () => ({ checkSuperAdminIdentity: async () => ({ ok: true, primaryUserId: 'sa-user' }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import superAdminLogin from '../../../pages/api/super-admin/login';
import architectLogin from '../../../pages/api/super-admin/content-architect-login';
import plansList from '../../../pages/api/super-admin/plans/list';
import creditPackages from '../../../pages/api/super-admin/credit-packages/index';
import architectSearch from '../../../pages/api/content-architect/search';

type Res = { code: number; body: Record<string, unknown>; headers: Record<string, unknown> };
const UA = 'jest-e2e-admin-browser';
async function call(h: unknown, req: Row): Promise<Res> {
  const out: Res = { code: 0, body: {}, headers: {} };
  const r = {
    status: (c: number) => { out.code = c; return r; },
    json: (b: Record<string, unknown>) => { out.body = b; return r; },
    setHeader: (k: string, v: unknown) => { out.headers[k] = v; return r; },
    getHeader: (k: string) => out.headers[k],
    end: () => r,
  };
  const headers = { 'user-agent': UA, ...(req.headers as Row | undefined) };
  await (h as (q: unknown, s: unknown) => Promise<void>)(
    { query: {}, body: {}, cookies: {}, socket: { remoteAddress: '127.0.0.1' }, url: '/api/x', ...req, headers }, r);
  return out;
}
/** The browser half: keep the Set-Cookie values that are not cleared. */
function cookieJar(res: Res): string {
  const set = ([] as string[]).concat((res.headers['Set-Cookie'] as string[] | string | undefined) ?? []);
  return set.map((c) => c.split(';')[0]).filter((kv) => !kv.endsWith('=')).join('; ');
}

const SA = 'sa-user';
const CA = 'ca-user';
const ORG = '00000000-0000-4000-8000-00000000c0aa';

beforeAll(() => {
  process.env.SESSION_COOKIE_SECRET = process.env.SESSION_COOKIE_SECRET || 'e2e-session-secret-at-least-32-characters-long';
  process.env.SUPER_ADMIN_USERNAME = 'sa'; process.env.SUPER_ADMIN_PASSWORD = 'sa-pw';
  process.env.SUPER_ADMIN_PRIMARY_USER_ID = SA;
  process.env.CONTENT_ARCHITECT_USERNAME = 'ca'; process.env.CONTENT_ARCHITECT_PASSWORD = 'ca-pw';
  process.env.CONTENT_ARCHITECT_PRIMARY_USER_ID = CA;
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  fingerprintsAsked.length = 0;
  db.users = [
    { id: SA, supabase_uid: SA, email: 'sa@example.test', is_deleted: false, status: 'active' },
    { id: CA, supabase_uid: CA, email: 'ca@example.test', is_deleted: false, status: 'active' },
  ];
  db.user_company_roles = [
    { user_id: SA, company_id: ORG, role: 'SUPER_ADMIN', status: 'active' },
    { user_id: CA, company_id: ORG, role: 'CONTENT_ARCHITECT', status: 'active' },
  ];
  db.credit_packages = [];
  db.pricing_plans = [];
  db.plan_limits = [];
});

describe('Super Admin: canonical login -> capability read -> step-up write', () => {
  it('works end to end, and the step-up write is refused until a passkey step-up exists', async () => {
    const login = await call(superAdminLogin, { method: 'POST', body: { username: 'sa', password: 'sa-pw' } });
    expect(login.code).toBe(200);
    expect(login.body).toMatchObject({ success: true, canonicalSession: true, authMode: 'canonical' });
    const jar = cookieJar(login);
    expect(jar).toMatch(/^omnivyra_session=/);
    expect(jar).not.toMatch(/super_admin_session|content_architect_session/);
    expect(db.auth_sessions).toHaveLength(1);

    // capability READ (SUPER_ADMIN_DASHBOARD_VIEW, no step-up)
    const read = await call(plansList, { method: 'GET', headers: { cookie: jar } });
    expect(read.code).toBe(200);

    // step-up WRITE (BILLING_PLAN_MANAGE): refused without a step-up session
    const body = { name: 'Pack', credits: 100, price: 10 };
    const noStepUp = await call(creditPackages, { method: 'POST', headers: { cookie: jar }, body });
    expect(noStepUp.code).toBe(401);
    expect(noStepUp.body).toMatchObject({ code: 'STEP_UP_REQUIRED', authMode: 'canonical', stepUpStatus: 'required', capability: 'billing.plan.manage' });
    expect(db.credit_packages).toHaveLength(0);

    // the operator completes a passkey step-up on a trusted device
    const sessionId = db.auth_sessions[0].id;
    const in10 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.webauthn_credentials = [{ id: 'cred-1', user_id: SA, last_used_at: new Date().toISOString(), revoked_at: null }];
    db.stepup_sessions = [{ id: 'su-1', user_id: SA, auth_session_id: sessionId, factor: 'webauthn', expires_at: in10, started_at: new Date().toISOString(), consumed_at: null, revoked_at: null }];
    expect(fingerprintsAsked.length).toBeGreaterThan(0);
    db.trusted_devices = [{ id: 'dev-1', user_id: SA, fingerprint: fingerprintsAsked[0], expires_at: in10, last_seen_at: new Date().toISOString(), revoked_at: null }];

    const write = await call(creditPackages, { method: 'POST', headers: { cookie: jar }, body });
    expect(write.code).toBe(201);
    expect(db.credit_packages).toHaveLength(1);
  });

  it('a request with no session (and a legacy cookie) is refused at the capability route', async () => {
    const r = await call(plansList, { method: 'GET', headers: { cookie: 'super_admin_session=abc.def' } });
    expect(r.code).toBe(401);
  });
});

describe('Content Architect: canonical login -> capability route', () => {
  it('logs in canonically and reaches CONTENT_ARCHITECT_READ (search)', async () => {
    const login = await call(architectLogin, { method: 'POST', body: { username: 'ca', password: 'ca-pw' } });
    expect(login.code).toBe(200);
    const jar = cookieJar(login);
    expect(jar).toMatch(/^omnivyra_session=/);
    expect(jar).not.toMatch(/content_architect_session|content_architect_company_id|super_admin_session/);

    const search = await call(architectSearch, { method: 'GET', query: { q: 'acme' }, headers: { cookie: jar } });
    expect(search.code).toBe(200);
  });

  it('is NOT a platform admin: a Super Admin capability route refuses it', async () => {
    const login = await call(architectLogin, { method: 'POST', body: { username: 'ca', password: 'ca-pw' } });
    const r = await call(plansList, { method: 'GET', headers: { cookie: cookieJar(login) } });
    expect(r.code).toBe(403);
  });
});
