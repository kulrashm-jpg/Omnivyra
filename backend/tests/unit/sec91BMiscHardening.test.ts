/**
 * SEC91-B8 / B10 / B11 / B12 — smaller credential-handling hardenings.
 *
 * B8  legacy PLAINTEXT provider-account keys were resolved silently → now reported
 *     (once per account, id only, never the value); resolution unchanged.
 * B10 WhatsApp webhook GET: with WHATSAPP_WEBHOOK_VERIFY_TOKEN unset, an EMPTY
 *     hub.verify_token matched and hub.challenge was echoed → now fails closed.
 * B11 passkey begin-authentication honoured a body `userId` without a session, disclosing
 *     that user's credential ids (allowCredentials) → now only the session principal.
 * B12 credentialEncryption guessed hex-or-base64 (tokenStore is strict hex) and
 *     whatsappBroadcastService used `ENCRYPTION_KEY ?? ''` → one strict hex parser.
 * All values are fake fixtures.
 */
import { invoke } from '../helpers/routeAuthHarness';

const mockBegin = jest.fn(async (..._a: unknown[]) => ({ options: { challenge: 'c', allowCredentials: [] } }));
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({ beginAuthentication: (...a: unknown[]) => mockBegin(...a) }));
let mockPrincipal: any = { ok: false, reason: 'NO_AUTH' };
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: jest.fn(async () => mockPrincipal) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: jest.fn() }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: jest.fn() }));
const mockConfig: Record<string, string | undefined> = {};
jest.mock('@/config', () => ({ config: new Proxy({}, { get: (_t, k: string) => mockConfig[k] }) }));

// ─────────────────────────────────────────────────────────────── B8 ──
describe('B8 — legacy plaintext provider-account key', () => {
  it('still resolves, is flagged, and is reported once per account without the value', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveAccountCredentials } = require('../../services/providerAccountService');
    const acct = { id: 'acct-legacy-1', credentials_encrypted: JSON.stringify({ api_key_value: 'FAKE-LEGACY-PLAINTEXT-KEY-b8' }) };
    const r1 = resolveAccountCredentials(acct);
    const r2 = resolveAccountCredentials(acct);
    expect(r1.api_key_value).toBe('FAKE-LEGACY-PLAINTEXT-KEY-b8');
    expect(r1.legacy_plaintext_key).toBe(true);
    expect(r2.legacy_plaintext_key).toBe(true);
    const reports = warn.mock.calls.filter((c) => c[0] === 'PROVIDER_ACCOUNT_LEGACY_PLAINTEXT_KEY');
    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports)).toContain('acct-legacy-1');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('FAKE-LEGACY-PLAINTEXT-KEY-b8');
    warn.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────── B10 ──
describe('B10 — WhatsApp webhook verification fails closed', () => {
  const saved = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  afterAll(() => { if (saved === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN; else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = saved; });
  const load = () => {
    let h: any;
    jest.isolateModules(() => { h = require('../../../pages/api/whatsapp/webhook/index').default; });
    return h;
  };
  const get = (h: any, token: string | undefined, challenge = '1158201444') =>
    invoke(h, { method: 'GET', query: { 'hub.mode': 'subscribe', ...(token === undefined ? {} : { 'hub.verify_token': token }), 'hub.challenge': challenge } });

  it('CRITICAL: token unset + empty hub.verify_token → 403, challenge not echoed', async () => {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const r = await get(load(), '');
    expect(r.status).toBe(403);
    expect(r.body).not.toBe('1158201444');
  });

  it('token unset + any token → 403', async () => {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    expect((await get(load(), 'guess')).status).toBe(403);
    expect((await get(load(), undefined)).status).toBe(403);
  });

  it('LEGITIMATE: configured token + matching hub.verify_token → 200 echoing the challenge as text/plain', async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fake-verify-token';
    const r = await get(load(), 'fake-verify-token');
    expect(r.status).toBe(200);
    expect(r.body).toBe('1158201444');
    expect(String(r.headers['content-type'])).toMatch(/text\/plain/);
  });

  it('configured token + wrong / empty token → 403; markup is never reflected', async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fake-verify-token';
    const h = load();
    expect((await get(h, 'wrong')).status).toBe(403);
    expect((await get(h, '')).status).toBe(403);
    expect((await get(h, 'fake-verify-token', '<script>alert(1)</script>')).status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────── B11 ──
describe('B11 — passkey begin-authentication never scopes to a body userId without a session', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = () => require('../../../pages/api/auth/passkeys/begin-authentication').default;
  beforeEach(() => mockBegin.mockClear());

  it('CRITICAL: no session + body userId → userless ceremony (no credential-id disclosure)', async () => {
    mockPrincipal = { ok: false, reason: 'NO_AUTH' };
    const r = await invoke(handler(), { method: 'POST', body: { userId: 'victim-user-id' } });
    expect(r.status).toBe(200);
    expect((mockBegin.mock.calls[0][0] as { userId: unknown }).userId).toBeNull();
  });

  it('LEGITIMATE: an authenticated principal still gets a ceremony scoped to itself (body ignored)', async () => {
    mockPrincipal = { ok: true, principal: { userId: 'session-user', legacyCookieSuperAdmin: false } };
    await invoke(handler(), { method: 'POST', body: { userId: 'someone-else' } });
    expect((mockBegin.mock.calls[0][0] as { userId: unknown }).userId).toBe('session-user');
  });

  it('LEGITIMATE: the userless sign-in ceremony (empty body) is unchanged', async () => {
    mockPrincipal = { ok: false, reason: 'NO_AUTH' };
    await invoke(handler(), { method: 'POST', body: {} });
    expect((mockBegin.mock.calls[0][0] as { userId: unknown }).userId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────── B12 ──
describe('B12 — one strict hex ENCRYPTION_KEY parser', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ce = () => require('../../auth/credentialEncryption');
  const HEX = 'c'.repeat(64);

  it('a base64 key is refused (tokenStore already refuses it — the modules can no longer disagree)', () => {
    mockConfig.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => ce().encryptCredential('x')).toThrow(/64 hex/);
  });

  it('COMPAT: a hex key round-trips exactly as before', () => {
    mockConfig.ENCRYPTION_KEY = HEX;
    const enc = ce().encryptCredential('fake-value');
    expect(ce().decryptCredential(enc)).toBe('fake-value');
  });

  it('whatsappBroadcastService uses the shared parser, not `ENCRYPTION_KEY ?? ""`', () => {
    const src = require('fs').readFileSync('backend/services/whatsappBroadcastService.ts', 'utf8') as string;
    expect(src).not.toMatch(/process\.env\.ENCRYPTION_KEY \?\? ''/);
    expect(src).toMatch(/requireEncryptionKey\(\)/);
  });

  it('decryptPhone with no key fails with a clear ENCRYPTION_KEY error', () => {
    mockConfig.ENCRYPTION_KEY = undefined;
    let err: unknown;
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../../services/whatsappBroadcastService').decryptPhone('00:00:00');
      } catch (e) { err = e; }
    });
    expect(String((err as Error)?.message)).toMatch(/ENCRYPTION_KEY/);
  });
});
