/**
 * DG-001 follow-up — the canonical SERP transport enforces BOTH bounds.
 *
 * THE DEFECT. `defaultTransport` passed `init.signal ?? controller.signal` to `fetch`: when a
 * Report 2 deadline was active, the deadline signal REPLACED the client's 8s per-call timeout. A
 * single stalled SerpAPI request could then hold the whole remaining 45s report budget. Before
 * DG-001, Report 1's axios call applied both (`timeout: 8000` and `signal`).
 *
 * THE FIX. The two signals are linked — `AbortSignal.any` where the runtime has it, a manual
 * equivalent otherwise — so whichever fires first aborts the request, and the body is read inside
 * the same bound.
 *
 * No test here touches a network: global `fetch` is replaced by a stub that only ever settles when
 * its signal aborts (or when a test says it may).
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/providerCredentialResolver', () => ({
  __esModule: true,
  resolveProviderCredential: async () => ({ value: 'placeholder-serp-key', source: 'env', reason: null }),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  __esModule: true,
  authorizeProviderCall: () => ({ allowed: true, killed: false, dryRun: false, reason: 'allowed', remaining: { daily: null, monthly: null } }),
  recordProviderUsage: jest.fn(async () => undefined),
}));
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  __esModule: true,
  logProviderCall: jest.fn(),
}));

import { getEventListeners } from 'events';
import {
  defaultSerpTransport,
  fetchCanonicalSerp,
  linkAbortSignals,
  SerpRequestTimeoutError,
  __linkAbortSignalsManuallyForTest as linkManually,
} from '../../services/serp/canonicalSerpClient';
import { runWithReportDeadline } from '../../services/intelligence/reportDeadlineContext';

const SERP_URL = 'https://serpapi.com/search.json?engine=google&q=k&num=10&api_key=placeholder';

type FetchInit = { signal?: AbortSignal };
const seenSignals: AbortSignal[] = [];
let realFetch: typeof globalThis.fetch;

/** A request that never answers on its own: it settles only when its signal aborts. */
function stallingFetch(url: string, init?: FetchInit): Promise<never> {
  if (!url.startsWith('https://serpapi.com/')) {
    return Promise.reject(new Error(`hermetic: ${url} is unreachable from this suite`));
  }
  const signal = init?.signal;
  if (signal) seenSignals.push(signal);
  return new Promise((_resolve, reject) => {
    if (!signal) return; // would hang forever — the tests below always expect a signal
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

beforeEach(() => {
  seenSignals.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = stallingFetch as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('the per-call timeout always applies', () => {
  it('fires with no deadline in scope (Report 1)', async () => {
    await expect(defaultSerpTransport(SERP_URL, { timeoutMs: 25 }))
      .rejects.toBeInstanceOf(SerpRequestTimeoutError);
  });

  it('STILL fires while a report deadline is active and has not expired (the regression)', async () => {
    const deadline = new AbortController(); // a 45s budget that is nowhere near expiring
    const started = Date.now();
    const attempt = defaultSerpTransport(SERP_URL, { signal: deadline.signal, timeoutMs: 25 });
    await expect(attempt).rejects.toBeInstanceOf(SerpRequestTimeoutError);
    await expect(attempt).rejects.toThrow('SerpAPI request timed out after 25ms');
    // The request was bounded by the TIMEOUT: the deadline itself never fired.
    expect(deadline.signal.aborted).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 5_000);

  it('bounds the body read too, not just the headers', async () => {
    globalThis.fetch = (async (_url: string, init?: FetchInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    })) as unknown as typeof globalThis.fetch;
    const deadline = new AbortController();
    await expect(defaultSerpTransport(SERP_URL, { signal: deadline.signal, timeoutMs: 25 }))
      .rejects.toBeInstanceOf(SerpRequestTimeoutError);
  }, 5_000);

  it('reaches the failed result through the real client, at the real 8s constant, under a deadline', async () => {
    jest.useFakeTimers();
    const deadline = new AbortController();
    const attempt = runWithReportDeadline(deadline.signal, () => fetchCanonicalSerp(
      { query: 'k', depth: 10, operation: 'search' },
      () => [],
    ));
    await jest.advanceTimersByTimeAsync(7_999);
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0].aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const result = await attempt;
    expect(result.status).toBe('failed');
    expect(result.rows).toEqual([]);
    expect(result.reason).toBe('SerpAPI request timed out after 8000ms');
    expect(deadline.signal.aborted).toBe(false);
  }, 5_000);
});

describe('the report deadline still aborts an in-flight request', () => {
  it('aborts before the per-call timeout when the deadline fires first', async () => {
    const deadline = new AbortController();
    const attempt = defaultSerpTransport(SERP_URL, { signal: deadline.signal, timeoutMs: 60_000 });
    const reason = new Error('Report generation exceeded 45000ms concurrency boundary');
    deadline.abort(reason);
    await expect(attempt).rejects.toBe(reason);
  });

  it('refuses immediately when the deadline has already expired', async () => {
    const deadline = new AbortController();
    const reason = new Error('already expired');
    deadline.abort(reason);
    await expect(defaultSerpTransport(SERP_URL, { signal: deadline.signal, timeoutMs: 60_000 }))
      .rejects.toBe(reason);
  });

  it('surfaces a deadline abort through the real client as failed, never as a result', async () => {
    const deadline = new AbortController();
    const attempt = runWithReportDeadline(deadline.signal, () => fetchCanonicalSerp(
      { query: 'k', depth: 10, operation: 'search' },
      () => [],
    ));
    await new Promise((resolve) => setImmediate(resolve));
    expect(seenSignals).toHaveLength(1);
    deadline.abort(new Error('deadline'));
    const result = await attempt;
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('deadline');
  });
});

describe.each([
  ['native (AbortSignal.any)', linkAbortSignals],
  ['manual fallback', linkManually],
] as const)('signal linking — %s', (_label, link) => {
  it('aborts when the FIRST source aborts, with that source’s reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const linked = link([a.signal, b.signal]);
    expect(linked.signal.aborted).toBe(false);
    const reason = new Error('b fired');
    b.abort(reason);
    expect(linked.signal.aborted).toBe(true);
    expect(linked.signal.reason).toBe(reason);
    a.abort(new Error('a fired later'));
    expect(linked.signal.reason).toBe(reason);
    linked.dispose();
  });

  it('is already aborted when a source already is', () => {
    const a = new AbortController();
    const reason = new Error('pre-aborted');
    a.abort(reason);
    const linked = link([new AbortController().signal, a.signal]);
    expect(linked.signal.aborted).toBe(true);
    expect(linked.signal.reason).toBe(reason);
    linked.dispose();
  });
});

describe('manual fallback hygiene', () => {
  it('detaches from a long-lived parent once disposed, so listeners never accumulate', () => {
    const parent = new AbortController();
    for (let i = 0; i < 25; i += 1) {
      const linked = linkManually([new AbortController().signal, parent.signal]);
      linked.dispose();
    }
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
  });

  it('detaches from every source once one of them fires', () => {
    const a = new AbortController();
    const b = new AbortController();
    linkManually([a.signal, b.signal]);
    a.abort();
    expect(getEventListeners(b.signal, 'abort')).toHaveLength(0);
  });
});
