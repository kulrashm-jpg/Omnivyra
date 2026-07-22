/**
 * WAVE-1D-001 — Provider Gateway retry-policy + error-normalization tests.
 * Pure, deterministic rules the hardened gateway adopts.
 */
import {
  classifyProviderError, computeBackoffMs, normalizeProviderError, AiError,
} from '../../services/ai/safety';

describe('WAVE-1D-001 §C1 — classifyProviderError (retry eligibility)', () => {
  it('rate-limit 429/529 → retryable + rateLimit', () => {
    for (const status of [429, 529]) {
      const c = classifyProviderError({ status });
      expect(c.class).toBe('rate_limit');
      expect(c.retryable).toBe(true);
      expect(c.rateLimit).toBe(true);
    }
  });
  it('transient 5xx → retryable server_error (not rateLimit)', () => {
    const c = classifyProviderError({ status: 503 });
    expect(c.class).toBe('server_error');
    expect(c.retryable).toBe(true);
    expect(c.rateLimit).toBe(false);
  });
  it('network + timeout → retryable', () => {
    expect(classifyProviderError({ code: 'ECONNRESET' }).retryable).toBe(true);
    expect(classifyProviderError(Object.assign(new Error('timed out'), { killed: true })).class).toBe('timeout');
    expect(classifyProviderError({ killed: true }).retryable).toBe(true);
  });
  it('auth 401/403 and validation 400/422 → NEVER retryable', () => {
    expect(classifyProviderError({ status: 401 }).retryable).toBe(false);
    expect(classifyProviderError({ status: 403 }).class).toBe('auth');
    expect(classifyProviderError({ status: 422 }).retryable).toBe(false);
    expect(classifyProviderError({ status: 400 }).class).toBe('validation');
  });
  it('aborts → never retryable', () => {
    expect(classifyProviderError({ name: 'AbortError' }).retryable).toBe(false);
    expect(classifyProviderError({ code: 'PROVIDER_ABORTED' }).class).toBe('aborted');
  });
  it('unknown → not retryable (safe default)', () => {
    expect(classifyProviderError(new Error('???')).retryable).toBe(false);
  });
});

describe('WAVE-1D-001 — computeBackoffMs (deterministic, bounded, jittered)', () => {
  it('grows exponentially and is bounded by maxMs', () => {
    const noJit = { jitter: false as const };
    expect(computeBackoffMs(1, noJit)).toBe(2000);
    expect(computeBackoffMs(2, noJit)).toBe(4000);
    expect(computeBackoffMs(3, noJit)).toBe(8000);
    expect(computeBackoffMs(10, { ...noJit, maxMs: 30000 })).toBe(30000); // capped
  });
  it('with jitter stays within [raw/2, raw] and never exceeds maxMs', () => {
    for (let i = 0; i < 50; i++) {
      const v = computeBackoffMs(1);          // raw=2000 → [1000,2000]
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(2000);
    }
    expect(computeBackoffMs(20, { maxMs: 5000 })).toBeLessThanOrEqual(5000);
  });
});

describe('WAVE-1D-001 §C6/E1 — normalizeProviderError → canonical AiError', () => {
  it('maps timeout → GATEWAY_TIMEOUT (retryable, user-safe)', () => {
    const e = normalizeProviderError(Object.assign(new Error('timed out'), { killed: true }), { provider: 'openai' });
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('GATEWAY_TIMEOUT');
    expect(e.retryable).toBe(true);
    expect(e.userMessage).not.toMatch(/openai|provider=|class=|status=/i); // no internals/provider leak
    expect(e.userMessage).toMatch(/try again/i); // canned, user-safe
    expect(e.devDetail).toMatch(/provider=openai/);
  });
  it('maps rate-limit / auth / validation to normalized codes', () => {
    expect(normalizeProviderError({ status: 429 }).retryable).toBe(true);
    expect(normalizeProviderError({ status: 401 }).retryable).toBe(false);
    expect(normalizeProviderError({ status: 422 }).code).toBe('VALIDATION_REJECTED');
  });
  it('no provider-specific exception escapes — everything becomes AiError', () => {
    for (const err of [new Error('weird'), { status: 500 }, { code: 'ECONNREFUSED' }, 'string error', null]) {
      expect(normalizeProviderError(err)).toBeInstanceOf(AiError);
    }
  });
});
