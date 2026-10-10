/**
 * E — THE TWO REPORT 1 PROVIDERS THE CREDENTIAL REGISTRY DID NOT DECLARE.
 *
 * `providerCredentialResolver` states its own rule: "Adding a Report 1 provider
 * without an entry here is a bug: the resolver treats an unknown key as
 * `unavailable` rather than silently falling back to `process.env`." By that
 * rule Perplexity and Ahrefs were bugs. Asking the canonical resolver about
 * either returned:
 *
 *   source:    'unavailable'
 *   reason:    'Provider "perplexity" is not declared in PROVIDER_CREDENTIALS…'
 *   rationale: 'Unregistered provider.'
 *
 * …for the two capabilities an operator is most likely to ask about: AI
 * visibility (Perplexity is the only retrieval-grounded engine in the repo) and
 * backlink authority (Ahrefs is the only implemented provider). The resolver
 * could not tell them what to set, and could not tell them it was already set.
 *
 * WHAT THE ENTRIES DO AND DO NOT CLAIM. Both are ENVIRONMENT_MANAGED because
 * that is what the runtime does: `llmAdapterBase.getCredential()` reads
 * `process.env[config.envKey]`, and `ahrefsAdapter.lookup()` reads
 * `process.env.AHREFS_API_KEY`. Neither consults a credential store, so neither
 * may be declared SUPER_ADMIN_MANAGED — that would offer a control the runtime
 * ignores, which is the silent-failure class the module exists to prevent.
 *
 * ALL VALUES HERE ARE PLACEHOLDERS. No real secret appears in this file.
 */

const PLACEHOLDER = 'placeholder-env-credential-not-real';

// The resolver reaches Supabase for managed lookups only; stub it so this stays
// a unit test and no network or database is touched.
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      }),
    }),
  },
}));

jest.mock('../../services/providerAccountService', () => ({
  getActiveAccountForApi: jest.fn(async () => null),
  resolveAccountCredentials: jest.fn(() => ({
    source: 'account', accountId: null, api_key_env_name: null,
    api_key_value: null, oauth_client_id: null, oauth_client_secret: null,
  })),
}));

import {
  PROVIDER_CREDENTIALS,
  describeProviderCredential,
  resolveProviderCredential,
} from '../../services/providerCredentialResolver';

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of ['PERPLEXITY_API_KEY', 'AHREFS_API_KEY']) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
});

describe('E — Perplexity and Ahrefs are declared, with the mode the runtime uses', () => {
  it.each(['perplexity', 'ahrefs'])('%s is declared ENVIRONMENT_MANAGED', (key) => {
    const descriptor = PROVIDER_CREDENTIALS[key];
    expect(descriptor).toBeDefined();
    expect(descriptor.mode).toBe('ENVIRONMENT_MANAGED');
    // No managed source: offering a Super Admin control the adapter does not
    // read is the defect, not the fix.
    expect(descriptor.sourceName).toBeNull();
    expect(descriptor.envNames.length).toBe(1);
    expect(descriptor.rationale).toContain('environment');
  });

  it('names the exact variables and nothing else', () => {
    expect(PROVIDER_CREDENTIALS.perplexity.envNames).toEqual(['PERPLEXITY_API_KEY']);
    expect(PROVIDER_CREDENTIALS.ahrefs.envNames).toEqual(['AHREFS_API_KEY']);
    // Moz and Majestic have no adapter; naming them would be an instruction
    // that cannot work.
    expect(PROVIDER_CREDENTIALS.ahrefs.envNames).not.toContain('MOZ_API_KEY');
    expect(PROVIDER_CREDENTIALS.ahrefs.envNames).not.toContain('MAJESTIC_API_KEY');
  });
});

describe('E — an unset provider is diagnosable instead of unknown', () => {
  it.each([
    ['perplexity', 'PERPLEXITY_API_KEY'],
    ['ahrefs', 'AHREFS_API_KEY'],
  ])('%s reports the prerequisite rather than "not declared"', async (key, envName) => {
    // NEGATIVE CONTROL. Remove either descriptor and the resolver falls into its
    // fail-closed branch: `reason` becomes 'is not declared in
    // PROVIDER_CREDENTIALS' and `rationale` becomes 'Unregistered provider.',
    // so the first three assertions below fail.
    const described = await describeProviderCredential(key);
    expect(described.mode).toBe('ENVIRONMENT_MANAGED');
    expect(described.reason).toContain(envName);
    expect(described.rationale).not.toBe('Unregistered provider.');
    expect(described.reason).not.toContain('not declared in PROVIDER_CREDENTIALS');
    // Honestly unconfigured — the entry does not make the capability work.
    expect(described.configured).toBe(false);
    expect(described.source).toBe('unavailable');
    expect(described.accountId).toBeNull();
  });

  it('a provider that genuinely has no descriptor still fails closed — NON-VACUITY', async () => {
    const described = await describeProviderCredential('not_a_provider');
    expect(described.rationale).toBe('Unregistered provider.');
    expect(described.reason).toContain('not declared in PROVIDER_CREDENTIALS');
    expect(described.configured).toBe(false);
  });
});

describe('E — a set provider resolves from the environment, and never leaks', () => {
  it('resolves Perplexity from PERPLEXITY_API_KEY — NON-VACUITY', async () => {
    process.env.PERPLEXITY_API_KEY = PLACEHOLDER;
    const resolved = await resolveProviderCredential('perplexity');
    expect(resolved.source).toBe('environment');
    expect(resolved.envName).toBe('PERPLEXITY_API_KEY');
    expect(resolved.value).toBe(PLACEHOLDER);
    expect(resolved.accountId).toBeNull();
    // The reason is shape-only.
    expect(resolved.reason).not.toContain(PLACEHOLDER);
  });

  it('the shape-only description never carries the value', async () => {
    process.env.AHREFS_API_KEY = PLACEHOLDER;
    const described = await describeProviderCredential('ahrefs');
    expect(described.configured).toBe(true);
    expect(described.envName).toBe('AHREFS_API_KEY');
    expect(JSON.stringify(described)).not.toContain(PLACEHOLDER);
  });
});
