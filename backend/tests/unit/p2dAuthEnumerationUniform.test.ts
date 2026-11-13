/**
 * P2-D — magic-link and check-user must not reveal whether an account exists.
 *
 * Owner ruling: no CAPTCHA on login/signup, so the rate limiter is the whole
 * defence. These tests drive the REAL route default exports (through the route
 * factory) against hostile-by-default fakes:
 *
 *   - a faithful supabase fake that applies every filter, rejects unknown
 *     tables / columns / builder methods / RPCs, and charges virtual latency
 *     per query (so an unpadded hit and miss take DIFFERENT time);
 *   - a counting rate-limit fake that enforces each config's own limit per
 *     `${keyPrefix}:${identifier}` bucket;
 *   - a virtual clock injected via __setAuthResponseClockForTest (no real sleeps).
 */
import * as fs from 'fs';
import * as path from 'path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Virtual clock ────────────────────────────────────────────────────────────
let mockNow = 1_000_000;
const sleeps: number[] = [];
const virtualClock = {
  now: () => mockNow,
  sleep: async (ms: number) => { sleeps.push(ms); mockNow += ms; },
};

// ── Faithful supabase fake ───────────────────────────────────────────────────
type Row = Record<string, unknown>;
const USERS_COLUMNS = new Set(['id', 'email', 'is_deleted', 'is_email_verified']);
const mockDb: {
  users: Row[];
  authUsers: Array<{ email: string; confirmed: boolean }>;
  reads: string[];
  failUsers: boolean;
  usersLatencyMs: number;
  rpcLatencyMs: number;
  sends: Array<Record<string, any>>;
  sendImpl: null | ((args: any) => Promise<any>);
} = {
  users: [], authUsers: [], reads: [], failUsers: false,
  usersLatencyMs: 25, rpcLatencyMs: 40, sends: [], sendImpl: null,
};

function mockBuilder(table: string) {
  if (table !== 'users') throw new Error(`fake supabase: unexpected table ${table}`);
  const filters: Array<[string, unknown]> = [];
  let cols: string[] = [];
  let limitN: number | null = null;
  const run = () => {
    mockDb.reads.push(`users:${filters.map(([c]) => c).join(',')}`);
    mockNow += mockDb.usersLatencyMs;
    if (mockDb.failUsers) return { data: null, error: { message: 'db down' } };
    let rows = mockDb.users.filter((r) => filters.every(([c, v]) => r[c] === v));
    if (limitN !== null) rows = rows.slice(0, limitN);
    const projected = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    return { data: projected, error: null };
  };
  const b: any = {
    select(c: string) {
      cols = c.split(',').map((s) => s.trim());
      for (const col of cols) if (!USERS_COLUMNS.has(col)) throw new Error(`fake supabase: unknown column ${col}`);
      return b;
    },
    eq(c: string, v: unknown) {
      if (!USERS_COLUMNS.has(c)) throw new Error(`fake supabase: unknown filter column ${c}`);
      filters.push([c, v]); return b;
    },
    limit(n: number) { limitN = n; return b; },
    async maybeSingle() {
      const r = run();
      if (r.error) return r;
      const rows = r.data as Row[];
      if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
      return { data: rows[0] ?? null, error: null };
    },
    then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
  };
  return new Proxy(b, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      throw new Error(`fake supabase: unsupported builder method ${String(p)}`);
    },
  });
}

const mockSupabase = {
  from: (t: string) => mockBuilder(t),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    mockDb.reads.push(`rpc:${fn}`);
    mockNow += mockDb.rpcLatencyMs;
    if (fn !== 'auth_user_confirmed') return { data: null, error: { message: `unknown rpc ${fn}` } };
    const u = mockDb.authUsers.find((a) => a.email === args.p_email);
    return { data: Boolean(u?.confirmed), error: null };
  },
  auth: {
    signInWithOtp: async (args: any) => {
      mockDb.sends.push(args);
      if (mockDb.sendImpl) return mockDb.sendImpl(args);
      const known = mockDb.authUsers.some((a) => a.email === args.email);
      // GoTrue with shouldCreateUser:false refuses an unknown address.
      return known ? { data: {}, error: null } : { data: null, error: { message: 'Signups not allowed for otp', status: 422 } };
    },
  },
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: mockSupabase, default: mockSupabase, getSupabase: () => mockSupabase, supabaseAdmin: mockSupabase,
}));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://app.example.test' }));

const mockAudit: any[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async (e: unknown) => { mockAudit.push(e); }),
}));

