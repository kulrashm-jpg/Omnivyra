/**
 * STEP 3AH-91 SEC-E8 — /api/health/config is public (allowlist kind `health`).
 * In production it must answer with status only: no configuration error text
 * (which names env vars and can echo their values), no config details, no
 * Redis host/port. Status codes are unchanged so monitoring keeps working;
 * non-production keeps the full diagnostic body.
 */
const mockState: { valid: boolean; error: Error | null; redis: any } = { valid: false, error: null, redis: null };
jest.mock('@/config', () => ({
  isConfigValid: () => mockState.valid,
  getConfigError: () => mockState.error,
  getValidatedConfig: () => ({
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://default:REDIS-PASSWORD@redis.internal.test:6379',
    SUPABASE_URL: 'https://project-ref.supabase.test',
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  }),
}));
jest.mock('@/lib/redis/client', () => ({ getSharedRedisSyncOrNull: () => mockState.redis }));
jest.mock('@/lib/redis/sanitizer', () => ({ maskRedisUrl: (u: string) => u.replace(/:[^:@/]+@/, ':***@') }));

// The route's gate reads the FROZEN productionFlags (isNonProduction, fail-closed), so each environment loads the
// route in an isolated module registry AFTER setting NODE_ENV; the mocks above apply in every registry.
let handler: (req: unknown, res: unknown) => Promise<unknown>;
function loadUnder(env: string | undefined): void {
  if (env === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = env;
  jest.isolateModules(() => { handler = require('../../../pages/api/health/config').default; });
}

// Obvious placeholder (secret-pattern gate recognises 'fake'); the assertion is that NO
// connection string of any value reaches the public response.
const SECRETISH = 'postgres://svc:fake-db-password-for-redaction-test@db.internal.test:5432';

async function call(): Promise<{ status: number; body: any }> {
  const out = { status: 0, body: undefined as any };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    setHeader() { return this; }, getHeader() { return undefined; }, end() { return this; },
    on() { return this; }, once() { return this; },
  };
  await handler({ method: 'GET', headers: {}, query: {}, url: '/api/health/config', socket: {} } as any, res);
  return out;
}

const priorEnv = process.env.NODE_ENV;
afterEach(() => {
  if (priorEnv === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = priorEnv;
});
let errSpy: jest.SpyInstance;
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

describe('production: status only', () => {
  beforeEach(() => loadUnder('production'));

  it('invalid config: 500 + generic body, no error text', async () => {
    mockState.valid = false;
    mockState.error = new Error(`DATABASE_URL invalid: ${SECRETISH}`);
    mockState.redis = { status: 'ready', options: { host: 'redis.internal.test', port: 6379 } };
    const out = await call();
    expect(out.status).toBe(500);
    expect(out.body.status).toBe('unhealthy');
    expect(out.body.config).toEqual({ valid: false });
    const text = JSON.stringify(out.body);
    expect(text).not.toContain('DB-PASSWORD');
    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('redis.internal.test');
    // The detail is still available to operators in the server log — redacted.
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('DATABASE_URL');
    expect(logged).not.toContain('DB-PASSWORD');
  });

  it('valid config: 200, no details (hosts/URLs) and no redis host/port', async () => {
    mockState.valid = true;
    mockState.error = null;
    mockState.redis = { status: 'ready', options: { host: 'redis.internal.test', port: 6379 } };
    const out = await call();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'healthy', config: { valid: true }, redis: { connected: true } });
    const text = JSON.stringify(out.body);
    expect(text).not.toContain('redis.internal.test');
    expect(text).not.toContain('project-ref');
    expect(out.body.config.details).toBeUndefined();
    expect(out.body.redis.host).toBeUndefined();
  });

  it('degraded Redis keeps its 503 without the error text', async () => {
    mockState.valid = true;
    mockState.error = null;
    mockState.redis = { get status() { throw new Error('connect ECONNREFUSED redis.internal.test:6379'); } };
    const out = await call();
    expect(out.status).toBe(503);
    expect(out.body.status).toBe('degraded');
    expect(JSON.stringify(out.body)).not.toContain('redis.internal.test');
  });
});

describe('non-production: full diagnostics (unchanged)', () => {
  beforeEach(() => loadUnder('development'));
  it('includes the config error and redis details', async () => {
    mockState.valid = false;
    mockState.error = new Error('DATABASE_URL invalid');
    mockState.redis = { status: 'ready', options: { host: 'localhost', port: 6379 } };
    const out = await call();
    expect(out.status).toBe(500);
    expect(out.body.config.error).toBe('DATABASE_URL invalid');
    expect(out.body.redis.host).toBe('localhost');
  });
});

// e9 ruling (2026-11-13): fail-CLOSED. Any NODE_ENV that is not provably non-production - unset included - gets
// the status-only body. The old `=== 'production'` gate served the full diagnostics for all of these.
describe.each([['Production'], ['prod'], ['staging'], ['UNSET']])('NODE_ENV=%s: status only (fail-closed)', (env) => {
  beforeEach(() => loadUnder(env === 'UNSET' ? undefined : env));
  it('no config error text and no redis host', async () => {
    mockState.valid = false;
    mockState.error = new Error(`DATABASE_URL invalid: ${SECRETISH}`);
    mockState.redis = { status: 'ready', options: { host: 'redis.internal.test', port: 6379 } };
    const out = await call();
    expect(out.status).toBe(500);
    expect(out.body.config).toEqual({ valid: false });
    const text = JSON.stringify(out.body);
    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('redis.internal.test');
  });
});

describe('CONTROL NODE_ENV=test: full diagnostics', () => {
  beforeEach(() => loadUnder('test'));
  it('includes the config error', async () => {
    mockState.valid = false;
    mockState.error = new Error('DATABASE_URL invalid');
    mockState.redis = { status: 'ready', options: { host: 'localhost', port: 6379 } };
    expect((await call()).body.config.error).toBe('DATABASE_URL invalid');
  });
});

// A module, not a global script: top-level helpers (call, loadUnder) must not collide with other suites in tsc.
export {};
