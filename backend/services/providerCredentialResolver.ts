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

/** The platform catalog row (`external_api_sources.name`) that holds the PageSpeed key. */
export const PAGESPEED_SOURCE_NAME = 'Google PageSpeed Insights';

export type CredentialMode = 'SUPER_ADMIN_MANAGED' | 'ENVIRONMENT_MANAGED' | 'KEYLESS';
/** `disabled`: Super Admin switched the provider off; no credential (not even the env fallback) is used. */
export type CredentialSource = 'managed' | 'environment' | 'unavailable' | 'disabled';

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
  /**
   * When true, an inactive `external_api_sources` row means the provider is DISABLED by Super
   * Admin: the resolver returns `source: 'disabled'` and does not fall back to the environment.
   * Off for providers whose catalog toggle has never been enforced at runtime (e.g. SerpAPI).
   */
  honourSourceToggle?: boolean;
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
    // Managed from the "Google PageSpeed Insights" card in Super Admin (pageSpeedProviderConfigService),
    // which owns this catalog row and its one encrypted account. Every PageSpeed call goes through
    // pageSpeedClient → this resolver, so the key Super Admin shows is the key the reports use.
    sourceName: PAGESPEED_SOURCE_NAME,
    mode: 'SUPER_ADMIN_MANAGED',
    envNames: ['PAGESPEED_API_KEY'],
    honourSourceToggle: true,
    rationale: 'One application-level Google API key, shared by every tenant report: PageSpeed only measures public pages, so tenants never supply their own. Managed in Super Admin, with PAGESPEED_API_KEY as the environment fallback.',
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
  // ── E · two Report 1 providers this registry did not declare ────────────────
  //
  // By this module's own rule — "Adding a Report 1 provider without an entry
  // here is a bug" — Perplexity and Ahrefs were bugs: both are live Report 1
  // providers, neither had a descriptor, so `resolveProviderCredential` answered
  // `source: 'unavailable'` with "not declared in PROVIDER_CREDENTIALS" and
  // `describeProviderCredential` answered "Unregistered provider." for the two
  // capabilities an operator is most likely to ask about (AI visibility and
  // backlink authority).
  //
  // Both are declared ENVIRONMENT_MANAGED because that is what the runtime
  // actually does, verified in code and not assumed:
  //   • Perplexity — `llmAdapterBase.getCredential()` returns
  //     `process.env[config.envKey]`, and `perplexityAdapter.config.envKey` is
  //     `PERPLEXITY_API_KEY`. The adapter never consults this resolver.
  //   • Ahrefs — `ahrefsAdapter.lookup()` reads `process.env.AHREFS_API_KEY`
  //     directly.
  // Declaring either SUPER_ADMIN_MANAGED would offer a credential control the
  // runtime ignores — the silent-failure class this module exists to prevent.
  // The entries therefore make the providers DIAGNOSABLE; they do not claim a
  // managed credential path that does not exist.
  perplexity: {
    key: 'perplexity',
    sourceName: null,
    mode: 'ENVIRONMENT_MANAGED',
    envNames: ['PERPLEXITY_API_KEY'],
    rationale: 'Perplexity is the only retrieval-grounded AI engine wired into Report 1, so AI visibility is honestly unmeasurable without it. The adapter reads PERPLEXITY_API_KEY from the environment and consults no credential store; no Super Admin control is offered because none would be honoured.',
  },
  bing_webmaster: {
    key: 'bing_webmaster',
    sourceName: null,
    mode: 'ENVIRONMENT_MANAGED',
    envNames: ['BING_WEBMASTER_API_KEY'],
    // One platform key: the API key of Omnivyra's Bing Webmaster Tools user. It reads only sites that user
    // has verified or been added to by the site owner (publicResearch/bingWebmaster.ts), so a company's data
    // is reachable only with that owner's consent. Environment-managed: no Super Admin control is offered.
    rationale: 'Bing Webmaster Tools (inbound links and Bing search performance) for sites the platform Bing Webmaster account can read. Set BING_WEBMASTER_API_KEY; each site owner verifies the site or adds that account as a user.',
  },
  ahrefs: {
    key: 'ahrefs',
    sourceName: null,
    mode: 'ENVIRONMENT_MANAGED',
    envNames: ['AHREFS_API_KEY'],
    rationale: 'Ahrefs is the only implemented backlink/authority provider (Moz and Majestic have no adapter in the repo). The adapter reads AHREFS_API_KEY from the environment and consults no credential store; no Super Admin control is offered because none would be honoured.',
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

/** Look up the platform `external_api_sources` row for a provider by name. Null when not registered. */
async function findApiSource(sourceName: string): Promise<{ id: string; isActive: boolean } | null> {
  try {
    const { data } = await supabase
      .from('external_api_sources')
      .select('id, is_active')
      .eq('name', sourceName)
      .is('company_id', null)
      .limit(1)
      .maybeSingle();
    const row = data as { id?: string; is_active?: boolean | null } | null;
    return row?.id ? { id: row.id, isActive: row.is_active !== false } : null;
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
      const source = await findApiSource(descriptor.sourceName);
      if (source && !source.isActive && descriptor.honourSourceToggle) {
        return {
          providerKey, mode: descriptor.mode, value: null, source: 'disabled',
          accountId: null, envName: null, reason: 'Disabled in Super Admin; no credential is used.',
        };
      }
      const apiSourceId = source?.id ?? null;
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
