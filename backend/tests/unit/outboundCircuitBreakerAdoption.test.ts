/**
 * WS1-E6-T004 — outbound circuit breaker adoption gate.
 *
 * The incident class: lib/resilience/circuitBreaker existed but protected only
 * the Redis client, so a flapping upstream (an AI provider, a social API, a
 * customer's website) was retried indefinitely with no circuit to open. Every
 * caller paid full latency and full quota on a provider that was already down.
 *
 * Adoption is at SEAMS, not call sites:
 *   HTTP    — lib/security/safeFetch, keyed per host. One wrap covers all 66
 *             consumers, and the breaker sits INSIDE the SSRF/DNS validation
 *             so an open circuit can never relax a security check.
 *   AI      — the single `dispatch` arrow in aiGatewayProvidersRetry, keyed per
 *             provider. Covers primary, retry and cross-provider fallback.
 *   Publish — the LinkedIn adapters, which issue raw fetch (binary streaming +
 *             LinkedIn-issued upload URLs) and so cannot route via safeFetch.
 *
 * The behavioural half drives a real breaker to OPEN and back — the "chaos run
 * proves open circuit" verification this package specifies. No network, no
 * Redis, no database.
 */
import fs from 'fs';
import path from 'path';
import {
  getOrCreateCircuitBreaker,
  resetAllCircuitBreakers,
  CircuitState,
  CircuitBreakerOpenError,
} from '../../../lib/resilience/circuitBreaker';

const REPO = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('circuit breaker behaviour (chaos)', () => {
  beforeEach(() => resetAllCircuitBreakers());

  it('opens after sustained failure and then short-circuits', async () => {
    const cb = getOrCreateCircuitBreaker('test:chaos-open', {
      failureThreshold: 3,
      minimumRequestsBeforeTrigger: 1,
      timeout: 10_000,
    });
    const boom = () => Promise.reject(new Error('upstream down'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(boom)).rejects.toThrow();
    }
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Once OPEN the upstream must not be touched at all.
    let reached = false;
    await expect(
      cb.call(async () => {
        reached = true;
        return 'should not run';
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(reached).toBe(false);
  });

  it('stays closed for a healthy upstream', async () => {
    const cb = getOrCreateCircuitBreaker('test:chaos-healthy', {
      failureThreshold: 3,
      minimumRequestsBeforeTrigger: 1,
    });
    for (let i = 0; i < 10; i++) {
      await expect(cb.call(async () => 'ok')).resolves.toBe('ok');
    }
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('isolates keys — one failing upstream cannot open another', async () => {
    // This is why the seams key per host / per provider rather than using one
    // global breaker: a sick provider must not shed traffic for a healthy one.
    const sick = getOrCreateCircuitBreaker('test:sick', { failureThreshold: 2, minimumRequestsBeforeTrigger: 1 });
    const well = getOrCreateCircuitBreaker('test:well', { failureThreshold: 2, minimumRequestsBeforeTrigger: 1 });
    for (let i = 0; i < 2; i++) {
      await expect(sick.call(() => Promise.reject(new Error('x')))).rejects.toThrow();
    }
    expect(sick.getState()).toBe(CircuitState.OPEN);
    expect(well.getState()).toBe(CircuitState.CLOSED);
    await expect(well.call(async () => 'fine')).resolves.toBe('fine');
  });

  it('does not open a low-volume upstream (minimumRequestsBeforeTrigger)', async () => {
    // Both production seams set this to 20 so a rarely-used host or operation
    // behaves exactly as it did before this package.
    const cb = getOrCreateCircuitBreaker('test:low-volume', {
      failureThreshold: 3,
      minimumRequestsBeforeTrigger: 20,
    });
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(new Error('x')))).rejects.toThrow();
    }
    expect(cb.getState()).not.toBe(CircuitState.OPEN);
  });
});

describe('seam adoption', () => {
  it('HTTP: safeFetch wraps the network call per host', () => {
    const src = read('lib/security/safeFetch.ts');
    expect(src).toMatch(/getOrCreateCircuitBreaker\(`outbound:\$\{host\}`/);
    expect(src).toMatch(/outboundBreakerFor\(host\)\.call\(/);
  });

  it('HTTP: the breaker wraps ONLY the network call, never the SSRF check', () => {
    // validateOutboundUrl + resolveAndValidate must run before the breaker on
    // every hop, so an open circuit can never be a path to an unvalidated URL.
    const src = read('lib/security/safeFetch.ts');
    const validateAt = src.indexOf('const check = validateOutboundUrl(currentUrl, policy)');
    const breakerAt = src.indexOf('outboundBreakerFor(host).call(');
    expect(validateAt).toBeGreaterThan(-1);
    expect(breakerAt).toBeGreaterThan(validateAt);
  });

  it('AI: the single dispatch arrow is wrapped per provider', () => {
    const src = read('backend/services/aiGatewayProvidersRetry.ts');
    expect(src).toMatch(/aiProviderBreakerFor\(p\)\.call\(/);
    expect(src).toMatch(/getOrCreateCircuitBreaker\(`ai-provider:\$\{provider\}`/);
  });

  it('Publish: LinkedIn adapters route raw fetch through the breaker', () => {
    expect(read('backend/adapters/linkedinAdapter.ts')).toMatch(
      /outboundBreakerFor\('api\.linkedin\.com'\)\.call\(/,
    );
    const media = read('backend/adapters/linkedin/linkedinMediaUpload.ts');
    expect(media).toMatch(/outboundBreakerFor\(new URL\(url\)\.hostname\)\.call\(/);
    // No raw `await fetch(` may remain on this publish path.
    expect(media).not.toMatch(/await fetch\(/);
  });
});

describe('no second implementation path', () => {
  it('every seam uses the SAME breaker module', () => {
    for (const rel of [
      'lib/security/safeFetch.ts',
      'backend/services/aiGatewayProvidersRetry.ts',
    ]) {
      expect({ file: rel, usesPlatformBreaker: /resilience\/circuitBreaker/.test(read(rel)) }).toEqual({
        file: rel,
        usesPlatformBreaker: true,
      });
    }
  });

  it('the intelligence provider breaker is NOT used for AI/HTTP/publish', () => {
    // backend/services/intelligence/circuitBreaker.ts is keyed by
    // intelligence-data `provider_id` and read by the provider-health
    // dashboard. Writing AI models or HTTP hosts into it would corrupt that
    // view — see RF-07, which tracks its separate (reader-only) gap.
    for (const rel of [
      'lib/security/safeFetch.ts',
      'backend/services/aiGatewayProvidersRetry.ts',
      'backend/adapters/linkedinAdapter.ts',
      'backend/adapters/linkedin/linkedinMediaUpload.ts',
    ]) {
      // Must match an IMPORT, not a mention: aiGatewayProvidersRetry.ts names
      // that module in a comment explaining why it is deliberately not used.
      const imports = /(?:from|import\()\s*['"][^'"]*intelligence\/circuitBreaker['"]/.test(read(rel));
      expect({ file: rel, leaks: imports }).toEqual({ file: rel, leaks: false });
    }
  });
});
