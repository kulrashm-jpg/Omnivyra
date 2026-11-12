/**
 * P1 (GoTrue-bypass gate) — the bound signup intent PRODUCERS.
 *
 *   - POST /api/auth/signup                  mints through backend/services/signupIntentMint
 *   - POST /api/onboarding/revalidate-signup re-runs every signup gate, then mints
 *
 * Hostile-by-default fake Supabase: every .eq/.in/.gt filter is applied, a
 * multi-row maybeSingle returns PGRST116 with data null, an unknown table/RPC
 * or query method throws, and the one-pending-intent-per-email unique index
 * (idx_signup_intents_email_pending_unique) is enforced on insert.
 *
 * Every success is checked against the CONSUMER contract (onboarding bootstrap):
 * email = verified email lowercased; status in (pending, completed);
 * expires_at > now; intent_data.validated_company_domain ===
 * normalizeCompanyDomain(email); validated_website_url non-empty; verdict in
 * (eligible, auto_approved).
 */

import { normalizeCompanyDomain } from '../../../lib/shared/domain/companyDomain';

// ── Fake Supabase ────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const KNOWN_TABLES = ['users', 'user_company_roles', 'companies', 'signup_referrals', 'signup_intents'];

class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: Array<{ table: string; op: 'insert' | 'update'; payload: Row }> = [];
  failInsert: Record<string, string> = {};
  private seq = 0;
  constructor() { for (const t of KNOWN_TABLES) this.tables[t] = []; }
  nextId(): string { this.seq += 1; return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`; }
  from(table: string) {
    if (!KNOWN_TABLES.includes(table)) throw new Error(`fake db: unexpected table ${table}`);
    return new FakeQuery(this, table);
  }
  rpc(name: string, _args: unknown) {
    if (name === 'auth_user_confirmed') return Promise.resolve({ data: false, error: null });
    throw new Error(`fake db: unexpected rpc ${name}`);
  }
}

class FakeQuery {
  private op: 'select' | 'insert' | 'update' = 'select';
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private payload: Row | null = null;
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  gt(col: string, val: any) { this.filters.push((r) => r[col] != null && r[col] > val); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }

  maybeSingle() { return Promise.resolve(this.exec('maybe')); }
  single() { return Promise.resolve(this.exec('single')); }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.exec('many')).then(res, rej); }

  private matching(): Row[] {
    let rows = this.db.tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return rows;
  }

  private shape(rows: Row[], mode: 'maybe' | 'single' | 'many') {
    if (mode === 'many') return { data: rows, error: null };
    if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    if (rows.length === 0) {
      return mode === 'single'
        ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
        : { data: null, error: null };
    }
    return { data: { ...rows[0] }, error: null };
  }

  private exec(mode: 'maybe' | 'single' | 'many') {
    if (this.op === 'select') return this.shape(this.matching(), mode);
    if (this.op === 'insert') {
      const msg = this.db.failInsert[this.table];
      if (msg) return { data: null, error: { code: 'XX000', message: msg } };
      const row: Row = {
        id: this.db.nextId(),
        created_at: new Date().toISOString(),
        ...this.payload,
      };
      if (this.table === 'signup_intents' && row.status === 'pending'
        && this.db.tables.signup_intents.some((r) => r.email === row.email && r.status === 'pending')) {
        return { data: null, error: { code: '23505', message: 'idx_signup_intents_email_pending_unique' } };
      }
      this.db.tables[this.table].push(row);
      this.db.writes.push({ table: this.table, op: 'insert', payload: row });
      return this.shape([row], mode);
    }
    // update
    const rows = this.db.tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    for (const r of rows) Object.assign(r, this.payload);
    this.db.writes.push({ table: this.table, op: 'update', payload: { ...this.payload } });
    return this.shape(rows, mode);
  }
}

let db = new FakeDb();

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: unknown) => db.rpc(n, a),
  },
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: jest.fn() }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '203.0.113.7' }));
jest.mock('../../../lib/auth/captcha', () => ({
  verifyCaptchaToken: jest.fn(async () => ({ ok: true })),
  CAPTCHA_FAILED_RESPONSE: { error: 'captcha failed', code: 'CAPTCHA_FAILED' },
}));
const mockCheckRateLimit = jest.fn();
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  EMAIL_LINK_LIMIT: { keyPrefix: 'rl:email_link', sensitive: true, limit: 3, windowSecs: 3600 },
}));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: jest.fn(async () => undefined),
  ensureSignupCorrelationId: jest.fn(async () => 'cid-test-1'),
  signupRejectionEventFor: () => 'ValidationFailed',
  requestUserAgent: () => 'jest',
  requestIp: () => '203.0.113.7',
}));
const mockNotify = jest.fn();
jest.mock('../../services/claimedDomainNotifyService', () => ({
  notifyAdminAndProspectOfClaimedDomain: (...a: unknown[]) => mockNotify(...a),
}));
const mockValidate = jest.fn();
jest.mock('../../services/companyIdentityValidationService', () => ({
  validateCompanyIdentity: (...a: unknown[]) => mockValidate(...a),
  COMPANY_IDENTITY_VALIDATION_VERSION: 'test-version',
}));
const mockGetUser = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => mockGetUser(...a),
}));

import signupHandler from '../../../pages/api/auth/signup';
import revalidateHandler from '../../../pages/api/onboarding/revalidate-signup';

// ── Helpers ──────────────────────────────────────────────────────────────────

function identityFor(email: string, opts: { eligible?: boolean; autoApprovable?: boolean; reason?: string | null } = {}) {
  const d = normalizeCompanyDomain(email);
  return {
    eligible: opts.eligible ?? true,
    emailDomain: email.split('@')[1],
    normalizedEmailDomain: d,
    websiteUrl: `https://www.${d}`,
    websiteDomain: d,
    normalizedWebsiteDomain: d,
    companyIdentityDomain: d,
    validationReason: opts.reason ?? null,
    requiresManualReview: false,
    autoApprovable: opts.autoApprovable,
    diagnostics: null,
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn((b: unknown) => { res.body = b; return res; });
  res.end = jest.fn(() => res);
  return res;
}

