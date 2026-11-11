/**
 * D5 — RPA session replacement authorization, single-use user-bound tokens,
 *      and never trusting a self-declared account tier.
 * D6 — RPA session cookies encrypted at rest with the existing AES-256-GCM
 *      helper; no filesystem copy or fallback; legacy plaintext refused.
 *
 * In-memory PostgREST fake; RBAC is a role table the mocks consult exactly as
 * enforceRole / getUserRole would. No browser, no network.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const mockConfig: { ENCRYPTION_KEY: string | undefined } = { ENCRYPTION_KEY: KEY_A };
// Owner decision #17 (241394d16): /api/rpa/auth/start, /save-session and /complete answer
// 410 RPA_DISABLED in production, before anything else runs. That block is proven by
// rpaLoginBlock410.test.ts and re-asserted at the end of this file. The suites here test
// the token, role, scope and encryption logic BEHIND the block, which comes back when the
// sealing code ships (#17 is reverted then), so here - and only here - the block is
// switched off with a module mock. No runtime flag exists or is added.
jest.mock('../../services/rpaWorker/rpaLoginBlock', () => ({
  ...jest.requireActual('../../services/rpaWorker/rpaLoginBlock'),
  RPA_LOGIN_DISABLED: false,
}));
jest.mock('@/config', () => ({ config: mockConfig }));

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockDb.from(t) } }));

/** `${userId}:${orgId}` → role; super admins by user id. */
const mockRoles = new Map<string, string>();
const mockSuperAdmins = new Set<string>();
let mockCaller: { userId: string; companies: string[] } = { userId: 'admin_a', companies: [] };

