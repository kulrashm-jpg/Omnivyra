/**
 * Canonical provider credential resolution for Report 1.
 *
 * ONE resolution path, so the invariant holds: the credential Super Admin shows as active is
 * the credential the provider actually uses.
 *
 * Before this, Report 1 providers read `process.env` directly and never consulted the
 * credential store. An administrator could rotate a key in Super Admin, see a success
 * message, and change nothing — a silent-failure class of defect. This module is the bridge,
 * and it REUSES `resolveAccountCredentials` rather than reimplementing it.
 *
 * ── Declared modes ───────────────────────────────────────────────────────────
 * Every provider is exactly one of three states. There is deliberately no fourth,
 * ambiguous state, and no provider may present a credential control the runtime ignores:
 *
 *   SUPER_ADMIN_MANAGED  store → resolver → provider, with environment fallback
 *   ENVIRONMENT_MANAGED  environment → provider. The UI must say so.
 *   KEYLESS              no credential exists to manage.
 *
 * ── Precedence (unchanged from the credential remediation) ────────────────────
 *   1. encrypted stored account secret
 *   2. account environment-variable reference
 *   3. source-level environment-variable reference   ← via the env names below
 *   4. unavailable
 *
 * This module never logs, returns or echoes a credential value in any diagnostic. The
 * resolved secret is returned to the caller for immediate use and nothing else.
 */
import { supabase } from '../db/supabaseClient';
import {
  getActiveAccountForApi,
  resolveAccountCredentials,
} from './providerAccountService';

export type CredentialMode = 'SUPER_ADMIN_MANAGED' | 'ENVIRONMENT_MANAGED' | 'KEYLESS';
export type CredentialSource = 'managed' | 'environment' | 'unavailable';

export interface ProviderCredentialDescriptor {
  /** Stable key used by runtime callers. */
  key: string;
  /** Human label, and the `external_api_sources.name` used to find a managed account. */
  sourceName: string | null;
  mode: CredentialMode;
  /** Environment variables consulted, in order, when no managed credential resolves. */
  envNames: string[];
  /** Why this provider is in its declared mode — surfaced in the UI, never a secret. */
  rationale: string;
}

/**
 * THE registry. Adding a Report 1 provider without an entry here is a bug: the resolver
 * treats an unknown key as `unavailable` rather than silently falling back to `process.env`.
 */
export const PROVIDER_CREDENTIALS: Record<string, ProviderCredentialDescriptor> = {
  serpapi: {
    key: 'serpapi',
    sourceName: 'SerpAPI',
    mode: 'SUPER_ADMIN_MANAGED',
    envNames: ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'],
    rationale: 'A SerpAPI provider account exists, so the credential is managed in Super Admin with environment fallback.',
  },
  pagespeed: {
    key: 'pagespeed',
    sourceName: null,
    mode: 'ENVIRONMENT_MANAGED',
    envNames: ['PAGESPEED_API_KEY'],
    // §5: do not invent provider infrastructure. PageSpeed has no `external_api_sources`
    // row and no account, and the API works keyless (on a shared, frequently-exhausted
    // quota). Registering a source purely to host one key would add infrastructure the
    // brief explicitly rules out. It is therefore environment-managed AND LABELLED as such,
    // so no misleading credential control is offered.
    rationale: 'PageSpeed has no provider-account record and operates keyless or with a single platform key. Configure PAGESPEED_API_KEY in the environment.',
  },
  openai_report_probe: {
    key: 'openai_report_probe',
    sourceName: null,
    mode: 'ENVIRONMENT_MANAGED',
    envNames: ['OPENAI_API_KEY'],
    // §6: deliberately NOT pointed at the "OpenAI (GPT-4o)" provider account. That account
    // holds the credential relocated during the security remediation — a key that was
    // exposed and is pending rotation. Routing Report 1's AI probes at it would switch them
    // from a clean environment credential to a compromised one, which is strictly worse.
    // It is also a different concern: that source serves the External API executor and
    // content generation, and conflating them would couple Report 1's cost and rate limits
    // to unrelated flows. Revisit once the exposed key is rotated.
    rationale: 'Report 1 AI probes use the platform OPENAI_API_KEY. Deliberately separate from the OpenAI external-API account so probe cost and rate limits stay isolated from content generation.',
  },
  wikidata: {
    key: 'wikidata',
    sourceName: null,
    mode: 'KEYLESS',
    envNames: [],
    rationale: 'Wikidata is a public, keyless API. There is no credential to manage.',
  },
};

