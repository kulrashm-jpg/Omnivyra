/**
 * R-1 proof 1: every token-accepting /api/extension/* route enforces the
 * request signature, before it touches the database.
 *
 * Two layers:
 *   - structural: every route file under pages/api/extension either calls
 *     requireExtensionAuth and returns when it fails before any DB access,
 *     or is one of the three non-token routes (claim-code / cookie flows),
 *     which must never accept an extension token;
 *   - behavioural: each token-accepting handler is called with a VALID
 *     session token and NO signature (the 1.4.0 page-leak replay), and with
 *     a token minted by /api/extension/session (no HMAC nonce). Every one
 *     must answer 401 with zero database calls.
 */

process.env.EXTENSION_SESSION_SECRET = 'test-extension-session-secret-not-production';
delete process.env.DEV_EXTENSION_AUTH_BYPASS;
// Some routes import services that validate config at load. Test-only
// placeholders (nothing connects to them): the handlers must refuse before
// any of that is used, which is what this suite proves.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

import fs from 'fs';
import path from 'path';

const dbCalls: string[] = [];
const recordingDb = () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'from' || prop === 'rpc') {
      return (name: string) => { dbCalls.push(`${String(prop)}:${name}`); throw new Error('DB_TOUCHED_BEFORE_AUTH'); };
    }
    return undefined;
  },
});
jest.mock('../../db/supabaseClient', () => ({ supabase: recordingDb() }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: recordingDb() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { issueExtensionSessionToken } from '../../services/extensionSessionService';

const ROOT = path.resolve(__dirname, '../../..');
const ROUTE_DIR = path.join(ROOT, 'pages/api/extension');
const NON_TOKEN_ROUTES = new Set(['bootstrap.ts', 'redeem.ts', 'session.ts']);
// R-3: these refuse with 410 before auth while browser ingestion is suspended.
const SUSPENDED_UPLOAD_ROUTES = new Set(['events.ts', 'events/comments.ts', 'events/dms.ts', 'v15/events/comments.ts']);

function routeFiles(dir: string, base = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) return routeFiles(path.join(dir, e.name), rel);
    return e.name.endsWith('.ts') ? [rel] : [];
  });
}

const ALL_ROUTES = routeFiles(ROUTE_DIR).sort();
const TOKEN_ROUTES = ALL_ROUTES.filter((r) => !NON_TOKEN_ROUTES.has(r));

const ORG = 'org-cov-1';
const SIGNED_SESSION_TOKEN = issueExtensionSessionToken({
  userId: 'user-cov-1', orgId: ORG, expiresAt: Date.now() + 3600_000, hmacNonce: 'nonce-cov-1',
});
// Exactly what GET /api/extension/session issues: no hmacNonce.
const COOKIE_ROUTE_TOKEN = issueExtensionSessionToken({
  userId: 'user-cov-1', orgId: ORG, expiresAt: Date.now() + 3600_000,
});

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  res.end = () => res;
  return res;
}

