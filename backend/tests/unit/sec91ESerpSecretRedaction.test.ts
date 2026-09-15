/**
 * STEP 3AH-91 SEC-E3 — SERP providers require their key as a query parameter
 * (`api_key`). A transport/runtime error that echoes the request URL must not
 * carry that key into the provider log (`logProviderCall`), the returned
 * `reason`, or a rethrown Error message.
 *
 * No network: the canonical client's transport is injected; the acquisition
 * service's global `fetch` is a stub that rejects.
 */
const mockLogProviderCall = jest.fn();
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/providerCredentialResolver', () => ({
  __esModule: true,
  resolveProviderCredential: async () => ({ value: KEY_FOR_MOCK, source: 'env', reason: null }),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  __esModule: true,
  authorizeProviderCall: () => ({ allowed: true, killed: false, dryRun: false, reason: 'allowed', remaining: { daily: null, monthly: null } }),
  recordProviderUsage: jest.fn(async () => undefined),
}));
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  __esModule: true,
  logProviderCall: (...a: unknown[]) => mockLogProviderCall(...a),
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../services/externalCompetitiveIntelligenceService', () => ({
  ingestSerpSnapshot: jest.fn(), upsertCompetitorDomain: jest.fn(),
}));
jest.mock('../../services/analyticsEnvironmentGuardService', () => ({
  assertAnalyticsMutationAllowed: jest.fn(),
}));

// jest.mock factories are hoisted; a `var` is hoisted with them (a const is not).
// eslint-disable-next-line no-var
var KEY_FOR_MOCK = 'serp-SECRET-KEY-a1b2c3d4e5';

import { fetchCanonicalSerp } from '../../services/serp/canonicalSerpClient';
import { configuredSerpProviders } from '../../services/serpAcquisitionService';

const KEY = 'serp-SECRET-KEY-a1b2c3d4e5';

function expectNoKey(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  expect(text).not.toContain(KEY);
}

describe('canonical SERP client', () => {
  it('a transport error that echoes the URL is redacted in the result and the provider log', async () => {
    let seenUrl = '';
    const result = await fetchCanonicalSerp(
      { query: 'acme', depth: 10, operation: 'search' },
      () => [],
      {
        transport: async (url: string) => {
          seenUrl = url;
          throw new Error(`request to ${url} failed: socket hang up`);
        },
      },
    );
    // The request itself must still carry the key — SerpAPI has no header auth.
    expect(seenUrl).toContain('api_key=');
    expect(result.status).toBe('failed');
    expectNoKey(result);
    expect(result.reason).toContain('https://serpapi.com/search.json');
    for (const call of mockLogProviderCall.mock.calls) expectNoKey(call);
  });
});

describe('SERP acquisition providers', () => {
  const ENV = ['SERP_PROVIDER_PRIORITY', 'SERPAPI_ENDPOINT'];
  const prior: Record<string, string | undefined> = {};
  const realFetch = global.fetch;
  beforeEach(() => {
    for (const k of ENV) prior[k] = process.env[k];
    process.env.SERP_PROVIDER_PRIORITY = 'serpapi';
    delete process.env.SERPAPI_ENDPOINT;
  });
  afterEach(() => {
    for (const k of ENV) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
    (global as any).fetch = realFetch;
  });

  it('a rethrown provider error never contains the api_key', async () => {
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      seen.push(String(url));
      throw new Error(`fetch to ${url} failed`);
    });
    const providers = await configuredSerpProviders();
    const serpapi = providers.find((p) => p.id === 'serpapi');
    expect(serpapi).toBeDefined();

    let message = '';
    try { await serpapi!.fetch('acme widgets'); } catch (e) { message = (e as Error).message; }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContain('api_key=');
    expect(message).toMatch(/failed after \d+ attempts/);
    expectNoKey(message);
  }, 15_000);
});
