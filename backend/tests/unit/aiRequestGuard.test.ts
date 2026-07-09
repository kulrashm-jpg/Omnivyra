/**
 * HARDEN-006 — centralized AI protection framework tests.
 *
 * Drives guardAiRequest with a mocked distributed limiter + request context so
 * each layer (validation, burst, per-user/company/operation/provider/IP rate
 * limits, exemptions, fail-open) is exercised deterministically.
 */

// ── Mock the distributed sliding-window limiter ──
const mockCheckRateLimit = jest.fn();
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));

// ── Mock the request context (identity source) ──
let mockCtx: { userId?: string; orgId?: string } = {};
jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => mockCtx,
}));

// Silence observability + logger.
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { guardAiRequest, AiGuardError, providerFromModel } from '../../services/ai/aiRequestGuard';

const ENV_KEYS = [
  'AI_GUARD_ENABLED', 'AI_MAX_PROMPT_CHARS', 'AI_MAX_MESSAGES', 'AI_MAX_TOKEN_ESTIMATE',
  'AI_MAX_ATTACHMENTS', 'AI_MAX_IMAGES', 'AI_RATE_USER_PER_MIN', 'AI_RATE_USER_PER_HOUR',
  'AI_RATE_COMPANY_PER_MIN', 'AI_RATE_COMPANY_PER_HOUR', 'AI_RATE_OP_PER_MIN',
  'AI_RATE_PROVIDER_PER_MIN', 'AI_RATE_IP_PER_MIN', 'AI_BURST_USER_PER_10S', 'AI_GUARD_EXEMPT_ORGS',
];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  jest.clearAllMocks();
  mockCtx = {};
});

/** Default: every layer allows. */
function allowAll() {
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 10, resetAt: Math.floor(Date.now() / 1000) + 60, bypassed: false });
}
/** Block only the layer whose keyPrefix contains `needle`. */
function blockLayer(needle: string) {
  mockCheckRateLimit.mockImplementation((_id: string, cfg: { keyPrefix: string }) =>
    Promise.resolve(
      cfg.keyPrefix.includes(needle)
        ? { allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 30, bypassed: false }
        : { allowed: true, remaining: 5, resetAt: Math.floor(Date.now() / 1000) + 60, bypassed: false },
    ),
  );
}

const msg = (content: string) => [{ role: 'user', content }];

describe('request validation (Phase 6) — applies to everyone, no limiter needed', () => {
  it('rejects an oversized prompt with 413', async () => {
    process.env.AI_MAX_PROMPT_CHARS = '100';
    allowAll();
    await expect(guardAiRequest({ operation: 'blogGeneration', userId: 'u1', messages: msg('x'.repeat(200)) }))
      .rejects.toMatchObject({ code: 'AI_PROMPT_TOO_LARGE', status: 413 });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it('rejects too many messages with 413', async () => {
    process.env.AI_MAX_MESSAGES = '2';
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: [msg('a')[0], msg('b')[0], msg('c')[0]] }))
      .rejects.toMatchObject({ code: 'AI_REQUEST_TOO_MANY_MESSAGES', status: 413 });
  });

  it('rejects an oversized token estimate with 413', async () => {
    process.env.AI_MAX_TOKEN_ESTIMATE = '10'; // ~40 chars
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('x'.repeat(100)) }))
      .rejects.toMatchObject({ code: 'AI_CONTEXT_TOO_LARGE', status: 413 });
  });

  it('rejects too many attachments / images', async () => {
    process.env.AI_MAX_ATTACHMENTS = '2';
    process.env.AI_MAX_IMAGES = '1';
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('hi'), attachmentCount: 5 }))
      .rejects.toMatchObject({ code: 'AI_TOO_MANY_ATTACHMENTS', status: 413 });
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('hi'), imageCount: 5 }))
      .rejects.toMatchObject({ code: 'AI_TOO_MANY_IMAGES', status: 413 });
  });

  it('validation applies even to exempt orgs and admins', async () => {
    process.env.AI_MAX_PROMPT_CHARS = '10';
    process.env.AI_GUARD_EXEMPT_ORGS = 'co-vip';
    await expect(guardAiRequest({ operation: 'chat', companyId: 'co-vip', messages: msg('x'.repeat(50)) }))
      .rejects.toMatchObject({ code: 'AI_PROMPT_TOO_LARGE' });
    await expect(guardAiRequest({ operation: 'chat', isAdmin: true, messages: msg('x'.repeat(50)) }))
      .rejects.toMatchObject({ code: 'AI_PROMPT_TOO_LARGE' });
  });
});

