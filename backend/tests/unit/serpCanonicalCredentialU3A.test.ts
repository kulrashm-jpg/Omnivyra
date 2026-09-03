/**
 * U3A — SERP acquisition resolves its credential through the canonical provider path.
 *
 * The SerpAPI factory previously read `SERPAPI_KEY || SERP_INTELLIGENCE_SERPAPI_KEY`
 * directly. That could not see a Super Admin managed credential and missed the canonical
 * descriptor names, so a correctly configured account produced no provider at all.
 *
 * These tests pin the new contract: `resolveProviderCredential('serpapi')` is the sole
 * credential authority, and the `null`-means-unconfigured selection semantics are unchanged.
 */
const mockResolveProviderCredential = jest.fn();

jest.mock('../../services/providerCredentialResolver', () => ({
  resolveProviderCredential: (...args: unknown[]) => mockResolveProviderCredential(...args),
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../services/externalCompetitiveIntelligenceService', () => ({
  ingestSerpSnapshot: jest.fn(), upsertCompetitorDomain: jest.fn(),
}));
jest.mock('../../services/analyticsEnvironmentGuardService', () => ({
  assertAnalyticsMutationAllowed: jest.fn(),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: jest.fn(), recordProviderUsage: jest.fn(),
}));

import {
  configuredSerpProviders,
  getConfiguredSerpProviderHealth,
  createConfiguredSerpApiProvider,
} from '../../services/serpAcquisitionService';

const SERP_ENV = [
  'SERPAPI_KEY', 'SERPAPI_API_KEY', 'SERP_API_KEY', 'SERP_INTELLIGENCE_SERPAPI_KEY',
  'SERP_MANAGED_CREDENTIALS', 'SERP_PROVIDER_PRIORITY',
  'SCALESERP_API_KEY', 'SERP_INTELLIGENCE_SCALESERP_KEY',
  'SERP_INTELLIGENCE_API_KEY', 'SERP_INTELLIGENCE_API_ENDPOINT',
  'SERP_INTELLIGENCE_DATAFORSEO_LOGIN', 'SERP_INTELLIGENCE_DATAFORSEO_PASSWORD',
];
const PRIOR: Record<string, string | undefined> = {};

beforeEach(() => {
  mockResolveProviderCredential.mockReset();
  for (const k of SERP_ENV) { PRIOR[k] = process.env[k]; delete process.env[k]; }
  // Only SerpAPI is in play; the other factories stay unconfigured.
  process.env.SERP_PROVIDER_PRIORITY = 'serpapi';
});
afterEach(() => {
  for (const k of SERP_ENV) {
    if (PRIOR[k] === undefined) delete process.env[k];
    else process.env[k] = PRIOR[k] as string;
  }
});

const unavailable = { providerKey: 'serpapi', mode: 'SUPER_ADMIN_MANAGED', value: null, source: 'unavailable', accountId: null, envName: null, reason: 'No credential configured.' };
const managed = { providerKey: 'serpapi', mode: 'SUPER_ADMIN_MANAGED', value: 'managed-placeholder-not-real', source: 'managed', accountId: 'acct-1', envName: null, reason: 'Resolved from the active Super Admin account.' };
const fromEnv = { providerKey: 'serpapi', mode: 'SUPER_ADMIN_MANAGED', value: 'env-placeholder-not-real', source: 'environment', accountId: null, envName: 'SERPAPI_API_KEY', reason: 'No managed credential is configured; using the SERPAPI_API_KEY environment fallback.' };

describe('U3A · A — managed credential', () => {
  it('offers the provider when the canonical resolver returns a managed credential', async () => {
    mockResolveProviderCredential.mockResolvedValue(managed);
    const providers = await configuredSerpProviders();
    expect(mockResolveProviderCredential).toHaveBeenCalledWith('serpapi');
    expect(providers.map((p) => p.id)).toEqual(['serpapi']);
  });

  it('needs no SERP environment variable at all', async () => {
    mockResolveProviderCredential.mockResolvedValue(managed);
    expect(process.env.SERPAPI_KEY).toBeUndefined();
    expect(process.env.SERPAPI_API_KEY).toBeUndefined();
    expect((await configuredSerpProviders()).length).toBe(1);
  });
});

