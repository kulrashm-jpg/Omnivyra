/**
 * STEP 3AH-91 integration — closes the three P3 findings W2-F tracked as
 * known-open, so their tracking entries could be retired:
 *
 * SEC91-W2F-2a  pages/api/super-admin/login.ts           password compared with !==
 * SEC91-W2F-2b  pages/api/super-admin/content-architect-login.ts  password compared with !==
 * SEC91-W2F-2c  backend/services/contentArchitectSecurityService.ts  unsalted SHA-256 hex
 *               digests compared with !==
 *   → all three go through backend/security/constantTimeEqual, and both halves of
 *     a username+password pair are always evaluated (no short-circuit revealing
 *     which half was wrong). Accept/deny behaviour is unchanged.
 *
 * SEC91-W2F-3a  pages/api/whatsapp/webhook/index.ts verifySignature() returned
 *               TRUE when WHATSAPP_APP_SECRET was unset outside production, so a
 *               non-production process accepted and enqueued unsigned payloads
 *   → unset secret = every POST is 401 in every environment.
 *
 * All credential values are fake fixtures.
 */
import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { invoke } from '../helpers/routeAuthHarness';

const mockCte = jest.fn();
jest.mock('../../security/constantTimeEqual', () => {
  const actual = jest.requireActual('../../security/constantTimeEqual');
  return {
    ...actual,
    constantTimeEqual: (...a: unknown[]) => { mockCte(...a); return actual.constantTimeEqual(...a); },
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../security/SessionAuthorityService', () => ({ createSession: jest.fn(), attachSessionCookie: jest.fn() }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../security/startup/superAdminIdentityCheck', () => ({ checkSuperAdminIdentity: jest.fn(async () => ({ ok: false, reason: 'PRIMARY_USER_ID_UNSET', primaryUserId: null })) }));
jest.mock('../../security/bridgeCookie', () => ({
  mintSignedBridgeCookieValue: () => 'signed-bridge-placeholder',
  buildBridgeSetCookieHeader: (v: string) => `super_admin_session=${v}; Path=/; HttpOnly`,
}));
const mockInserts: Array<{ table: string; row: unknown }> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => ({ insert: async (row: unknown) => { mockInserts.push({ table, row }); return { error: null }; } }) },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({ insert: async (row: unknown) => { mockInserts.push({ table, row }); return { error: null }; } }),
}));
const mockAudit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: (...a: unknown[]) => mockAudit(...a) }));
const mockConfig: Record<string, string | undefined> = {};
jest.mock('@/config', () => ({ config: new Proxy({}, { get: (_t, k: string) => mockConfig[k] }) }));
const mockEnqueue = jest.fn(async (..._a: unknown[]) => true);
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: jest.fn(() => ({})) }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: (...a: unknown[]) => mockEnqueue(...a) }));