describe('layered rate limits (Phase 3)', () => {
  it('allows a normal request through every layer', async () => {
    allowAll();
    mockCtx = { userId: 'u1', orgId: 'co1' };
    await expect(guardAiRequest({ operation: 'blogGeneration', provider: 'openai', messages: msg('hello') })).resolves.toBeUndefined();
    // user(min+hr) + company(min+hr) + operation + provider = 6 layers (+burst) checked.
    const prefixes = mockCheckRateLimit.mock.calls.map((c) => (c[1] as { keyPrefix: string }).keyPrefix);
    expect(prefixes).toEqual(expect.arrayContaining(['ai:burst:user', 'ai:rl:user:min', 'ai:rl:user:hr', 'ai:rl:co:min', 'ai:rl:co:hr', 'ai:rl:op:min', 'ai:rl:prov:min']));
  });

  it('blocks on the per-user minute limit → 429 with Retry-After', async () => {
    blockLayer('ai:rl:user:min');
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', status: 429, layer: 'user_min' });
  });

  it('blocks on the per-company limit (shared across users)', async () => {
    blockLayer('ai:rl:co:min');
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', companyId: 'co1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'company_min' });
  });

  it('blocks on the per-operation limit', async () => {
    blockLayer('ai:rl:op:min');
    await expect(guardAiRequest({ operation: 'reportGeneration', userId: 'u1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'operation_min' });
  });

  it('blocks on the per-provider limit', async () => {
    blockLayer('ai:rl:prov:min');
    await expect(guardAiRequest({ operation: 'chat', provider: 'anthropic', userId: 'u1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'provider_min' });
  });

  it('blocks on the per-IP limit for identity-light routes', async () => {
    blockLayer('ai:rl:ip:min');
    await expect(guardAiRequest({ operation: 'chat.gpt', provider: 'openai', ip: '1.2.3.4', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'ip_min' });
  });
});

describe('burst protection (Phase 4)', () => {
  it('blocks a burst spike per user → 429 AI_BURST_LIMIT', async () => {
    blockLayer('ai:burst:user');
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_BURST_LIMIT', status: 429, layer: 'burst_user' });
  });
});

describe('exemptions + toggle (Phase 10)', () => {
  it('exempt org bypasses rate/burst (but not validation)', async () => {
    process.env.AI_GUARD_EXEMPT_ORGS = 'co-vip, co-2';
    blockLayer('ai:rl:user:min'); // would block a normal user
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', companyId: 'co-vip', messages: msg('hi') })).resolves.toBeUndefined();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it('admin context bypasses rate/burst', async () => {
    blockLayer('ai:burst:user');
    await expect(guardAiRequest({ operation: 'chat', userId: 'admin', isAdmin: true, messages: msg('hi') })).resolves.toBeUndefined();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it('AI_GUARD_ENABLED=0 disables all checks', async () => {
    process.env.AI_GUARD_ENABLED = '0';
    process.env.AI_MAX_PROMPT_CHARS = '1';
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('x'.repeat(999)) })).resolves.toBeUndefined();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe('trusted internal/background generation (PROD-001 calibration)', () => {
  it('skips user-facing layers (no userId + no ip is inferred as background)', async () => {
    allowAll();
    // Worker job: no request-context identity, explicit companyId (the tenant the
    // batch belongs to). company/user/burst/ip layers must NOT be checked.
    await expect(guardAiRequest({ operation: 'campaignGeneration', provider: 'anthropic', companyId: 'co1', messages: msg('hi') }))
      .resolves.toBeUndefined();
    const prefixes = mockCheckRateLimit.mock.calls.map((c) => (c[1] as { keyPrefix: string }).keyPrefix);
    expect(prefixes).toEqual(expect.arrayContaining(['ai:rl:op:min', 'ai:rl:prov:min']));
    expect(prefixes).not.toContain('ai:rl:co:min');
    expect(prefixes).not.toContain('ai:rl:user:min');
    expect(prefixes).not.toContain('ai:burst:user');
  });

  it('a background batch is NOT throttled by the per-company cap', async () => {
    blockLayer('ai:rl:co:min'); // would block an interactive tenant
    await expect(guardAiRequest({ operation: 'blogGeneration', companyId: 'co1', messages: msg('hi') }))
      .resolves.toBeUndefined();
  });

  it('provider protection STILL applies to background (per-operation surge cap)', async () => {
    blockLayer('ai:rl:op:min');
    await expect(guardAiRequest({ operation: 'reportGeneration', companyId: 'co1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'operation_min' });
  });

  it('request validation STILL applies to background', async () => {
    process.env.AI_MAX_PROMPT_CHARS = '10';
    await expect(guardAiRequest({ operation: 'blogGeneration', companyId: 'co1', messages: msg('x'.repeat(50)) }))
      .rejects.toMatchObject({ code: 'AI_PROMPT_TOO_LARGE', status: 413 });
  });

  it('explicit background:true exempts user-facing layers even with a userId present', async () => {
    blockLayer('ai:rl:user:min'); // would block a normal interactive user
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', companyId: 'co1', background: true, messages: msg('hi') }))
      .resolves.toBeUndefined();
  });

  it('an interactive request (userId present, not background) keeps full user-facing limits', async () => {
    blockLayer('ai:rl:co:min');
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', companyId: 'co1', messages: msg('hi') }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT', layer: 'company_min' });
  });
});

describe('fail-open (Phase 7 resilience)', () => {
  it('a limiter error never blocks a legitimate request', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('redis down'));
    await expect(guardAiRequest({ operation: 'chat', userId: 'u1', messages: msg('hi') })).resolves.toBeUndefined();
  });
});

describe('identity resolution + concurrency', () => {
  it('falls back to request-context userId/orgId when not passed', async () => {
    allowAll();
    mockCtx = { userId: 'ctx-user', orgId: 'ctx-org' };
    await guardAiRequest({ operation: 'chat', messages: msg('hi') });
    const ids = mockCheckRateLimit.mock.calls.map((c) => c[0]);
    expect(ids).toContain('ctx-user');
    expect(ids).toContain('ctx-org');
  });

  it('handles many parallel requests without cross-contamination', async () => {
    allowAll();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => guardAiRequest({ operation: 'chat', userId: `u${i}`, messages: msg('hi') })),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

describe('providerFromModel', () => {
  it('maps model names to provider buckets', () => {
    expect(providerFromModel('gpt-4o-mini')).toBe('openai');
    expect(providerFromModel('o1-preview')).toBe('openai');
    expect(providerFromModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(providerFromModel('gemini-1.5-pro')).toBe('gemini');
    expect(providerFromModel('mistral-large')).toBe('other');
    expect(providerFromModel(null)).toBe('other');
  });
});