describe('route inventory', () => {
  it('finds the extension routes (guard against an empty match set)', () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(12);
    expect(TOKEN_ROUTES.length).toBe(ALL_ROUTES.length - NON_TOKEN_ROUTES.size);
    for (const r of NON_TOKEN_ROUTES) expect(ALL_ROUTES).toContain(r);
  });

  it.each(TOKEN_ROUTES)('%s calls requireExtensionAuth and returns on failure before any DB access', (rel) => {
    const src = fs.readFileSync(path.join(ROUTE_DIR, rel), 'utf8');
    const handlerAt = src.indexOf('async function handler');
    const authAt = src.indexOf('await requireExtensionAuth(req, res)', handlerAt);
    const bailAt = src.indexOf('if (!auth) return', authAt);
    const firstDb = (() => {
      const hits = ['.from(', 'supabase.', '.rpc('].map((n) => src.indexOf(n, handlerAt)).filter((i) => i >= 0);
      return hits.length ? Math.min(...hits) : Number.POSITIVE_INFINITY;
    })();
    expect(handlerAt).toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThan(handlerAt);
    expect(bailAt).toBeGreaterThan(authAt);
    expect(firstDb).toBeGreaterThan(bailAt);
    expect(src).not.toMatch(/verifyExtensionSessionToken\(/);
    expect(src).not.toMatch(/getSupabaseUserFromRequest/);
  });

  it.each([...NON_TOKEN_ROUTES])('%s never accepts an extension session token', (rel) => {
    const src = fs.readFileSync(path.join(ROUTE_DIR, rel), 'utf8');
    expect(src).not.toMatch(/requireExtensionAuth|verifyExtensionSessionToken/);
  });

  it('no code outside the auth middleware verifies an extension token by itself', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', 'tests', '__tests__', '.git'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /verifyExtensionSessionToken\(/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(ROOT, p).replace(/\\/g, '/'));
        }
      }
    };
    for (const d of ['pages', 'backend', 'lib']) walk(path.join(ROOT, d));
    expect(offenders.sort()).toEqual([
      'backend/middleware/extensionAuthMiddleware.ts',
      'backend/services/extensionSessionService.ts',
    ]);
  });
});

describe('behaviour: valid token, no signature → 401, database untouched', () => {
  const METHOD: Record<string, string> = {
    'action-result.ts': 'POST', 'capabilities.ts': 'GET', 'commands.ts': 'GET',
    'dispatch/renew.ts': 'POST', 'events.ts': 'POST', 'events/comments.ts': 'POST',
    'events/dms.ts': 'POST', 'health.ts': 'GET', 'validate.ts': 'POST',
    // Extension 1.5.0 (EXTENSION-1.5.0-CONTRACT.md)
    'bind-account.ts': 'POST', 'v15/commands/index.ts': 'GET', 'v15/commands/ack.ts': 'POST',
    'v15/events/comments.ts': 'POST',
  };

  it('covers every token-accepting route', () => {
    expect(Object.keys(METHOD).sort()).toEqual(TOKEN_ROUTES);
  });

  const cases = TOKEN_ROUTES.flatMap((rel) => [
    [rel, 'signed-session token, no signature headers', SIGNED_SESSION_TOKEN, 'MISSING_SIGNATURE_HEADER'],
    [rel, '/api/extension/session token (no HMAC nonce), forged headers', COOKIE_ROUTE_TOKEN, 'SESSION_MISSING_HMAC_NONCE'],
  ]);

  it.each(cases)('%s — %s', async (rel, _label, token, reason) => {
    dbCalls.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(ROUTE_DIR, rel));
    const handler = mod.default;
    const forged = reason === 'SESSION_MISSING_HMAC_NONCE'
      ? { 'x-omnivyra-timestamp': String(Math.floor(Date.now() / 1000)), 'x-omnivyra-nonce': 'n-1', 'x-omnivyra-signature': 'f'.repeat(64) }
      : {};
    const res = mockRes();
    await handler({
      method: METHOD[rel as string],
      url: `/api/extension/${String(rel).replace(/\.ts$/, '')}`,
      headers: { authorization: `Bearer ${token}`, 'x-omnivyra-capability-version': 'test', ...forged },
      query: { organization_id: ORG },
      body: { organization_id: ORG, commandId: 'c1', leaseId: 'l1', status: 'failed', platform: 'linkedin', comments: [], threads: [] },
    }, res);
    if (SUSPENDED_UPLOAD_ROUTES.has(rel as string)) {
      // R-3: browser ingestion is suspended — refused even earlier, before auth.
      expect(res.statusCode).toBe(410);
      expect(res.body).toMatchObject({ error: 'BROWSER_SYNC_SUSPENDED' });
    } else {
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({ error: 'SIGNATURE_INVALID', reason });
    }
    expect(dbCalls).toEqual([]);
  });
});