const SAVED = { ...process.env };
beforeEach(() => { mockCte.mockClear(); mockInserts.length = 0; mockAudit.mockClear(); mockEnqueue.mockClear(); });
afterAll(() => { process.env = SAVED; });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ctGate = require('../../../scripts/check-constant-time-secrets.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const routeGate = require('../../../scripts/check-route-auth.js');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

// ─────────────────────────────────────────────────────────── W2F-2a ──
describe('SEC91-W2F-2a — super-admin env-credential login', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require('../../../pages/api/super-admin/login').default;
  beforeEach(() => {
    process.env.SUPER_ADMIN_USERNAME = 'fake-operator';
    process.env.SUPER_ADMIN_PASSWORD = 'fake-password-w2f2a';
    delete process.env.SUPER_ADMIN_PRIMARY_USER_ID;
  });
  const login = (username: unknown, password: unknown) => invoke(handler, { method: 'POST', body: { username, password } });

  it.each([
    ['wrong password', 'fake-operator', 'fake-password-w2f2X'],
    ['password prefix', 'fake-operator', 'fake-password'],
    ['password with a suffix', 'fake-operator', 'fake-password-w2f2a-extra'],
    ['wrong username', 'fake-operatoR', 'fake-password-w2f2a'],
    ['empty password', 'fake-operator', ''],
    ['non-string password', 'fake-operator', { $ne: '' }],
  ])('%s → 403 INVALID_CREDENTIALS, no cookie', async (_n, u, p) => {
    const r = await login(u, p);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'INVALID_CREDENTIALS' });
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('correct credentials still log in (behaviour unchanged)', async () => {
    const r = await login('fake-operator', 'fake-password-w2f2a');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('both halves go through constantTimeEqual, even when the username is already wrong', async () => {
    await login('wrong-user', 'wrong-pass');
    expect(mockCte).toHaveBeenCalledWith('wrong-user', 'fake-operator');
    expect(mockCte).toHaveBeenCalledWith('wrong-pass', 'fake-password-w2f2a');
  });

  it('unset env credentials still → 500 (never compared)', async () => {
    delete process.env.SUPER_ADMIN_PASSWORD;
    const r = await login('fake-operator', '');
    expect(r.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────── W2F-2b ──
describe('SEC91-W2F-2b — content-architect env-credential login', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require('../../../pages/api/super-admin/content-architect-login').default;
  beforeEach(() => {
    process.env.CONTENT_ARCHITECT_USERNAME = 'fake-architect';
    process.env.CONTENT_ARCHITECT_PASSWORD = 'fake-password-w2f2b';
    delete process.env.CONTENT_ARCHITECT_PRIMARY_USER_ID;
  });
  const login = (username: unknown, password: unknown) => invoke(handler, { method: 'POST', body: { username, password } });

  it.each([
    ['wrong password', 'fake-architect', 'fake-password-w2f2X'],
    ['password prefix', 'fake-architect', 'fake-password'],
    ['wrong username', 'fake-architecT', 'fake-password-w2f2b'],
    ['empty password', 'fake-architect', ''],
  ])('%s → 403 and a failed-login audit row', async (_n, u, p) => {
    const r = await login(u, p);
    expect(r.status).toBe(403);
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(mockInserts.map((i) => (i.row as { action: string }).action)).toEqual(['content_architect_failed_login']);
  });

  it('correct credentials still log in (behaviour unchanged)', async () => {
    const r = await login('fake-architect', 'fake-password-w2f2b');
    expect(r.status).toBe(200);
    expect(mockInserts.map((i) => (i.row as { action: string }).action)).toEqual(['content_architect_login']);
  });

  it('both halves go through constantTimeEqual', async () => {
    await login('wrong-user', 'wrong-pass');
    expect(mockCte).toHaveBeenCalledWith('wrong-user', 'fake-architect');
    expect(mockCte).toHaveBeenCalledWith('wrong-pass', 'fake-password-w2f2b');
  });
});

// ─────────────────────────────────────────────────────────── W2F-2c ──
describe('SEC91-W2F-2c — grantContentArchitectAccess password check', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { grantContentArchitectAccess } = require('../../services/contentArchitectSecurityService');
  beforeEach(() => { mockConfig.CONTENT_ARCHITECT_PASSWORD = 'fake-password-w2f2c'; });

  it.each([['wrong', 'fake-password-w2f2X'], ['prefix', 'fake-password'], ['empty', '']])(
    '%s password → null, no session row, failure audited',
    async (_n, pw) => {
      expect(await grantContentArchitectAccess('user-1', pw, '203.0.113.9', 'ua')).toBeNull();
      expect(mockInserts).toEqual([]);
      expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: 'Invalid Content Architect password' }));
    },
  );

  it('correct password still grants a session (behaviour unchanged)', async () => {
    const token = await grantContentArchitectAccess('user-1', 'fake-password-w2f2c', '203.0.113.9', 'ua');
    expect(typeof token).toBe('string');
    expect(mockInserts.map((i) => i.table)).toEqual(['content_architect_sessions']);
    expect(mockCte).toHaveBeenCalledWith('fake-password-w2f2c', 'fake-password-w2f2c');
  });

  it('unset password still denies before comparing', async () => {
    mockConfig.CONTENT_ARCHITECT_PASSWORD = undefined;
    expect(await grantContentArchitectAccess('user-1', 'anything', 'ip', 'ua')).toBeNull();
    expect(mockCte).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────── W2F-2 gate evidence ──
describe('SEC91-W2F-2 — the constant-time gate', () => {
  it('none of the three files is flagged any more, and they import the helper', () => {
    for (const rel of ['pages/api/super-admin/login.ts', 'pages/api/super-admin/content-architect-login.ts', 'backend/services/contentArchitectSecurityService.ts']) {
      const s = src(rel);
      expect(ctGate.scanSource(s)).toEqual([]);
      expect(s).toMatch(/import \{ constantTimeEqual \} from '[./]+(?:backend\/)?security\/constantTimeEqual';/);
    }
  });

  it('the gate carries no known-open entry: nothing is tracked as open', () => {
    expect(ctGate.KNOWN_OPEN).toEqual([]);
    const repo = ctGate.scanRepo();
    expect(repo.violations).toEqual([]);
    expect(repo.known).toEqual([]);
  });

  it('the pre-fix shapes are still caught (the gate did not go blind)', () => {
    expect(ctGate.scanSource(`const expectedPass = String(process.env.SUPER_ADMIN_PASSWORD ?? '');\nif (providedPass !== expectedPass) deny();`).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────── W2F-3a ──
describe('SEC91-W2F-3a — WhatsApp webhook POST fails closed without WHATSAPP_APP_SECRET', () => {
  const load = () => {
    let h: any;
    jest.isolateModules(() => { h = require('../../../pages/api/whatsapp/webhook/index').default; });
    return h;
  };
  const post = async (h: any, body: string, sig?: string) => {
    const req: any = new EventEmitter();
    Object.assign(req, { method: 'POST', query: {}, headers: sig === undefined ? {} : { 'x-hub-signature-256': sig }, url: '/api/whatsapp/webhook' });
    const out = { status: 0, body: undefined as unknown };
    const res: any = {
      status(c: number) { out.status = c; return this; },
      json(b: unknown) { out.body = b; return this; },
      send(b: unknown) { out.body = b; return this; },
      setHeader() { return this; },
    };
    const done = Promise.resolve(h(req, res));
    setImmediate(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
    await done;
    return out;
  };
  const BODY = JSON.stringify({ entry: [{ id: 'fake-waba' }] });

  it.each(['development', 'test', 'staging', 'production'])(
    'CRITICAL: secret unset, NODE_ENV=%s → unsigned POST is 401 and nothing is enqueued',
    async (env) => {
      delete process.env.WHATSAPP_APP_SECRET;
      (process.env as Record<string, string>).NODE_ENV = env;
      const h = load();
      for (const sig of [undefined, '', 'sha256=deadbeef']) {
        const r = await post(h, BODY, sig);
        expect(r.status).toBe(401);
      }
      expect(mockEnqueue).not.toHaveBeenCalled();
    },
  );

  it('LEGITIMATE: secret set + valid signature → 200 and enqueued', async () => {
    process.env.WHATSAPP_APP_SECRET = 'fake-app-secret-w2f3a';
    (process.env as Record<string, string>).NODE_ENV = 'test';
    const sig = 'sha256=' + createHmac('sha256', 'fake-app-secret-w2f3a').update(BODY).digest('hex');
    const r = await post(load(), BODY, sig);
    expect(r.status).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('secret set + wrong signature → 401', async () => {
    process.env.WHATSAPP_APP_SECRET = 'fake-app-secret-w2f3a';
    const sig = 'sha256=' + createHmac('sha256', 'another-secret').update(BODY).digest('hex');
    expect((await post(load(), BODY, sig)).status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('the route gate finds no R4-ENV on the webhook and no knownOpen entry remains for it', () => {
    const { rows, knownOpen } = routeGate.scanRepo();
    const row = rows.find((r: { route: string }) => r.route === 'pages/api/whatsapp/webhook/index.ts');
    expect(row.violations).toEqual([]);
    expect(row.knownOpen).toEqual([]);
    expect(knownOpen['pages/api/whatsapp/webhook/index.ts']).toBeUndefined();
  });
});
