/**
 * WS1-E6-T005 — retry + timeout metric adoption gate.
 *
 * The incident class this closes: a provider TIMEOUT was enforced but counted
 * nowhere. `ai.gateway.retry` is emitted only when an error is actually
 * retried, and classifyProviderError marks timeouts
 * `retryable: true, rateLimit: false` — with AI_GATEWAY_RETRY_TRANSIENT off by
 * default that predicate is false, so a timing-out provider produced no metric
 * at all. Operators could not distinguish "provider slow/timing out" from
 * "provider healthy but idle".
 *
 * Repository evidence recorded by RF-08 (see the work package report):
 * retry and timeout are ALREADY implemented per domain — the AI path has its
 * own retry loop and computed per-operation timeouts, and safeFetch has undici
 * timeouts plus `ssrf.request.timeout{host}`. Layering
 * lib/resilience/{retryPolicy,timeouts} on top would multiply retry attempts
 * and duplicate timeout enforcement, so this package closes the measurable
 * exit criterion instead of introducing a second mechanism.
 *
 * Behaviour is asserted against the real classifier; adoption from source.
 * No network, no Redis, no database.
 */
import fs from 'fs';
import path from 'path';
import { classifyProviderError } from '../../services/ai/safety/providerRetryPolicy';

const REPO = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('timeout classification (why the gap existed)', () => {
  const timeoutErr = () => Object.assign(new Error('provider timed out after 240000ms'), { code: 'ETIMEDOUT' });

  it('classifies a provider timeout as class "timeout"', () => {
    expect(classifyProviderError(timeoutErr()).class).toBe('timeout');
  });

  it('a timeout is NOT a rate-limit — so the retry counter never fired for it', () => {
    // This is precisely why the metric was missing: the retry counter is
    // guarded by `rateLimit || (transientEnabled && retryable)`, and
    // transientEnabled defaults false.
    const c = classifyProviderError(timeoutErr());
    expect({ rateLimit: c.rateLimit, retryable: c.retryable }).toEqual({
      rateLimit: false,
      retryable: true,
    });
  });

  it('rate-limit remains distinct, so the new counter does not blur classes', () => {
    const c = classifyProviderError(Object.assign(new Error('429'), { status: 429 }));
    expect(c.class).toBe('rate_limit');
  });
});

describe('AI provider metric adoption', () => {
  const src = () => read('backend/services/aiGatewayProvidersRetry.ts');

  it('emits a per-provider outcome counter at the classification point', () => {
    expect(src()).toMatch(
      /recordRawCounter\('ai\.gateway\.provider_error',\s*1,\s*\{\s*provider,\s*class: __cls\.class\s*\}\)/,
    );
  });

  it('emits a dedicated per-provider timeout counter', () => {
    expect(src()).toMatch(/recordRawCounter\('ai\.gateway\.timeout',\s*1,\s*\{\s*provider\s*\}\)/);
  });

  it('emits at the SINGLE classification point — no double counting', () => {
    // classifyProviderError is called exactly once per attempt; instrumenting
    // the error CONSTRUCTOR instead would have double-counted, because the
    // catch paths in aiGatewayCore re-wrap an already-fired timeout.
    const occurrences = (src().match(/classifyProviderError\(/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('metric emission is fail-safe', () => {
    expect(src()).toMatch(/catch \{ \/\* fail-safe: metrics must never break a provider call \*\/ \}/);
  });

  it('preserves the pre-existing retry counter', () => {
    expect(src()).toMatch(/recordRawCounter\('ai\.gateway\.retry',\s*1,\s*\{\s*provider,\s*class: __cls\.class\s*\}\)/);
  });
});

describe('HTTP path already satisfies the criterion', () => {
  it('safeFetch emits a per-host timeout counter', () => {
    expect(read('lib/security/safeFetch.ts')).toMatch(
      /countEvent\('timeout',\s*host\)/,
    );
    expect(read('lib/security/safeFetch.ts')).toMatch(
      /recordRawCounter\(`ssrf\.request\.\$\{name\}`,\s*1,\s*\{ host \}\)/,
    );
  });

  it('safeFetch enforces a timeout it can count', () => {
    expect(read('lib/security/safeFetch.ts')).toMatch(/const DEFAULT_TIMEOUT_MS = /);
  });
});

describe('no second retry or timeout mechanism was introduced', () => {
  it('the AI path did NOT adopt lib/resilience retry or timeouts', () => {
    // Layering these on the existing retry loop would multiply upstream calls
    // (outer attempts x inner attempts) — retry amplification against a
    // provider that is already failing. See RF-08.
    const src = read('backend/services/aiGatewayProvidersRetry.ts');
    expect({
      retry: /resilience\/retryPolicy/.test(src),
      timeouts: /resilience\/timeouts/.test(src),
    }).toEqual({ retry: false, timeouts: false });
  });

  it('safeFetch did NOT adopt a second timeout mechanism', () => {
    expect(/resilience\/timeouts/.test(read('lib/security/safeFetch.ts'))).toBe(false);
  });
});