describe('U3A · B — canonical environment fallback', () => {
  it('uses the value the resolver returns from the canonical env name', async () => {
    mockResolveProviderCredential.mockResolvedValue(fromEnv);
    expect((await configuredSerpProviders()).map((p) => p.id)).toEqual(['serpapi']);
  });

  it('does NOT perform its own environment lookup — a raw env var alone offers nothing', async () => {
    // The legacy names are set, but the resolver says unavailable. Under the old direct
    // lookup this produced a provider; under the canonical contract it must not.
    process.env.SERPAPI_KEY = 'legacy-placeholder-not-real';
    process.env.SERP_INTELLIGENCE_SERPAPI_KEY = 'legacy-placeholder-not-real';
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    expect(await configuredSerpProviders()).toEqual([]);
  });
});

describe('U3A · C — unavailable credential', () => {
  it('returns no provider, preserving the null-means-unconfigured contract', async () => {
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    expect(await configuredSerpProviders()).toEqual([]);
    expect(await createConfiguredSerpApiProvider()).toBeNull();
  });

  it('never surfaces a credential value in the unavailable path', async () => {
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    const providers = await configuredSerpProviders();
    expect(JSON.stringify(providers)).not.toContain('placeholder');
  });
});

describe('U3A · D — selection semantics unchanged', () => {
  it('zero configured providers ⇒ null composite', async () => {
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    expect(await createConfiguredSerpApiProvider()).toBeNull();
  });

  it('one configured provider ⇒ that provider is returned directly, id preserved', async () => {
    mockResolveProviderCredential.mockResolvedValue(managed);
    const provider = await createConfiguredSerpApiProvider();
    expect(provider?.id).toBe('serpapi');
  });

  it('priority order is preserved when several are requested', async () => {
    process.env.SERP_PROVIDER_PRIORITY = 'serpapi,scaleserp';
    process.env.SCALESERP_API_KEY = 'scaleserp-placeholder-not-real';
    mockResolveProviderCredential.mockResolvedValue(managed);
    const providers = await configuredSerpProviders();
    expect(providers.map((p) => p.id)).toEqual(['serpapi', 'scaleserp']);
  });
});

describe('U3A · E — health semantics', () => {
  // `configuredProviderHealth` reports 'ready' when configured and 'not_configured' otherwise.
  it("reports serpapi 'ready' when the resolver provides a credential", async () => {
    mockResolveProviderCredential.mockResolvedValue(managed);
    const health = await getConfiguredSerpProviderHealth();
    expect(health.find((h) => h.provider === 'serpapi')?.status).toBe('ready');
  });

  it("reports serpapi 'not_configured' when the credential is unavailable", async () => {
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    const health = await getConfiguredSerpProviderHealth();
    expect(health.find((h) => h.provider === 'serpapi')?.status).toBe('not_configured');
  });

  it('still reports every known provider id, so the health shape is unchanged', async () => {
    mockResolveProviderCredential.mockResolvedValue(unavailable);
    const health = await getConfiguredSerpProviderHealth();
    expect(health.map((h) => h.provider)).toEqual(['dataforseo', 'serpapi', 'scaleserp', 'compliant_api']);
  });
});

describe('U3A · F — the canonical resolver is the sole authority', () => {
  it('the SerpAPI factory reads no SERP credential env var directly', () => {
    const fs = require('fs') as typeof import('fs');
    const src = fs.readFileSync('backend/services/serpAcquisitionService.ts', 'utf8');
    const factory = src.match(/async function createSerpApiProvider\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(factory).toContain("resolveProviderCredential('serpapi')");
    for (const name of ['SERPAPI_KEY', 'SERPAPI_API_KEY', 'SERP_API_KEY', 'SERP_INTELLIGENCE_SERPAPI_KEY']) {
      expect(factory).not.toContain(`process.env.${name}`);
    }
  });

  it('SERP_MANAGED_CREDENTIALS was not introduced anywhere in the service', () => {
    const fs = require('fs') as typeof import('fs');
    expect(fs.readFileSync('backend/services/serpAcquisitionService.ts', 'utf8')).not.toContain('SERP_MANAGED_CREDENTIALS');
  });
});
