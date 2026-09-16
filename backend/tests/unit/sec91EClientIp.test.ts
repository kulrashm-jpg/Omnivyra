/**
 * STEP 3AH-91 SEC-E2 — IP-keyed rate limits use the platform-trusted client IP.
 *
 * The routes took the FIRST X-Forwarded-For hop, which a client controls unless
 * the platform overwrites the header. getTrustedClientIp trusts forwarding
 * headers only where the platform sets them (Vercel) or where the operator
 * declared its proxies (TRUSTED_PROXY_HOPS); otherwise it uses the socket peer.
 *
 * The route tests stop at authentication (the rate limit runs first), so no
 * credit grant or invitation code is reached.
 */
const mockCheckRateLimit = jest.fn(async (..._a: unknown[]) => ({ allowed: true, remaining: 1, resetAt: 0, bypassed: false }));
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  ONBOARDING_COMPLETE_LIMIT: { keyPrefix: 'rl:onboarding', limit: 5, windowSecs: 3600, sensitive: true },
  ONBOARDING_UID_LIMIT: { keyPrefix: 'rl:uid:onboarding', limit: 3, windowSecs: 3600, sensitive: true },
  LOGIN_LIMIT: { keyPrefix: 'rl:login', limit: 10, windowSecs: 900, sensitive: true },
  INVITE_UID_LIMIT: { keyPrefix: 'rl:uid:invite', limit: 10, windowSecs: 3600, sensitive: true },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: null, error: 'NO_TOKEN' }),
}));
jest.mock('../../services/domainEligibilityService', () => ({ checkDomainEligibility: jest.fn(), isNonWorkEmailDomain: jest.fn() }));
jest.mock('../../../lib/auth/domainEligibilityModel', () => ({ reviewableResults: jest.fn() }));
jest.mock('../../services/initialFreeCreditService', () => ({
  grantInitialFreeCredit: jest.fn(), INITIAL_FREE_CREDIT_CATEGORY: 'x', INITIAL_FREE_CREDIT_DEFAULT: 0, INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT: 0,
}));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: jest.fn(), ensureSignupCorrelationId: jest.fn(), requestUserAgent: jest.fn(),
}));
jest.mock('../../services/invitationService', () => ({ createAndSendInvitation: jest.fn() }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));

import { getTrustedClientIp, normaliseIp } from '../../../lib/security/clientIp';
import completeHandler from '../../../pages/api/onboarding/complete';
import inviteHandler from '../../../pages/api/team/invite';

const ENV = ['VERCEL', 'TRUSTED_PROXY_HOPS'];
const prior: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { prior[k] = process.env[k]; delete process.env[k]; }
  mockCheckRateLimit.mockClear();
});
afterEach(() => {
  for (const k of ENV) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
});

const SPOOF = '6.6.6.6';
const reqWith = (headers: Record<string, string>, peer = '10.1.2.3') => ({ headers, socket: { remoteAddress: peer } });

describe('getTrustedClientIp', () => {
  it('off-platform, a client-supplied X-Forwarded-For is ignored (socket peer wins)', () => {
    expect(getTrustedClientIp(reqWith({ 'x-forwarded-for': `${SPOOF}, 7.7.7.7` }, '198.51.100.9'))).toBe('198.51.100.9');
  });
  it('on Vercel, the edge-set x-real-ip is used even if XFF is also present', () => {
    process.env.VERCEL = '1';
    expect(getTrustedClientIp(reqWith({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': `${SPOOF}` }))).toBe('203.0.113.5');
  });
  it('on Vercel without x-real-ip, the Vercel-overwritten forwarding headers are used', () => {
    process.env.VERCEL = '1';
    expect(getTrustedClientIp(reqWith({ 'x-vercel-forwarded-for': '203.0.113.6' }))).toBe('203.0.113.6');
    expect(getTrustedClientIp(reqWith({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });
  it('behind N declared proxies, the address appended by the outermost proxy is used', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(getTrustedClientIp(reqWith({ 'x-forwarded-for': `${SPOOF}, 203.0.113.8` }))).toBe('203.0.113.8');
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(getTrustedClientIp(reqWith({ 'x-forwarded-for': `${SPOOF}, 203.0.113.8, 10.0.0.2` }))).toBe('203.0.113.8');
  });
  it('garbage is never used as a rate-limit key', () => {
    process.env.VERCEL = '1';
    expect(getTrustedClientIp(reqWith({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': 'also bad' }, '::ffff:192.0.2.1'))).toBe('192.0.2.1');
    expect(getTrustedClientIp({ headers: {}, socket: null })).toBe('unknown');
  });
  it('normaliseIp handles ports and brackets', () => {
    expect(normaliseIp('192.0.2.1:443')).toBe('192.0.2.1');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normaliseIp('evil')).toBeNull();
  });
});

async function call(handler: (req: any, res: any) => unknown, headers: Record<string, string>, peer: string) {
  const out = { status: 0 };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json() { return this; }, setHeader() { return this; }, end() { return this; },
    getHeader() { return undefined; }, on() { return this; }, once() { return this; },
  };
  await handler({ method: 'POST', headers, body: {}, query: {}, url: '/api/x', socket: { remoteAddress: peer } }, res);
  return out;
}

describe.each([
  ['onboarding/complete', () => completeHandler],
  ['team/invite', () => inviteHandler],
])('%s keys its IP rate limit on the trusted client IP', (_name, get) => {
  it('a spoofed X-Forwarded-For does not choose the bucket (off-platform)', async () => {
    const out = await call(get(), { 'x-forwarded-for': SPOOF }, '198.51.100.20');
    expect(out.status).toBe(401); // rate limit ran first, then auth refused
    const ids = mockCheckRateLimit.mock.calls.map((c) => c[0]);
    expect(ids[0]).toBe('198.51.100.20');
    expect(ids).not.toContain(SPOOF);
  });
  it('on Vercel the edge-provided client IP is the bucket', async () => {
    process.env.VERCEL = '1';
    await call(get(), { 'x-real-ip': '203.0.113.30', 'x-forwarded-for': '203.0.113.30' }, '10.0.0.1');
    expect(mockCheckRateLimit.mock.calls[0][0]).toBe('203.0.113.30');
  });
});
