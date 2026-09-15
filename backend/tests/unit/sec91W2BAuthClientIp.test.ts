/**
 * SEC91-W2B-3 (P3) — authentication rate-limit keys and MFA attempt buckets used the
 * FIRST hop of X-Forwarded-For, which the client writes.
 *
 * Off Vercel a caller could rotate `X-Forwarded-For` per request and get a fresh
 * rate-limit bucket every time (or fill a victim's). On Vercel the edge overwrites the
 * header, so production was not exploitable — but the code depended on that silently.
 *
 * NOW: every pages/api/auth/** route derives the IP through backend/auth/requestClientIp.ts
 * → lib/security/clientIp.ts getTrustedClientIp (SEC-E2). check-user's limit is marked
 * `sensitive: true` (it is an enumeration surface and previously got the generous
 * Redis-down fallback).
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockRateLimitCalls: Array<{ key: string; config: Record<string, unknown> }> = [];
jest.mock('../../../lib/auth/rateLimit', () => {
  const actual = jest.requireActual('../../../lib/auth/rateLimit');
  return {
    ...actual,
    checkRateLimit: jest.fn(async (key: string, config: Record<string, unknown>) => {
      mockRateLimitCalls.push({ key, config });
      // Deny: every route answers 429 right after its IP limiter, touching nothing else.
      return { allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 60, bypassed: false };
    }),
  };
});
const mockMfaChecks: Array<{ factor: string; userId: string | null; ip: string | null }> = [];
jest.mock('../../security/MfaAttemptLimiter', () => ({
  check: jest.fn((input: { factor: string; userId: string | null; ip: string | null }) => {
    mockMfaChecks.push(input);
    return { allowed: false, retryAfterSeconds: 60, failureCount: 5 };
  }),
  recordFailure: jest.fn(),
  reset: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/auth/${p}`).default;
/* eslint-enable @typescript-eslint/no-var-requires */

const SPOOFED = '6.6.6.6';
const PEER = '10.0.0.7';
const CLIENT = '203.0.113.9';

async function call(p: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown; query?: Record<string, string> }) {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const req: any = {
    method: opts.method ?? 'POST',
    url: `/api/auth/${p}`,
    query: opts.query ?? {},
    body: opts.body ?? { email: 'someone@example.test', code: 'AAAA-BBBB' },
    headers: { ...(opts.headers ?? {}) },
    cookies: {},
    socket: { remoteAddress: PEER },
  };
  const res: any = {
    statusCode: 200, headersSent: false,
    status(c: number) { out.status = c; this.statusCode = c; return this; },
    json(b: unknown) { out.body = b; this.headersSent = true; return this; },
    send(b: unknown) { out.body = b; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
    setHeader() { return this; }, getHeader() { return undefined; }, removeHeader() { return this; },
    redirect() { this.headersSent = true; return this; }, on() { return this; }, once() { return this; },
  };
  await route(p)(req, res);
  return out;
}

const RATE_LIMITED_ROUTES: Array<[string, string]> = [
  ['login', 'POST'],
  ['reset', 'POST'],
  ['signup', 'POST'],
  ['check-domain', 'GET'],
  ['check-user', 'POST'],
  ['accept-invite', 'POST'],
  ['resume-status', 'POST'],
  ['resend-verification', 'POST'],
  ['resend-invitation', 'POST'],
  ['magic-link', 'POST'],
];

const savedEnv = { VERCEL: process.env.VERCEL, TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS };
beforeEach(() => {
  mockRateLimitCalls.length = 0;
  mockMfaChecks.length = 0;
  delete process.env.VERCEL;
  delete process.env.TRUSTED_PROXY_HOPS;
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('SEC91-W2B-3 auth rate-limit keys use the platform-trusted client IP', () => {
  it.each(RATE_LIMITED_ROUTES)('off-platform: a spoofed X-Forwarded-For does not choose the %s bucket (socket peer is used)', async (p, method) => {
    const r = await call(p, { method, headers: { 'x-forwarded-for': `${SPOOFED}, ${PEER}` }, query: { domain: 'example.test' } });
    expect(r.status).toBe(429);
    const ipKeys = mockRateLimitCalls.map((c) => c.key).filter((k) => !k.includes('@'));
    expect(ipKeys.length).toBeGreaterThan(0);
    expect(ipKeys).not.toContain(SPOOFED);
    expect(ipKeys[0]).toBe(PEER);
  });

  it.each(RATE_LIMITED_ROUTES)('COMPAT Vercel: %s keys on the edge-set client address, as before', async (p, method) => {
    process.env.VERCEL = '1';
    const r = await call(p, { method, headers: { 'x-real-ip': CLIENT, 'x-forwarded-for': CLIENT, 'x-vercel-forwarded-for': CLIENT }, query: { domain: 'example.test' } });
    expect(r.status).toBe(429);
    expect(mockRateLimitCalls[0].key).toBe(CLIENT);
  });

  it('check-user: the enumeration-surface limit is marked sensitive (strict budget when Redis is down)', async () => {
    await call('check-user', { method: 'POST' });
    expect(mockRateLimitCalls[0].config).toMatchObject({ keyPrefix: 'rl:auth:check-user', limit: 20, windowSecs: 15 * 60, sensitive: true });
  });

  it('recovery-login: the MFA IP bucket is the socket peer, not a spoofed X-Forwarded-For', async () => {
    const r = await call('recovery-login', { headers: { 'x-forwarded-for': SPOOFED } });
    expect(r.status).toBe(429);
    expect(mockMfaChecks[0]).toMatchObject({ factor: 'recovery_code', userId: null, ip: PEER });
  });

  it('COMPAT Vercel: recovery-login keys the MFA bucket on x-real-ip', async () => {
    process.env.VERCEL = '1';
    await call('recovery-login', { headers: { 'x-real-ip': CLIENT, 'x-forwarded-for': CLIENT } });
    expect(mockMfaChecks[0].ip).toBe(CLIENT);
  });
});

describe('no pages/api/auth route reads X-Forwarded-For itself', () => {
  const root = path.join(process.cwd(), 'pages/api/auth');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) files.push(full);
    }
  };
  walk(root);

  it('scans a non-trivial set of route files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('every IP read goes through backend/auth/requestClientIp (lib/security/clientIp)', () => {
    const offenders = files
      .filter((f) => /headers\s*\[\s*['"`]x-(forwarded-for|real-ip|vercel-forwarded-for)['"`]\s*\]/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(process.cwd(), f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