function req(body: unknown, method = 'POST') {
  return { method, body, headers: { authorization: 'Bearer test-token' }, socket: {} } as any;
}

/** The onboarding consumer's acceptance rule, verbatim from the P1 contract. */
function acceptableIntents(email: string): Row[] {
  const e = email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  return db.tables.signup_intents.filter((r) =>
    r.email === e
    && ['pending', 'completed'].includes(r.status)
    && r.expires_at > nowIso
    && r.intent_data?.validated_company_domain === normalizeCompanyDomain(e)
    && typeof r.intent_data?.validated_website_url === 'string'
    && r.intent_data.validated_website_url.length > 0
    && ['eligible', 'auto_approved'].includes(r.intent_data?.verdict));
}

const intentWrites = () => db.writes.filter((w) => w.table === 'signup_intents');
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function seedClaimedDomain(domain: string) {
  db.tables.companies.push({ id: 'org-claimed', name: 'Claimed Co', website_domain: domain, admin_email_domain: domain, status: 'active' });
  db.tables.user_company_roles.push({ id: 'ucr-admin', user_id: 'u-admin', company_id: 'org-claimed', role: 'COMPANY_ADMIN', status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.users.push({ id: 'u-admin', email: 'boss@' + domain, is_deleted: false });
}

beforeEach(() => {
  db = new FakeDb();
  mockCheckRateLimit.mockReset().mockResolvedValue({ allowed: true });
  mockNotify.mockReset().mockResolvedValue(undefined);
  mockValidate.mockReset().mockImplementation(async (email: string) => identityFor(email));
  mockGetUser.mockReset().mockResolvedValue({
    user: { id: 'uid-1', email: 'Founder@Acme.com', emailVerified: true },
    error: null,
  });
});

afterEach(() => { jest.useRealTimers(); });

// ── signup.ts ────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup — mints through the shared service', () => {
  const body = { email: 'Founder@Acme.com', companyName: '  Acme Ltd  ', captchaToken: null };

  test('eligible signup mints one pending intent with verdict eligible that satisfies the consumer contract', async () => {
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ proceed: true });
    expect(db.tables.signup_intents).toHaveLength(1);
    const row = db.tables.signup_intents[0];
    expect(row).toMatchObject({ email: 'founder@acme.com', source: 'signup_form', status: 'pending' });
    expect(row.intent_data).toMatchObject({
      company_name: 'Acme Ltd',
      validated_company_domain: 'acme.com',
      validated_website_url: 'https://www.acme.com',
      validation_version: 'test-version',
      correlation_id: 'cid-test-1',
      verdict: 'eligible',
    });
    expect(row.intent_data).not.toHaveProperty('auto_approved');
    expect(acceptableIntents('founder@acme.com')).toHaveLength(1);
  });

  test('auto-approvable signup mints verdict auto_approved with the ops marker', async () => {
    mockValidate.mockImplementation(async (e: string) =>
      identityFor(e, { eligible: false, autoApprovable: true, reason: 'NO_WEBSITE_FOUND' }));
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(200);
    const row = db.tables.signup_intents[0];
    expect(row.intent_data).toMatchObject({
      verdict: 'auto_approved', auto_approved: true, auto_approved_reason: 'NO_WEBSITE_FOUND',
    });
    expect(acceptableIntents('founder@acme.com')).toHaveLength(1);
  });

  test('auto-approve kill switch off: the review case is refused and nothing is minted', async () => {
    const prev = process.env.IDENTITY_HARDENING_AUTO_APPROVE;
    process.env.IDENTITY_HARDENING_AUTO_APPROVE = 'false';
    try {
      mockValidate.mockImplementation(async (e: string) =>
        identityFor(e, { eligible: false, autoApprovable: true, reason: 'NO_WEBSITE_FOUND' }));
      const res = mockRes();
      await signupHandler(req(body), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('NO_WEBSITE_FOUND');
      expect(intentWrites()).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.IDENTITY_HARDENING_AUTO_APPROVE;
      else process.env.IDENTITY_HARDENING_AUTO_APPROVE = prev;
    }
  });

  test('an existing unexpired legacy pending intent is refreshed in place and gains the verdict', async () => {
    db.tables.signup_intents.push({
      id: 'legacy-1', email: 'founder@acme.com', source: 'signup_form', status: 'pending',
      created_at: '2026-11-01T00:00:00.000Z', expires_at: hoursFromNow(5),
      intent_data: { company_name: 'Old', validated_company_domain: 'acme.com', validated_website_url: 'https://www.acme.com' },
    });
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(200);
    expect(db.tables.signup_intents).toHaveLength(1);
    expect(db.tables.signup_intents[0].intent_data).toMatchObject({ company_name: 'Acme Ltd', verdict: 'eligible' });
    expect(acceptableIntents('founder@acme.com')).toHaveLength(1);
  });

  test('CLAIMED_DOMAIN keeps its 409 shape and mints nothing', async () => {
    seedClaimedDomain('acme.com');
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: expect.any(String), code: 'CLAIMED_DOMAIN', alreadyReferred: false, adminEmailMasked: 'bo••@acme.com',
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test('identity validation throwing fails closed with 503 and mints nothing', async () => {
    mockValidate.mockRejectedValue(new Error('dns down'));
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('IDENTITY_VALIDATION_UNAVAILABLE');
    expect(intentWrites()).toHaveLength(0);
  });

  test('an intent insert failure still returns the original 500', async () => {
    db.failInsert.signup_intents = 'boom';
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to initiate signup' });
  });

  test('a soft-deleted account is refused with ACCOUNT_DELETED before any identity probe', async () => {
    db.tables.users.push({ id: 'u-del', email: 'founder@acme.com', is_deleted: true });
    const res = mockRes();
    await signupHandler(req(body), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DELETED');
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });
});

// ── revalidate-signup ────────────────────────────────────────────────────────

describe('POST /api/onboarding/revalidate-signup', () => {
  test('non-POST is 405', async () => {
    const res = mockRes();
    await revalidateHandler(req({}, 'GET'), res);
    expect(res.statusCode).toBe(405);
    expect(intentWrites()).toHaveLength(0);
  });

  test('no session → 401, nothing minted', async () => {
    mockGetUser.mockResolvedValue({ user: null, error: 'no token' });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(401);
    expect(intentWrites()).toHaveLength(0);
  });

  test('unverified email → 403 EMAIL_NOT_VERIFIED, no probe, nothing minted', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'uid-1', email: 'founder@acme.com', emailVerified: false }, error: null });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test.each([
    ['quoted local part', '"a,b"@acme.com'],
    ['percent in local part', 'a%b@acme.com'],
    ['IP-literal domain', 'founder@[127.0.0.1]'],
    ['missing email', null],
  ])('email policy refuses %s → 400 EMAIL_NOT_ACCEPTABLE, nothing minted', async (_label, email) => {
    mockGetUser.mockResolvedValue({ user: { id: 'uid-1', email, emailVerified: true }, error: null });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('EMAIL_NOT_ACCEPTABLE');
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test('IP rate limit refusal → 429 before auth, nothing minted', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(429);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test('per-uid rate limit refusal → 429, nothing minted; limits are 5/hour', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(429);
    expect(mockCheckRateLimit.mock.calls[0][1]).toMatchObject({ keyPrefix: 'rl:onboarding:revalidate-signup', limit: 5, windowSecs: 3600 });
    expect(mockCheckRateLimit.mock.calls[1][0]).toBe('uid-1');
    expect(mockCheckRateLimit.mock.calls[1][1]).toMatchObject({ keyPrefix: 'rl:uid:revalidate-signup', limit: 5, windowSecs: 3600 });
    expect(intentWrites()).toHaveLength(0);
  });

  test('CLAIMED_DOMAIN → 409 with the signup.ts shape, no probe, nothing minted', async () => {
    seedClaimedDomain('acme.com');
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: expect.any(String), code: 'CLAIMED_DOMAIN', alreadyReferred: false, adminEmailMasked: 'bo••@acme.com',
    });
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test('soft-deleted account → 403 ACCOUNT_DELETED, nothing minted', async () => {
    db.tables.users.push({ id: 'uid-1', email: 'founder@acme.com', is_deleted: true });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DELETED');
    expect(intentWrites()).toHaveLength(0);
  });

  test('already-onboarded account → 409 ACCOUNT_EXISTS, nothing minted', async () => {
    db.tables.users.push({ id: 'uid-1', email: 'founder@acme.com', is_deleted: false });
    db.tables.user_company_roles.push({ id: 'r1', user_id: 'uid-1', company_id: 'org-1', role: 'COMPANY_ADMIN', status: 'active' });
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ACCOUNT_EXISTS');
    expect(intentWrites()).toHaveLength(0);
  });

  test('identity probe that never settles → 503 after the hard timeout, nothing minted', async () => {
    jest.useFakeTimers();
    mockValidate.mockImplementation(() => new Promise(() => undefined));
    const res = mockRes();
    const done = revalidateHandler(req({ companyName: 'Acme' }), res);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(res.status).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    await done;
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('IDENTITY_VALIDATION_UNAVAILABLE');
    expect(intentWrites()).toHaveLength(0);
  });

  test('identity probe throwing → 503, nothing minted', async () => {
    mockValidate.mockRejectedValue(new Error('resolver exploded'));
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(503);
    expect(intentWrites()).toHaveLength(0);
  });

  test('identity refusal (PUBLIC_EMAIL) → 400 with the eligibility code, nothing minted', async () => {
    mockValidate.mockImplementation(async (e: string) => identityFor(e, { eligible: false, reason: 'PUBLIC_EMAIL' }));
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('PUBLIC_EMAIL');
    expect(intentWrites()).toHaveLength(0);
  });

  test('no prior intent and no companyName → 400, no probe, nothing minted', async () => {
    const res = mockRes();
    await revalidateHandler(req({}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('COMPANY_NAME_REQUIRED');
    expect(mockValidate).not.toHaveBeenCalled();
    expect(intentWrites()).toHaveLength(0);
  });

  test('success with no prior intent mints a contract-satisfying intent from the body company name', async () => {
    const res = mockRes();
    await revalidateHandler(req({ companyName: '  Acme Ltd ' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const ok = acceptableIntents('founder@acme.com');
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ source: 'onboarding_revalidate', status: 'pending' });
    expect(ok[0].intent_data).toMatchObject({ company_name: 'Acme Ltd', verdict: 'eligible', correlation_id: 'cid-test-1' });
    expect(mockValidate).toHaveBeenCalledWith('founder@acme.com', expect.anything());
  });

  test('resume after expiry: an expired legacy completed intent supplies the company name; a new bound intent is minted', async () => {
    db.tables.signup_intents.push({
      id: 'old-1', email: 'founder@acme.com', source: 'signup_form', status: 'completed',
      created_at: '2026-11-01T00:00:00.000Z', expires_at: '2026-11-02T00:00:00.000Z',
      intent_data: { company_name: 'Acme From Signup', validated_company_domain: 'acme.com', validated_website_url: 'https://www.acme.com' },
    });
    expect(acceptableIntents('founder@acme.com')).toHaveLength(0); // legacy + expired
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Body Name Ignored' }), res);
    expect(res.statusCode).toBe(200);
    const ok = acceptableIntents('founder@acme.com');
    expect(ok).toHaveLength(1);
    expect(ok[0].intent_data.company_name).toBe('Acme From Signup');
  });

  test('an expired PENDING intent is refreshed in place (one-pending-per-email index never trips)', async () => {
    db.tables.signup_intents.push({
      id: 'exp-pending', email: 'founder@acme.com', source: 'signup_form', status: 'pending',
      created_at: '2026-11-01T00:00:00.000Z', expires_at: '2026-11-02T00:00:00.000Z',
      intent_data: { company_name: 'Acme Pending' },
    });
    const res = mockRes();
    await revalidateHandler(req({}), res);
    expect(res.statusCode).toBe(200);
    expect(db.tables.signup_intents).toHaveLength(1);
    const ok = acceptableIntents('founder@acme.com');
    expect(ok).toHaveLength(1);
    expect(ok[0].id).toBe('exp-pending');
    expect(ok[0].intent_data).toMatchObject({ company_name: 'Acme Pending', verdict: 'eligible' });
  });

  test('auto-approvable identity mints verdict auto_approved', async () => {
    mockValidate.mockImplementation(async (e: string) =>
      identityFor(e, { eligible: false, autoApprovable: true, reason: 'NO_WEBSITE_FOUND' }));
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(200);
    const ok = acceptableIntents('founder@acme.com');
    expect(ok).toHaveLength(1);
    expect(ok[0].intent_data).toMatchObject({ verdict: 'auto_approved', auto_approved: true });
  });

  test('mint failure → 500, no acceptable intent', async () => {
    db.failInsert.signup_intents = 'boom';
    const res = mockRes();
    await revalidateHandler(req({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(500);
    expect(acceptableIntents('founder@acme.com')).toHaveLength(0);
  });
});