jest.mock('../../services/rbacService', () => {
  const prim = jest.requireActual('../../services/rbacPrimitives');
  return {
    Role: prim.Role,
    normalizePermissionRole: prim.normalizePermissionRole,
    isSuperAdmin: async (u: string) => mockSuperAdmins.has(u),
    isPlatformSuperAdmin: async (u: string) => mockSuperAdmins.has(u),
    getUserRole: async (u: string, c: string) => {
      const role = mockRoles.get(`${u}:${c}`) ?? null;
      return { role, error: role ? null : 'COMPANY_ACCESS_DENIED' };
    },
    enforceRole: async (input: any) => {
      const u = mockCaller.userId;
      if (mockSuperAdmins.has(u)) return { userId: u, role: 'SUPER_ADMIN' };
      const role = mockRoles.get(`${u}:${input.companyId}`);
      if (!role || !input.allowedRoles.includes(role)) {
        input.res.status(403).json({ error: 'FORBIDDEN_ROLE' });
        return null;
      }
      return { userId: u, role };
    },
  };
});
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: mockCaller.userId, defaultCompanyId: null }),
  enforceCompanyAccess: async ({ res, companyId }: any) => {
    if (!mockCaller.companies.includes(companyId)) {
      res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
      return null;
    }
    return { userId: mockCaller.userId };
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const startHandler = require('../../../pages/api/rpa/auth/start').default;
const saveHandler = require('../../../pages/api/rpa/auth/save-session').default;
const completeHandler = require('../../../pages/api/rpa/auth/complete').default;
const callbackHandler = require('../../../pages/api/rpa/auth/callback').default;
const tokens = require('../../services/rpaWorker/rpaAuthTokens');
const store = require('../../services/rpaWorker/rpaSessionStore');
const { resolveAccountTier } = require('../../services/rpaWorker/rpaAccountTier');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SECRET_COOKIE = 'li_at-SECRET-COOKIE-VALUE-123';
const STATE = { cookies: [{ name: 'li_at', value: SECRET_COOKIE, domain: '.linkedin.com', path: '/' }], origins: [] };

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
async function call(handler: any, req: any) { const res = mockRes(); await handler(req, res); return res; }
const start = (org = ORG_A) => call(startHandler, { method: 'POST', headers: {}, body: { organization_id: org, platform: 'linkedin' } });
const save = (token: string, extra: Record<string, unknown> = {}) =>
  call(saveHandler, { method: 'POST', headers: {}, body: { session_token: token, storage_state: STATE, ...extra } });

const sessionRow = (org = ORG_A) => mockDb.tables.rpa_sessions?.find((r) => r.organization_id === org && r.platform === 'linkedin');

let tmpDir: string;
beforeEach(() => {
  mockDb = createFakeDb({ rpa_sessions: [], rpa_auth_token_redemptions: [] });
  mockDb.unique.rpa_auth_token_redemptions = ['nonce'];
  // upsert support for rpa_sessions (the shared fake has no upsert)
  const origFrom = mockDb.from;
  mockDb.from = (t: string) => {
    const q = origFrom(t);
    q.upsert = async (row: any) => {
      const rows = mockDb.tables[t] || (mockDb.tables[t] = []);
      const existing = rows.find((r) => r.organization_id === row.organization_id && r.platform === row.platform);
      if (existing) Object.assign(existing, row); else rows.push({ ...row });
      return { data: null, error: null };
    };
    return q;
  };
  mockRoles.clear();
  mockSuperAdmins.clear();
  mockRoles.set(`admin_a:${ORG_A}`, 'COMPANY_ADMIN');
  mockRoles.set(`member_a:${ORG_A}`, 'VIEW_ONLY');
  mockRoles.set(`creator_a:${ORG_A}`, 'CONTENT_CREATOR');
  mockRoles.set(`admin_b:${ORG_B}`, 'COMPANY_ADMIN');
  mockCaller = { userId: 'admin_a', companies: [ORG_A] };
  mockConfig.ENCRYPTION_KEY = KEY_A;
  process.env.RPA_AUTH_SECRET = 'rpa-test-signing-secret-0123456789';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-sess-'));
  process.env.RPA_SESSION_DIR = tmpDir;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RPA_SESSION_DIR;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D5 — who may start a session replacement', () => {
  it('a plain member (VIEW_ONLY) is refused', async () => {
    mockCaller = { userId: 'member_a', companies: [ORG_A] };
    const r = await start();
    expect(r.statusCode).toBe(403);
    expect(r.body.session_token).toBeUndefined();
  });

  it('a content creator (not a connector manager) is refused', async () => {
    mockCaller = { userId: 'creator_a', companies: [ORG_A] };
    expect((await start()).statusCode).toBe(403);
  });

  it('a company admin gets a token bound to (org, platform, THIS user)', async () => {
    const r = await start();
    expect(r.statusCode).toBe(200);
    const v = tokens.verifyRpaAuthToken(r.body.session_token);
    expect(v.ok).toBe(true);
    expect(v.payload).toMatchObject({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
  });

  it('cross-tenant: an admin of B cannot start for A', async () => {
    mockCaller = { userId: 'admin_b', companies: [ORG_B] };
    expect((await start(ORG_A)).statusCode).toBe(403);
  });
});

describe('D5 — redemption: single use, user-bound, role re-checked', () => {
  it('first save succeeds; replaying the same token is refused', async () => {
    const token = (await start()).body.session_token;
    const first = await save(token);
    expect(first.statusCode).toBe(200);
    const replay = await save(token);
    expect(replay.statusCode).toBe(401);
    expect(replay.body.reason).toBe('TOKEN_ALREADY_USED');
  });

  it('concurrent submissions of one token → exactly one write', async () => {
    const token = (await start()).body.session_token;
    const results = await Promise.all([save(token), save(token), save(token)]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(mockDb.tables.rpa_auth_token_redemptions).toHaveLength(1);
  });

  it('replay across routes (save-session then complete) is refused', async () => {
    const token = (await start()).body.session_token;
    expect((await save(token)).statusCode).toBe(200);
    const r = await call(completeHandler, { method: 'POST', headers: {}, body: { session_token: token, capture: { cookies: STATE.cookies } } });
    expect(r.statusCode).toBe(401);
    expect(r.body.reason).toBe('TOKEN_ALREADY_USED');
  });

  it('role revoked after the token was issued → refused, nothing stored, token not consumed', async () => {
    const token = (await start()).body.session_token;
    mockRoles.set(`admin_a:${ORG_A}`, 'VIEW_ONLY');
    const r = await save(token);
    expect(r.statusCode).toBe(403);
    expect(sessionRow()).toBeUndefined();
    expect(mockDb.tables.rpa_auth_token_redemptions).toHaveLength(0);
  });

  it('a token without an issuing user (pre-binding / unauthenticated issue) is refused', async () => {
    const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: null });
    const r = await save(token);
    expect(r.statusCode).toBe(401);
    expect(r.body.reason).toBe('TOKEN_NOT_USER_BOUND');
  });

  it('a forged token for another tenant is refused (signature)', async () => {
    const r = await save('eyJvcmdhbml6YXRpb25faWQiOiJ4In0.forged');
    expect(r.statusCode).toBe(401);
    expect(sessionRow(ORG_B)).toBeUndefined();
  });
});

describe('D5 — a self-declared account tier is never trusted', () => {
  it('save-session ignores account_tier=business; tier stays unknown', async () => {
    const token = (await start()).body.session_token;
    const r = await save(token, { account_tier: 'business' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ account_tier: null, account_tier_status: 'unverified', declared_account_tier_ignored: true });
    expect(sessionRow()!.account_tier).toBeNull();
    expect(await resolveAccountTier({ organization_id: ORG_A, platform: 'linkedin' })).toBeNull();
  });

  it('a legacy row carrying a self-declared tier is ignored, and action metadata cannot assert one', async () => {
    mockDb.tables.rpa_sessions.push({ organization_id: ORG_A, platform: 'instagram', account_tier: 'business', storage_state: STATE });
    expect(await resolveAccountTier({ organization_id: ORG_A, platform: 'instagram', action_metadata: { account_tier: 'business' } })).toBeNull();
  });

  it('only a server-verified envelope yields a tier', async () => {
    const env = { ...store.sealRpaSession(ORG_A, 'instagram', STATE), account_tier_verified: true };
    mockDb.tables.rpa_sessions.push({ organization_id: ORG_A, platform: 'instagram', account_tier: 'business', storage_state: env });
    expect(await resolveAccountTier({ organization_id: ORG_A, platform: 'instagram' })).toBe('business');
  });
});

describe('session capture scope and metadata', () => {
  const FOREIGN = { name: 'SID', value: 'FOREIGN-SECRET', domain: '.google.com', path: '/' };
  const LOOKALIKE = { name: 'x', value: 'LOOKALIKE-SECRET', domain: '.linkedin.com.evil.com', path: '/' };
  const NO_DOMAIN = { name: 'y', value: 'NO-DOMAIN-SECRET', path: '/' };
  const MIXED = [...STATE.cookies, FOREIGN, LOOKALIKE, NO_DOMAIN];
  const complete = (token: string, cookies: unknown[], extra: Record<string, unknown> = {}) =>
    call(completeHandler, { method: 'POST', headers: {}, body: { session_token: token, capture: { cookies }, ...extra } });
  const stored = async () => (await store.loadRpaSession(ORG_A, 'linkedin')) as { cookies: Array<{ name: string }> };

  it('save-session stores only the platform\'s cookies', async () => {
    const token = (await start()).body.session_token;
    const r = await save(token, { storage_state: { cookies: MIXED, origins: [] } });
    expect(r.statusCode).toBe(200);
    expect((await stored()).cookies.map((c) => c.name)).toEqual(['li_at']);
  });

  it('complete stores only the platform\'s cookies and counts what it kept', async () => {
    const token = (await start()).body.session_token;
    const r = await complete(token, MIXED);
    expect(r.statusCode).toBe(200);
    expect(r.body.cookie_count).toBe(1);
    expect((await stored()).cookies.map((c) => c.name)).toEqual(['li_at']);
  });

  it('nothing for this platform: refused, nothing stored, token not consumed', async () => {
    const token = (await start()).body.session_token;
    const a = await save(token, { storage_state: { cookies: [FOREIGN], origins: [] } });
    expect(a.statusCode).toBe(400);
    const b = await complete(token, [FOREIGN]);
    expect(b.statusCode).toBe(400);
    expect(JSON.stringify([a.body, b.body])).not.toContain('FOREIGN-SECRET');
    expect(sessionRow()).toBeUndefined();
    expect(mockDb.tables.rpa_auth_token_redemptions).toHaveLength(0);
    expect((await save(token)).statusCode).toBe(200);
  });

  it('an unparseable expires_at is refused before the token is consumed', async () => {
    const token = (await start()).body.session_token;
    for (const bad of ['next tuesday', '1', '', 12345]) {
      expect((await save(token, { expires_at: bad })).statusCode).toBe(400);
      expect((await complete(token, STATE.cookies, { expires_at: bad })).statusCode).toBe(400);
    }
    expect(sessionRow()).toBeUndefined();
    expect(mockDb.tables.rpa_auth_token_redemptions).toHaveLength(0);
  });

  it('a valid expires_at is stored normalised; absent stays null', async () => {
    const token = (await start()).body.session_token;
    expect((await save(token, { expires_at: '2030-01-02T03:04:05+00:00' })).statusCode).toBe(200);
    expect(sessionRow()!.expires_at).toBe('2030-01-02T03:04:05.000Z');
    const second = (await start()).body.session_token;
    expect((await complete(second, STATE.cookies)).statusCode).toBe(200);
    expect(sessionRow()!.expires_at).toBeNull();
  });

  it('saving a session does not claim it was verified, on either route', async () => {
    const first = (await start()).body.session_token;
    expect((await save(first)).statusCode).toBe(200);
    expect(sessionRow()!.last_verified_at).toBeNull();
    const second = (await start()).body.session_token;
    expect((await complete(second, STATE.cookies)).statusCode).toBe(200);
    expect(sessionRow()!.last_verified_at).toBeNull();
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    expect(sessionRow()!.last_verified_at).toBeNull();
  });

  it('the only reader, the callback, reports the null as-is and still says registered', async () => {
    const token = (await start()).body.session_token;
    expect((await save(token)).statusCode).toBe(200);
    const again = (await start()).body.session_token;
    const r = await call(callbackHandler, { method: 'GET', headers: {}, query: { session_token: again } });
    expect(r.body).toMatchObject({ status: 'registered', last_verified_at: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D6 — session cookies are encrypted at rest', () => {
  it('no plaintext cookie value is stored; the row holds only the envelope', async () => {
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    const row = sessionRow()!;
    expect(JSON.stringify(row)).not.toContain(SECRET_COOKIE);
    expect(JSON.stringify(row)).not.toContain('li_at');
    expect(store.isEncryptedSessionEnvelope(row.storage_state)).toBe(true);
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toEqual(STATE);
  });

  it('wrong key fails closed (no session)', async () => {
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    mockConfig.ENCRYPTION_KEY = KEY_B;
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
  });

  it('missing key: save throws and stores nothing', async () => {
    mockConfig.ENCRYPTION_KEY = undefined;
    await expect(store.saveRpaSession(ORG_A, 'linkedin', STATE)).rejects.toThrow();
    expect(sessionRow()).toBeUndefined();
  });

  it('tampered ciphertext fails closed', async () => {
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    const env = sessionRow()!.storage_state;
    const last = env.ciphertext.slice(-1);
    env.ciphertext = env.ciphertext.slice(0, -1) + (last === '0' ? '1' : '0');
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
  });

  it('a ciphertext copied onto another tenant\'s row is refused (binding)', async () => {
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    mockDb.tables.rpa_sessions.push({ organization_id: ORG_B, platform: 'linkedin', storage_state: { ...sessionRow()!.storage_state } });
    expect(await store.loadRpaSession(ORG_B, 'linkedin')).toBeNull();
  });

  it('a legacy plaintext row is refused (re-auth required) and reported as such', async () => {
    mockDb.tables.rpa_sessions.push({ organization_id: ORG_A, platform: 'linkedin', storage_state: STATE, account_tier: 'business' });
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
    const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    const r = await call(callbackHandler, { method: 'GET', headers: {}, query: { session_token: token } });
    expect(r.body).toMatchObject({ status: 'reauth_required', account_tier: null });
    expect(JSON.stringify(r.body)).not.toContain(SECRET_COOKIE);
  });
});

describe('D6 — no filesystem copy, no filesystem fallback', () => {
  const legacyFile = () => path.join(tmpDir, `${ORG_A}__linkedin.json`);

  it('save writes no file and removes a legacy plaintext copy', async () => {
    fs.writeFileSync(legacyFile(), JSON.stringify(STATE));
    await store.saveRpaSession(ORG_A, 'linkedin', STATE);
    expect(fs.existsSync(legacyFile())).toBe(false);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('no DB row → the legacy plaintext file is NOT used', async () => {
    fs.writeFileSync(legacyFile(), JSON.stringify(STATE));
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
  });

  it('expired DB row → the legacy plaintext file is NOT used', async () => {
    await store.saveRpaSession(ORG_A, 'linkedin', STATE, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    fs.writeFileSync(legacyFile(), JSON.stringify(STATE));
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
  });
});

describe('owner decision #17 is still in force', () => {
  it('the REAL rpaLoginBlock disables RPA logins (this file only mocks it off to test the logic behind it)', () => {
    expect(jest.requireActual('../../services/rpaWorker/rpaLoginBlock').RPA_LOGIN_DISABLED).toBe(true);
  });
});
