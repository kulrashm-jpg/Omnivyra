/**
 * Canonical credential resolution for Report 1.
 *
 * The invariant under test: ONE credential system, ONE resolution path, ONE truth. If Super
 * Admin shows Credential A as active, the provider must receive Credential A.
 *
 * All values here are PLACEHOLDERS. No real secret appears in this file or in any assertion.
 */
import {
  PROVIDER_CREDENTIALS,
  describeProviderCredential,
  resolveProviderCredential,
} from '../../services/providerCredentialResolver';
import { resolveEnvValue } from '../../services/externalApi/internalHelpers';
import { resolveEnvValue as resolveEnvValueValidation } from '../../services/externalApi/requestValidation';

const PLACEHOLDER_ENV_VALUE = 'placeholder-env-credential-not-real';
const PLACEHOLDER_SECRET_SHAPE = 'sk-placeholderNotARealKey00000000000';

// The resolver reaches Supabase for managed lookups; stub it so these stay unit tests.
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
routeStub: null,
        }),
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

describe('Report 1 credential resolution — registry', () => {
  it('declares every Report 1 provider with exactly one mode', () => {
    for (const key of ['serpapi', 'pagespeed', 'openai_report_probe', 'wikidata']) {
      const descriptor = PROVIDER_CREDENTIALS[key];
      expect(descriptor).toBeDefined();
      expect(['SUPER_ADMIN_MANAGED', 'ENVIRONMENT_MANAGED', 'KEYLESS']).toContain(descriptor.mode);
      // There is no fourth, ambiguous state.
      expect(descriptor.rationale.length).toBeGreaterThan(0);
    }
  });

  it('classifies SerpAPI as managed and PageSpeed / OpenAI probe as environment-managed', () => {
    expect(PROVIDER_CREDENTIALS.serpapi.mode).toBe('SUPER_ADMIN_MANAGED');
    expect(PROVIDER_CREDENTIALS.pagespeed.mode).toBe('ENVIRONMENT_MANAGED');
    expect(PROVIDER_CREDENTIALS.openai_report_probe.mode).toBe('ENVIRONMENT_MANAGED');
  });

  it('classifies Wikidata as keyless — nothing to manage', () => {
    expect(PROVIDER_CREDENTIALS.wikidata.mode).toBe('KEYLESS');
    expect(PROVIDER_CREDENTIALS.wikidata.envNames).toEqual([]);
  });
});

/** Restore the default "no managed account" stubs so tests cannot leak into each other. */
function resetCredentialStubs(): void {
  const accountService = require('../../services/providerAccountService');
  const dbModule = require('../../db/supabaseClient');
  dbModule.supabase.from = () => ({
    select: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
  });
  accountService.getActiveAccountForApi.mockReset();
  accountService.getActiveAccountForApi.mockResolvedValue(null);
  accountService.resolveAccountCredentials.mockReset();
  accountService.resolveAccountCredentials.mockReturnValue({
    source: 'account', accountId: null, api_key_env_name: null,
    api_key_value: null, oauth_client_id: null, oauth_client_secret: null,
  });
}

beforeEach(resetCredentialStubs);

