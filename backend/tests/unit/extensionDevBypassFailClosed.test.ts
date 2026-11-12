/**
 * SECURITY (2026-11-13, e9 ruling): the extension dev auth bypass (DEV_EXTENSION_AUTH_BYPASS skips session-token
 * AND HMAC, and the body's organization_id becomes the tenant) promised to "refuse to run in production no matter
 * what the env says", but rested on `process.env.NODE_ENV !== 'production'` - fail-OPEN for unset / 'staging' /
 * 'Production'. Now two fail-closed guards: isNonProduction() (NODE_ENV exactly 'development' / 'test') AND a
 * loopback request host (Host, and X-Forwarded-Host when present).
 *
 * The REAL productionFlags module runs (frozen at load), so each case loads the middleware in an isolated registry
 * under the NODE_ENV it names. A refused bypass falls through to the real session check, which this test makes
 * fail (no token) -> 401.
 */
jest.mock('../../services/extensionSessionService', () => ({
  verifyExtensionSessionToken: () => null,
  verifyExtensionRequestSignature: () => false,
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => { throw new Error('no DB read expected'); } },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const saved = { env: process.env.NODE_ENV, flag: process.env.DEV_EXTENSION_AUTH_BYPASS };
afterEach(() => {
  for (const [k, v] of [['NODE_ENV', saved.env], ['DEV_EXTENSION_AUTH_BYPASS', saved.flag]] as const) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
});

type Auth = (req: unknown, res: unknown) => Promise<{ session: { orgId: string } } | null>;
function loadUnder(env: string | undefined, flag: string | undefined): Auth {
  const e = process.env as Record<string, string | undefined>;
  if (env === undefined) delete e.NODE_ENV; else e.NODE_ENV = env;
  if (flag === undefined) delete e.DEV_EXTENSION_AUTH_BYPASS; else e.DEV_EXTENSION_AUTH_BYPASS = flag;
  let fn: Auth | undefined;
  jest.isolateModules(() => { fn = require('../../middleware/extensionAuthMiddleware').requireExtensionAuth; });
  return fn as Auth;
}

async function call(auth: Auth, headers: Record<string, string>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  const out = await auth({ method: 'POST', url: '/api/extension/events/dms', headers, query: {}, body: { organization_id: ORG } }, res);
  return { out, res };
}

describe.each([['production'], ['Production'], ['prod'], ['staging'], ['UNSET']])('NODE_ENV=%s + bypass flag + localhost', (env) => {
  it('the bypass is REFUSED: the real session check runs and answers 401', async () => {
    const auth = loadUnder(env === 'UNSET' ? undefined : env, '1');
    const { out, res } = await call(auth, { host: 'localhost:3000' });
    expect(out).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

describe('NODE_ENV=development + bypass flag, NON-loopback addressing', () => {
  it.each([
    ['a deployed domain', { host: 'www.omnivyra.com' }],
    ['loopback Host but a forwarded public domain', { host: 'localhost:3000', 'x-forwarded-host': 'www.omnivyra.com' }],
    ['no Host header at all', {}],
    ['a LAN address', { host: '192.168.1.20:3000' }],
    ['a look-alike host', { host: 'localhost.evil.test' }],
  ])('%s -> refused (401)', async (_n, headers) => {
    const auth = loadUnder('development', '1');
    const { out, res } = await call(auth, headers as Record<string, string>);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

it('NODE_ENV=development + localhost but the flag NOT set -> refused (401)', async () => {
  const auth = loadUnder('development', undefined);
  const { out, res } = await call(auth, { host: 'localhost:3000' });
  expect(out).toBeNull();
  expect(res.statusCode).toBe(401);
});

describe('CONTROL: provably non-production, flag set, loopback host -> the bypass still works', () => {
  it.each([
    ['development', { host: 'localhost:3000' }],
    ['test', { host: '127.0.0.1:3000' }],
    ['development', { host: '[::1]:3000' }],
    ['development', { host: 'localhost:3000', 'x-forwarded-host': 'localhost:3000' }],
  ])('NODE_ENV=%s %j', async (env, headers) => {
    const auth = loadUnder(env, 'true');
    const { out } = await call(auth, headers as Record<string, string>);
    expect(out?.session.orgId).toBe(ORG);
  });
});

// A module, not a global script: top-level helpers (call, loadUnder) must not collide with other suites in tsc.
export {};