// ── Counting rate-limit fake (enforces each config's own limit) ──────────────
const mockBuckets = new Map<string, number>();
const mockLimitCalls: Array<{ key: string; config: any }> = [];
jest.mock('../../../lib/auth/rateLimit', () => {
  const actual = jest.requireActual('../../../lib/auth/rateLimit');
  return {
    ...actual,
    checkRateLimit: jest.fn(async (id: string, config: any) => {
      const key = `${config.keyPrefix}:${id}`;
      mockLimitCalls.push({ key: id, config });
      const count = mockBuckets.get(key) ?? 0;
      mockBuckets.set(key, count + 1);
      const resetAt = Math.ceil(Date.now() / 1000) + config.windowSecs;
      return count >= config.limit
        ? { allowed: false, remaining: 0, resetAt, bypassed: false }
        : { allowed: true, remaining: config.limit - count - 1, resetAt, bypassed: false };
    }),
  };
});

import {
  AUTH_ENUMERATION_MIN_RESPONSE_MS,
  AUTH_RATE_LIMITED_BODY,
  MAGIC_LINK_UNIFORM_BODY,
  __setAuthResponseClockForTest,
  padToMinimumLatency,
  runDetachedFromResponse,
} from '../../auth/uniformAuthResponse';
import { MAGIC_LINK_GLOBAL_LIMIT, CHECK_USER_GLOBAL_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../services/logger';

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/auth/${p}`).default;
/* eslint-enable @typescript-eslint/no-var-requires */

const EXISTING = 'alice@example.test';
const MISSING = 'nobody@example.test';
const DELETED = 'gone@example.test';
const AUTH_ONLY = 'authonly@example.test';

type Out = { status: number; body: unknown; headers: Record<string, string>; elapsed: number };

async function call(p: string, body: unknown, ip = '10.0.0.7'): Promise<Out> {
  const out: Out = { status: 200, body: undefined, headers: {}, elapsed: 0 };
  const req: any = {
    method: 'POST', url: `/api/auth/${p}`, query: {}, body, headers: {}, cookies: {},
    socket: { remoteAddress: ip },
  };
  const res: any = {
    statusCode: 200, headersSent: false,
    status(c: number) { out.status = c; this.statusCode = c; return this; },
    json(b: unknown) { out.body = b; this.headersSent = true; return this; },
    send(b: unknown) { out.body = b; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = String(v); return this; },
    getHeader(k: string) { return out.headers[k.toLowerCase()]; },
    removeHeader() { return this; },
    on() { return this; }, once() { return this; },
  };
  const t0 = mockNow;
  await route(p)(req, res);
  out.elapsed = mockNow - t0;
  return out;
}

const wire = (o: Out) => `${o.status} ${JSON.stringify(o.body)}`;
const flush = () => new Promise((r) => setImmediate(r));

const savedVercel = process.env.VERCEL;
beforeEach(() => {
  delete process.env.VERCEL;
  __setAuthResponseClockForTest(virtualClock);
  mockBuckets.clear();
  mockLimitCalls.length = 0;
  mockAudit.length = 0;
  sleeps.length = 0;
  Object.assign(mockDb, {
    users: [
      { id: 'u-alice', email: EXISTING, is_deleted: false, is_email_verified: true },
      { id: 'u-gone', email: DELETED, is_deleted: true, is_email_verified: true },
    ],
    authUsers: [
      { email: EXISTING, confirmed: true },
      { email: DELETED, confirmed: true },
      { email: AUTH_ONLY, confirmed: true },
    ],
    reads: [], failUsers: false, usersLatencyMs: 25, rpcLatencyMs: 40, sends: [], sendImpl: null,
  });
});
afterAll(() => {
  __setAuthResponseClockForTest(null);
  if (savedVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = savedVercel;
});

// ═════════════════════════════════════════════════════════════════════════════
describe('P2-D magic-link: uniform response', () => {
  it('existing, non-existing and soft-deleted addresses get byte-identical status + body', async () => {
    const a = await call('magic-link', { email: EXISTING });
    const b = await call('magic-link', { email: MISSING }, '10.0.0.8');
    const c = await call('magic-link', { email: DELETED }, '10.0.0.9');
    expect(a.status).toBe(200);
    expect(wire(a)).toBe(wire(b));
    expect(wire(a)).toBe(wire(c));
    expect(a.body).toEqual(MAGIC_LINK_UNIFORM_BODY);
  });

  it('every path is padded to the minimum latency, so a hit and a miss take the same time', async () => {
    const a = await call('magic-link', { email: EXISTING });
    const b = await call('magic-link', { email: MISSING }, '10.0.0.8');
    expect(a.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    expect(b.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    expect(a.elapsed).toBe(b.elapsed);
  });

  it('constant work: both lookups run for a hit and for a miss', async () => {
    await call('magic-link', { email: EXISTING });
    const hitReads = [...mockDb.reads];
    mockDb.reads = [];
    await call('magic-link', { email: MISSING }, '10.0.0.8');
    expect(hitReads.sort()).toEqual([...mockDb.reads].sort());
    expect(hitReads).toEqual(expect.arrayContaining(['users:email', 'rpc:auth_user_confirmed']));
  });

  it('a slow email send does not delay the response (send is detached)', async () => {
    let release: () => void = () => {};
    mockDb.sendImpl = () => new Promise((r) => { release = () => r({ data: {}, error: null }); });
    const a = await call('magic-link', { email: EXISTING });
    expect(mockDb.sends).toHaveLength(1);
    expect(a.elapsed).toBe(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    release();
    await flush();
  });

  it('a lookup error and a send error both return the uniform body', async () => {
    mockDb.sendImpl = async () => ({ data: null, error: { message: 'smtp exploded' } });
    const warn = jest.spyOn(logger, 'warn');
    const a = await call('magic-link', { email: EXISTING });
    await flush();
    mockDb.failUsers = true;
    const b = await call('magic-link', { email: MISSING }, '10.0.0.8');
    expect(wire(a)).toBe(wire({ status: 200, body: MAGIC_LINK_UNIFORM_BODY } as Out));
    expect(wire(b)).toBe(wire(a));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(EXISTING);
    warn.mockRestore();
  });
});

describe('P2-D magic-link: the link is sent only to a real account', () => {
  it('an existing user gets the link (server-side send, no user creation)', async () => {
    await call('magic-link', { email: '  Alice@Example.TEST ' });
    await flush();
    expect(mockDb.sends).toEqual([{
      email: EXISTING,
      options: { shouldCreateUser: false, emailRedirectTo: 'https://app.example.test/auth/callback?mode=passwordless' },
    }]);
  });

  it('a confirmed auth identity without a public.users row still gets the link', async () => {
    await call('magic-link', { email: AUTH_ONLY });
    await flush();
    expect(mockDb.sends.map((s) => s.email)).toEqual([AUTH_ONLY]);
  });

  it('a non-existing or soft-deleted address triggers no send', async () => {
    await call('magic-link', { email: MISSING });
    await call('magic-link', { email: DELETED }, '10.0.0.8');
    await flush();
    expect(mockDb.sends).toEqual([]);
  });

  it('input validation: a missing email is a 400 before any lookup', async () => {
    const r = await call('magic-link', {});
    expect(r.status).toBe(400);
    expect(mockDb.reads).toEqual([]);
  });
});

describe('P2-D magic-link: per-IP and global limits', () => {
  it('per-IP: the 6th request from one IP is a 429 with Retry-After, and does not read the DB', async () => {
    for (let i = 0; i < 5; i++) expect((await call('magic-link', { email: MISSING })).status).toBe(200);
    mockDb.reads = [];
    const r = await call('magic-link', { email: EXISTING });
    expect(r.status).toBe(429);
    expect(r.body).toEqual(AUTH_RATE_LIMITED_BODY);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    expect(mockDb.reads).toEqual([]);
    const r2 = await call('magic-link', { email: MISSING });
    expect(wire(r2)).toBe(wire(r));
  });

  it('global (e9 2026-11-13: ALERT-ONLY): a spent shared budget never pauses sign-in links for everyone', async () => {
    mockBuckets.set(`${MAGIC_LINK_GLOBAL_LIMIT.keyPrefix}:global`, MAGIC_LINK_GLOBAL_LIMIT.limit);
    const r = await call('magic-link', { email: EXISTING }, '198.51.100.77');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(MAGIC_LINK_UNIFORM_BODY);
    expect(mockDb.sends.length).toBe(1);
  });

  it('per-EMAIL (enforcing): the 6th request for one address from fresh IPs is a 429 - identical for any address', async () => {
    const ips = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5', '198.51.100.6'];
    for (let i = 0; i < 5; i++) expect((await call('magic-link', { email: MISSING }, ips[i])).status).toBe(200);
    const blockedMissing = await call('magic-link', { email: MISSING }, ips[5]);
    for (let i = 0; i < 5; i++) await call('magic-link', { email: EXISTING }, `203.0.113.${i + 10}`);
    const blockedExisting = await call('magic-link', { email: EXISTING }, '203.0.113.99');
    expect([blockedMissing.status, blockedExisting.status]).toEqual([429, 429]);
    expect(wire(blockedMissing)).toBe(wire(blockedExisting));
  });

  it('limit order: per-IP, then the (alert-only) global, then per-email', async () => {
    await call('magic-link', { email: MISSING });
    expect(mockLimitCalls.map((c) => c.config.keyPrefix)).toEqual(['rl:auth:magic-link', 'rl:auth:magic-link:global', 'rl:auth:magic-link:email']);
    expect(mockLimitCalls[2].key).not.toContain('@'); // hashed - no raw address reaches Redis
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('P2-D check-user: uniform response', () => {
  it('existing, non-existing and soft-deleted addresses get byte-identical status + body', async () => {
    const a = await call('check-user', { email: EXISTING });
    const b = await call('check-user', { email: MISSING });
    const c = await call('check-user', { email: DELETED });
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ exists: false });
    expect(wire(a)).toBe(wire(b));
    expect(wire(a)).toBe(wire(c));
  });

  it('every path is padded to the minimum latency', async () => {
    const a = await call('check-user', { email: EXISTING });
    mockDb.usersLatencyMs = 90; // a slower miss must not show either
    const b = await call('check-user', { email: MISSING });
    expect(a.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    expect(a.elapsed).toBe(b.elapsed);
  });

  it('the audit row keeps the real outcome without the raw address', async () => {
    await call('check-user', { email: EXISTING });
    await flush();
    expect(mockAudit).toHaveLength(1);
    expect(mockAudit[0].reason).toContain('outcome=exists');
    expect(JSON.stringify(mockAudit)).not.toContain(EXISTING);
  });

  it('a DB error fails closed with a padded 500', async () => {
    mockDb.failUsers = true;
    const r = await call('check-user', { email: EXISTING });
    expect(r.status).toBe(500);
    expect(r.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
  });
});

describe('P2-D check-user: per-IP and global limits', () => {
  it('per-IP: the 21st request is a 429 with Retry-After and no DB read', async () => {
    for (let i = 0; i < 20; i++) expect((await call('check-user', { email: MISSING })).status).toBe(200);
    mockDb.reads = [];
    const r = await call('check-user', { email: EXISTING });
    expect(r.status).toBe(429);
    expect(r.body).toEqual(AUTH_RATE_LIMITED_BODY);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.elapsed).toBeGreaterThanOrEqual(AUTH_ENUMERATION_MIN_RESPONSE_MS);
    expect(mockDb.reads).toEqual([]);
  });

  it('global (ALERT-ONLY): a spent shared budget does not refuse a fresh IP', async () => {
    mockBuckets.set(`${CHECK_USER_GLOBAL_LIMIT.keyPrefix}:global`, CHECK_USER_GLOBAL_LIMIT.limit);
    const r = await call('check-user', { email: EXISTING }, '198.51.100.77');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ exists: false });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('P2-D UI contract (pages/login.tsx)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'pages/login.tsx'), 'utf8');
  const handler = src.slice(src.indexOf('async function handleMagicLink'), src.indexOf('// ── Forgot password'));

  it('the magic-link handler no longer branches on "no account" nor sends the OTP itself', () => {
    expect(handler).toContain("fetch('/api/auth/magic-link'");
    expect(handler).not.toContain('INVALID_CREDENTIALS');
    expect(handler).not.toContain('signInWithOtp');
    expect(src).not.toMatch(/No account found/);
  });

  it('the confirmation is neutral and matches the route message', () => {
    expect(src).toContain('If an account exists for');
    expect(MAGIC_LINK_UNIFORM_BODY.message).toMatch(/^If an account exists for this address/);
  });
});

describe('P2-D uniformAuthResponse helpers', () => {
  it('padToMinimumLatency does not sleep when the floor is already passed', async () => {
    const start = mockNow;
    mockNow += AUTH_ENUMERATION_MIN_RESPONSE_MS + 5;
    await padToMinimumLatency(start, virtualClock);
    expect(sleeps).toEqual([]);
  });

  it('runDetachedFromResponse hands the work to the Vercel waitUntil when present', () => {
    const waitUntil = jest.fn();
    const sym = Symbol.for('@vercel/request-context');
    const g = globalThis as any;
    const prev = g[sym];
    process.env.VERCEL = '1';
    g[sym] = { get: () => ({ waitUntil }) };
    try {
      const work = Promise.resolve();
      runDetachedFromResponse(work);
      expect(waitUntil).toHaveBeenCalledWith(work);
    } finally {
      g[sym] = prev;
      delete process.env.VERCEL;
    }
  });
});