describe('Report 1 credential resolution — precedence and fallback', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('falls back to the environment when no managed credential exists', async () => {
    process.env.SERP_API_KEY = PLACEHOLDER_ENV_VALUE;
    const resolved = await resolveProviderCredential('serpapi');
    expect(resolved.source).toBe('environment');
    expect(resolved.value).toBe(PLACEHOLDER_ENV_VALUE);
    expect(resolved.envName).toBe('SERP_API_KEY');
  });

  it('honours env-name ORDER', async () => {
    process.env.SERPAPI_API_KEY = 'placeholder-first';
    process.env.SERP_API_KEY = 'placeholder-second';
    const resolved = await resolveProviderCredential('serpapi');
    expect(resolved.envName).toBe('SERPAPI_API_KEY');
  });

  it('a managed account credential OVERRIDES the environment', async () => {
    process.env.SERP_API_KEY = PLACEHOLDER_ENV_VALUE;
    const accountService = require('../../services/providerAccountService');
    const dbModule = require('../../db/supabaseClient');
    dbModule.supabase.from = () => ({
      select: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'src-1' } }) }) }) }) }),
    });
    accountService.getActiveAccountForApi.mockResolvedValue({ id: 'acct-9', credentials_encrypted: '{}' });
    accountService.resolveAccountCredentials.mockReturnValue({
      source: 'account', accountId: 'acct-9', api_key_env_name: null,
      api_key_value: 'placeholder-managed-credential', oauth_client_id: null, oauth_client_secret: null,
    });

    const resolved = await resolveProviderCredential('serpapi');
    expect(resolved.source).toBe('managed');
    expect(resolved.value).toBe('placeholder-managed-credential');
    expect(resolved.accountId).toBe('acct-9');
    expect(resolved.value).not.toBe(PLACEHOLDER_ENV_VALUE);
  });

  it('reports unavailable with a reason when nothing resolves', async () => {
    delete process.env.SERPAPI_API_KEY; delete process.env.SERP_API_KEY; delete process.env.SERPAPI_KEY;
    const resolved = await resolveProviderCredential('serpapi');
    expect(resolved.source).toBe('unavailable');
    expect(resolved.value).toBeNull();
    expect(resolved.reason).toContain('No credential configured');
  });

  it('an UNREGISTERED provider fails closed — no silent env fallback', async () => {
    process.env.SOME_OTHER_KEY = PLACEHOLDER_ENV_VALUE;
    const resolved = await resolveProviderCredential('not_a_declared_provider');
    expect(resolved.source).toBe('unavailable');
    expect(resolved.value).toBeNull();
    expect(resolved.reason).toContain('not declared');
  });

  it('keyless providers resolve to no credential without error', async () => {
    const resolved = await resolveProviderCredential('wikidata');
    expect(resolved.mode).toBe('KEYLESS');
    expect(resolved.value).toBeNull();
    expect(resolved.reason).toContain('Keyless');
  });

  it('PageSpeed resolves from PAGESPEED_API_KEY only', async () => {
    process.env.PAGESPEED_API_KEY = PLACEHOLDER_ENV_VALUE;
    const resolved = await resolveProviderCredential('pagespeed');
    expect(resolved.mode).toBe('ENVIRONMENT_MANAGED');
    expect(resolved.source).toBe('environment');
    expect(resolved.envName).toBe('PAGESPEED_API_KEY');
  });

  it('the OpenAI probe resolves from OPENAI_API_KEY, isolated from the external-API account', async () => {
    process.env.OPENAI_API_KEY = PLACEHOLDER_ENV_VALUE;
    const resolved = await resolveProviderCredential('openai_report_probe');
    expect(resolved.source).toBe('environment');
    expect(resolved.envName).toBe('OPENAI_API_KEY');
    expect(resolved.accountId).toBeNull();
  });
});

describe('Report 1 credential resolution — no secret leakage', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('the shape-only description NEVER contains the credential', async () => {
    process.env.SERP_API_KEY = PLACEHOLDER_ENV_VALUE;
    const described = await describeProviderCredential('serpapi');
    expect(described.configured).toBe(true);
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain(PLACEHOLDER_ENV_VALUE);
    // It reports the NAME, which is not a secret.
    expect(described.envName).toBe('SERP_API_KEY');
  });

  it('the diagnostic reason never contains the credential', async () => {
    process.env.SERP_API_KEY = PLACEHOLDER_ENV_VALUE;
    const resolved = await resolveProviderCredential('serpapi');
    expect(resolved.reason).not.toContain(PLACEHOLDER_ENV_VALUE);
  });
});

// ── The literal-key fallback must be gone ─────────────────────────────────────

describe('literal-key fallback removed', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('a secret-shaped value can NEVER become a usable credential', () => {
    // This is the exact mechanism that let four live keys work from a name field.
    expect(resolveEnvValue(PLACEHOLDER_SECRET_SHAPE)).toBeUndefined();
    expect(resolveEnvValueValidation(PLACEHOLDER_SECRET_SHAPE)).toBeUndefined();
  });

  it('rejects every secret shape, not just the known prefixes', () => {
    for (const shaped of ['AIzaPlaceholder000', 'a'.repeat(32), 'ghp_placeholder000', 'lowercase-key-value']) {
      expect(resolveEnvValue(shaped)).toBeUndefined();
      expect(resolveEnvValueValidation(shaped)).toBeUndefined();
    }
  });

  it('a genuine env-var NAME still resolves to its value — no regression', () => {
    process.env.TEST_LEGIT_ENV_NAME = PLACEHOLDER_ENV_VALUE;
    expect(resolveEnvValue('TEST_LEGIT_ENV_NAME')).toBe(PLACEHOLDER_ENV_VALUE);
    expect(resolveEnvValueValidation('TEST_LEGIT_ENV_NAME')).toBe(PLACEHOLDER_ENV_VALUE);
  });

  it('an unset env-var name resolves to undefined, not to the name itself', () => {
    delete process.env.TEST_UNSET_ENV_NAME;
    expect(resolveEnvValue('TEST_UNSET_ENV_NAME')).toBeUndefined();
    expect(resolveEnvValueValidation('TEST_UNSET_ENV_NAME')).toBeUndefined();
  });

  it('handles null/empty input safely', () => {
    expect(resolveEnvValue(null)).toBeUndefined();
    expect(resolveEnvValue(undefined)).toBeUndefined();
    expect(resolveEnvValue('')).toBeUndefined();
  });
});
