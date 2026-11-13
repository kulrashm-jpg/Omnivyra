/**
 * P2 (e1, 2026-11-13; owner ruling: no CAPTCHA; e9 conditions, 05 review). POST /api/auth/signup is the ONLY
 * self-serve creator of an auth identity:
 *   - every eligibility gate runs BEFORE the identity exists - a refused attempt writes NO auth.users row;
 *   - ceilings count SUCCESSES only (refused attempts never consume them): per registrable domain 3/h + 10/day -> 429,
 *     global 200/h -> 503; burst alert at 30/h;
 *   - the identity is created via the admin API with email_confirm false, then the confirmation link is sent with
 *     shouldCreateUser:false.
 */
export {};
const mockCreateUser = jest.fn();
const mockOtp = jest.fn();
const mockRecorded: Array<[string, string]> = [];
const mockPeek: Record<string, number> = {};
const mockGate = { claimed: null as any, claimedThrows: false, identity: 'pass' as 'pass' | 'refused' | 'unavailable', mintOk: true };
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('no direct table access expected in these paths'); },
    rpc: async () => ({ data: false, error: null }),
    auth: {
      admin: { createUser: (...a: unknown[]) => mockCreateUser(...a) },
      signInWithOtp: (...a: unknown[]) => mockOtp(...a),
    },
  },
}));
jest.mock('../../services/signupIntentMint', () => ({
  lookupExistingAccount: async () => ({ kind: 'none' }),
  resolveClaimedDomainRefusal: async () => {
    if (mockGate.claimedThrows) throw new Error('CLAIMED_DOMAIN_LOOKUP_FAILED:transient');
    return mockGate.claimed;
  },
  runSignupIdentityGate: async () => (mockGate.identity === 'pass'
    ? { kind: 'pass', identity: { companyIdentityDomain: 'acme.com' }, autoApproved: false }
    : mockGate.identity === 'refused'
      ? { kind: 'refused', identity: { validationReason: 'PUBLIC_EMAIL' } }
      : { kind: 'unavailable', message: 'x', timedOut: true }),
  mintSignupIntent: async () => (mockGate.mintOk ? { ok: true, intentId: 'intent-1' } : { ok: false, stage: 'insert', error: 'x' }),
}));
jest.mock('../../../lib/auth/rateLimit', () => ({
  EMAIL_LINK_LIMIT: {},
  checkRateLimit: async (id: string, cfg: { keyPrefix: string; limit: number }) => {
    if (String(cfg.keyPrefix).includes('signup-ok')) {
      mockRecorded.push([cfg.keyPrefix, id]);
      const key = `${cfg.keyPrefix}:${id}`;
      mockPeek[key] = (mockPeek[key] ?? 0) + 1;
      return { allowed: true, remaining: Math.max(0, cfg.limit - mockPeek[key]), resetAt: 0, bypassed: false };
    }
    return { allowed: true, remaining: 4, resetAt: 0, bypassed: false };
  },
  peekRateLimit: async (id: string, cfg: { keyPrefix: string; limit: number }) => {
    const count = mockPeek[`${cfg.keyPrefix}:${id}`] ?? 0;
    return { allowed: count < cfg.limit, remaining: Math.max(0, cfg.limit - count), resetAt: 0, bypassed: false, count };
  },
}));
jest.mock('../../../lib/auth/captcha', () => ({ verifyCaptchaToken: async () => ({ ok: true }), CAPTCHA_FAILED_RESPONSE: { error: 'captcha' } }));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: jest.fn(async () => undefined), ensureSignupCorrelationId: async () => 'corr', signupRejectionEventFor: () => 'SignupRejected', requestUserAgent: () => null,
}));
jest.mock('../../services/authMetrics', () => ({ incrementAuthMetric: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://app.example.test' }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/auth/signup').default;
const { logger } = require('../../services/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

async function post(body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}
const ok = { email: 'jane@acme.com', companyName: 'Acme', password: 'correct-horse-battery' };
beforeEach(() => {
  mockCreateUser.mockReset().mockResolvedValue({ data: { user: { id: 'sb-1' } }, error: null });
  mockOtp.mockReset().mockResolvedValue({ error: null });
  mockRecorded.length = 0;
  for (const k of Object.keys(mockPeek)) delete mockPeek[k];
  Object.assign(mockGate, { claimed: null, claimedThrows: false, identity: 'pass', mintOk: true });
});

describe('order: gates BEFORE the identity exists', () => {
  it('success: identity created via the ADMIN API (unconfirmed) only after the gates + mint, then the link (no user creation)', async () => {
    const r = await post(ok);
    expect([r.statusCode, r.body]).toEqual([200, { proceed: true }]);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockCreateUser).toHaveBeenCalledWith({ email: 'jane@acme.com', password: ok.password, email_confirm: false });
    expect(mockOtp).toHaveBeenCalledWith({ email: 'jane@acme.com', options: { shouldCreateUser: false, emailRedirectTo: 'https://app.example.test/auth/callback' } });
  });

  const refusals: Array<[string, () => void, number]> = [
    ['CLAIMED_DOMAIN', () => { mockGate.claimed = { companyId: 'c1', body: { error: 'claimed', code: 'CLAIMED_DOMAIN' } }; }, 409],
    ['claimed lookup read error (fail closed)', () => { mockGate.claimedThrows = true; }, 503],
    ['identity gate refused', () => { mockGate.identity = 'refused'; }, 400],
    ['identity gate unavailable', () => { mockGate.identity = 'unavailable'; }, 503],
    ['intent mint failed', () => { mockGate.mintOk = false; }, 500],
  ];
  for (const [label, arrange, status] of refusals) {
    it(`refused (${label}) -> ${status}, NO auth identity created, NO link, NOTHING recorded against the ceilings`, async () => {
      arrange();
      const r = await post(ok);
      expect([label, r.statusCode]).toEqual([label, status]);
      expect(mockCreateUser).not.toHaveBeenCalled();
      expect(mockOtp).not.toHaveBeenCalled();
      expect(mockRecorded).toEqual([]);
    });
  }

  it('missing / short password -> 400 before anything else', async () => {
    expect((await post({ ...ok, password: undefined })).body).toMatchObject({ code: 'PASSWORD_REQUIRED' });
    expect((await post({ ...ok, password: 'short' })).body).toMatchObject({ code: 'PASSWORD_INVALID' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});

describe('success-only ceilings', () => {
  it('per registrable domain: the 4th SUCCESS in an hour from *.example.com is refused 429 (subdomains share one budget)', async () => {
    for (const email of ['a@example.com', 'b@bot1.example.com', 'c@bot2.example.com']) {
      expect((await post({ ...ok, email })).statusCode).toBe(200);
    }
    const r = await post({ ...ok, email: 'd@bot3.example.com' });
    expect([r.statusCode, r.body?.code]).toEqual([429, 'SIGNUP_DOMAIN_LIMIT']);
    expect(mockCreateUser).toHaveBeenCalledTimes(3);
  });

  it('REFUSED attempts never consume the budget (a flood of refusals cannot lock a domain out)', async () => {
    mockGate.identity = 'refused';
    for (let i = 0; i < 10; i++) await post(ok);
    mockGate.identity = 'pass';
    expect((await post(ok)).statusCode).toBe(200);
  });

  it('global hard ceiling -> 503 SIGNUP_PAUSED (retryable), no identity', async () => {
    mockPeek['rl:auth:signup-ok:global:1h:all'] = 200;
    const r = await post(ok);
    expect([r.statusCode, r.body?.code]).toEqual([503, 'SIGNUP_PAUSED']);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('burst telemetry fires once successes this hour reach the alert threshold (30)', async () => {
    mockPeek['rl:auth:signup-ok:global:1h:all'] = 29;
    await post(ok);
    expect((logger.warn as jest.Mock).mock.calls.some((c: unknown[]) => c[0] === 'auth.signup_burst')).toBe(true);
  });
});

it('an identity that already exists (unconfirmed earlier attempt) gets a fresh link, is NOT counted, and keeps its password', async () => {
  mockCreateUser.mockResolvedValueOnce({ data: null, error: { message: 'A user with this email address has already been registered' } });
  const r = await post(ok);
  expect(r.statusCode).toBe(200);
  expect(mockOtp).toHaveBeenCalledTimes(1);
  expect(mockRecorded).toEqual([]);
});

it('an admin-API failure other than "already registered" is a retryable 500 and sends nothing', async () => {
  mockCreateUser.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });
  const r = await post(ok);
  expect([r.statusCode, r.body?.code]).toEqual([500, 'IDENTITY_CREATE_FAILED']);
  expect(mockOtp).not.toHaveBeenCalled();
});