export interface ResolvedProviderCredential {
  providerKey: string;
  mode: CredentialMode;
  /** The credential for immediate use. Never logged, never returned to a client. */
  value: string | null;
  source: CredentialSource;
  /** Which account supplied it, when managed. Null otherwise. */
  accountId: string | null;
  /** Which environment variable supplied it, when environment-sourced. Null otherwise. */
  envName: string | null;
  /** Shape-only diagnostic, safe to log. */
  reason: string;
}

/** Read the first environment variable that has a value. Returns the NAME too, never logged with the value. */
function fromEnvironment(envNames: readonly string[]): { value: string | null; envName: string | null } {
  for (const name of envNames) {
    const value = process.env[name];
    if (value && value.trim()) return { value: value.trim(), envName: name };
  }
  return { value: null, envName: null };
}

/** Look up the `external_api_sources` id for a provider by name. Null when not registered. */
async function findApiSourceId(sourceName: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('external_api_sources')
      .select('id')
      .eq('name', sourceName)
      .is('company_id', null)
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the credential a provider should use, right now.
 *
 * Never throws — an unresolvable credential yields `source: 'unavailable'` with a reason, so
 * callers degrade to their existing honest-unavailable behaviour rather than failing hard.
 */
export async function resolveProviderCredential(providerKey: string): Promise<ResolvedProviderCredential> {
  const descriptor = PROVIDER_CREDENTIALS[providerKey];

  if (!descriptor) {
    // Fail closed: an unregistered provider does NOT get a silent env fallback.
    return {
      providerKey, mode: 'ENVIRONMENT_MANAGED', value: null, source: 'unavailable',
      accountId: null, envName: null,
      reason: `Provider "${providerKey}" is not declared in PROVIDER_CREDENTIALS. Add a descriptor before using it.`,
    };
  }

  if (descriptor.mode === 'KEYLESS') {
    return {
      providerKey, mode: descriptor.mode, value: null, source: 'unavailable',
      accountId: null, envName: null, reason: 'Keyless provider — no credential required.',
    };
  }

  // 1 + 2. Managed account (encrypted secret, then the account's env reference).
  if (descriptor.mode === 'SUPER_ADMIN_MANAGED' && descriptor.sourceName) {
    try {
      const apiSourceId = await findApiSourceId(descriptor.sourceName);
      if (apiSourceId) {
        const account = await getActiveAccountForApi(apiSourceId);
        if (account) {
          const credentials = resolveAccountCredentials(account);
          if (credentials.api_key_value) {
            return {
              providerKey, mode: descriptor.mode, value: credentials.api_key_value,
              source: 'managed', accountId: account.id,
              envName: credentials.api_key_env_name ?? null,
              reason: credentials.legacy_plaintext_key
                ? 'Resolved from the active Super Admin account (LEGACY PLAINTEXT — re-enter to encrypt).'
                : 'Resolved from the active Super Admin account.',
            };
          }
        }
      }
    } catch {
      // Fall through to the environment rather than failing the provider outright.
    }
  }

  // 3. Source-level environment fallback.
  const env = fromEnvironment(descriptor.envNames);
  if (env.value) {
    return {
      providerKey, mode: descriptor.mode, value: env.value, source: 'environment',
      accountId: null, envName: env.envName,
      reason: descriptor.mode === 'SUPER_ADMIN_MANAGED'
        ? `No managed credential is configured; using the ${env.envName} environment fallback.`
        : `Using the ${env.envName} environment variable.`,
    };
  }

  // 4. Unavailable.
  return {
    providerKey, mode: descriptor.mode, value: null, source: 'unavailable',
    accountId: null, envName: null,
    reason: descriptor.mode === 'SUPER_ADMIN_MANAGED'
      ? `No credential configured. Add one in Super Admin, or set ${descriptor.envNames.join(' / ')}.`
      : `No credential configured. Set ${descriptor.envNames.join(' / ')} in the environment.`,
  };
}

/**
 * Shape-only status for the UI and diagnostics. Reports WHETHER a credential resolves and
 * from where — never the value, never a fragment, never a length that could narrow it.
 */
export async function describeProviderCredential(providerKey: string): Promise<{
  providerKey: string;
  mode: CredentialMode;
  source: CredentialSource;
  configured: boolean;
  accountId: string | null;
  envName: string | null;
  reason: string;
  rationale: string;
}> {
  const descriptor = PROVIDER_CREDENTIALS[providerKey];
  const resolved = await resolveProviderCredential(providerKey);
  return {
    providerKey: resolved.providerKey,
    mode: resolved.mode,
    source: resolved.source,
    configured: resolved.value !== null,
    accountId: resolved.accountId,
    envName: resolved.envName,
    reason: resolved.reason,
    rationale: descriptor?.rationale ?? 'Unregistered provider.',
  };
}
