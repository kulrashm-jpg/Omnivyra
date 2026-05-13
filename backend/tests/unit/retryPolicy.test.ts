/**
 * Pin the retry policy's behavioral guarantees:
 *   1. Fatal codes NEVER retry — no second attempt fires.
 *   2. Retryable codes back off exponentially up to the budget.
 *   3. Retry-After hint becomes a lower bound on the next delay.
 *   4. Total budget is enforced even if attempts remain.
 *   5. classifyFetchOutcome maps envelopes correctly.
 */

import {
  createRetryPolicy,
  runWithRetry,
  classifyFetchOutcome,
  type AttemptOutcome,
} from '../../../lib/auth/retryPolicy';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';

function makeAttempts(outcomes: AttemptOutcome<unknown>[]) {
  let i = 0;
  return async () => outcomes[Math.min(i++, outcomes.length - 1)];
}

describe('runWithRetry', () => {
  it('returns success immediately when the first attempt succeeds', async () => {
    const policy = createRetryPolicy();
    const result = await runWithRetry(policy, {
      label: 'test',
      attempt: makeAttempts([{ ok: true, value: 'done' }]),
      sleep: async () => {},
    });
    expect(result.outcome).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.value).toBe('done');
  });

  it('NEVER retries a fatal code — even with attempts remaining', async () => {
    const policy = createRetryPolicy({ maxAttempts: 5 });
    let calls = 0;
    const result = await runWithRetry(policy, {
      label: 'test',
      attempt: async () => {
        calls += 1;
        return { ok: false, fatalCode: AUTH_ERROR_CODE.INVALID_SESSION };
      },
      sleep: async () => {},
    });
    expect(result.outcome).toBe('fatal');
    expect(result.fatalCode).toBe(AUTH_ERROR_CODE.INVALID_SESSION);
    expect(calls).toBe(1);
  });

  it('retries retryable failures up to maxAttempts, then reports exhausted', async () => {
    const policy = createRetryPolicy({ maxAttempts: 3 });
    let calls = 0;
    const result = await runWithRetry(policy, {
      label: 'test',
      attempt: async () => {
        calls += 1;
        return { ok: false, retryableReason: 'http_503' };
      },
      sleep: async () => {},
    });
    expect(result.outcome).toBe('exhausted');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('honors the Retry-After hint as a lower bound on the next delay', async () => {
    const policy = createRetryPolicy({
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 100, // forces base delay to be small
      randomMs: () => 0, // jitter zero → without hint, delay would be 0
    });
    const sleeps: number[] = [];
    await runWithRetry(policy, {
      label: 'test',
      attempt: makeAttempts([
        { ok: false, retryableReason: 'srv', retryAfterMs: 1500 },
        { ok: true, value: 1 },
      ]),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(sleeps).toEqual([1500]);
  });

  it('enforces totalBudgetMs even if attempts remain', async () => {
    let now = 0;
    const policy = createRetryPolicy({
      maxAttempts: 10,
      baseDelayMs: 50,
      totalBudgetMs: 200,
      nowMs: () => now,
      randomMs: () => 0,
    });
    const result = await runWithRetry(policy, {
      label: 'test',
      attempt: async () => {
        now += 80;
        return { ok: false, retryableReason: 'srv' };
      },
      sleep: async () => {},
    });
    expect(result.outcome).toBe('budget_exceeded');
    // Must have stopped before exhausting all attempts.
    expect(result.attempts).toBeLessThan(10);
  });
});

describe('classifyFetchOutcome', () => {
  function fakeResponse(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  it('marks a fatal envelope as fatal', () => {
    const out = classifyFetchOutcome({
      res: fakeResponse(401),
      body: {
        error: 'expired', code: 'INVALID_SESSION',
        category: 'session', fatal: true, retryable: false,
      },
    });
    expect(out.fatalCode).toBe(AUTH_ERROR_CODE.INVALID_SESSION);
  });

  it('marks a retryable envelope as retryable', () => {
    const out = classifyFetchOutcome({
      res: fakeResponse(503),
      body: {
        error: 'schema', code: 'SCHEMA_MISMATCH',
        category: 'schema', fatal: false, retryable: true,
      },
    });
    expect(out.retryableReason).toBe('schema');
    expect(out.fatalCode).toBeUndefined();
  });

  it('falls back on HTTP status when no envelope is present', () => {
    expect(classifyFetchOutcome({ res: fakeResponse(500), body: {} }).retryableReason).toBe('http_500');
    expect(classifyFetchOutcome({ res: fakeResponse(429), body: {} }).retryableReason).toBe('http_429');
    expect(classifyFetchOutcome({ res: fakeResponse(401), body: {} }).fatalCode).toBe(AUTH_ERROR_CODE.INVALID_SESSION);
    expect(classifyFetchOutcome({ res: fakeResponse(400), body: {} }).retryableReason).toBe('http_400');
  });
});
