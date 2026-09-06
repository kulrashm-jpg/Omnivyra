/**
 * A3M — the tenant credential port for PI enrichment.
 *
 * Answers exactly one question: does THIS TENANT have a credential for THIS
 * PROVIDER? It is the only thing the executor is allowed to treat as evidence
 * that a provider may be called on a tenant's behalf.
 *
 * ─── WHAT THIS REPLACES, AND WHY IT MATTERED ──────────────────────────────
 * Before A3M the executor asked `process.env[credentialEnvVar]`. That is a
 * question about OMNIVYRA, not about the tenant, and the two are not the same
 * question. A tenant that had authorised nothing would have passed the gate on
 * the strength of a key it never supplied: one key, one bill, one rate limit,
 * shared silently across every tenant on the platform. The defect was not
 * exploitable only because no provider key was configured anywhere — which is
 * to say it would have become live on the day someone set one.
 *
 * ─── NO ENVIRONMENT FALLBACK. NONE. ───────────────────────────────────────
 * This file must never read `process.env` for a credential, and there is a
 * test that fails if a tenant with no credential is rescued by an environment
 * variable. A fallback is not a convenience here: it is indistinguishable, at
 * the point of the call, from the tenant having authorised the provider.
 *
 * Global environment credentials remain entirely legitimate for genuinely
 * platform-owned infrastructure — SerpAPI, NewsAPI, OpenAI and the rest of the
 * `external_api_sources` catalogue are Omnivyra's own keys doing Omnivyra's
 * own work, and nothing here changes them. The rule is scoped to tenant-owned
 * PI providers, where the credential belongs to the tenant by definition.
 *
 * ─── ABSENCE AND NON-ENTITLEMENT ARE THE SAME ANSWER ──────────────────────
 * Returns null for both. A caller that could distinguish "you have no
 * credential" from "that credential is not yours" would learn something about
 * another tenant's configuration from the shape of its own refusal.
 */

import {
  getProviderCredentials,
  type CredentialMap,
} from '../../integrationCredentialService';

/**
 * The credential key a provider's API key is stored under.
 *
 * `api_key` is already a member of `SECRET_CONFIG_KEYS`, so it is encrypted at
 * rest by the existing store with no additions — the reason this reuses that
 * vocabulary rather than inventing a PI-specific one.
 */
export const PROVIDER_API_KEY = 'api_key';

export interface TenantCredentialPortOptions {
  /** Injectable for tests. Defaults to the real encrypted store. */
  readonly read?: (companyId: string, providerKey: string) => Promise<CredentialMap>;
  /** Which stored key holds the credential. Defaults to `api_key`. */
  readonly credentialKey?: string;
}

export interface TenantCredentialPort {
  resolveCredential(input: {
    organizationId: string;
    providerId: string;
  }): Promise<string | null>;
}

/**
 * Build the port the executor requires.
 *
 * Every failure mode returns null rather than throwing, because a credential
 * lookup failing is an ordinary outcome the executor already models as
 * `credential_missing`. An exception here would be indistinguishable from a
 * provider error and could be retried; a null cannot.
 */
export function makeTenantCredentialPort(
  options: TenantCredentialPortOptions = {},
): TenantCredentialPort {
  const read = options.read ?? getProviderCredentials;
  const credentialKey = options.credentialKey ?? PROVIDER_API_KEY;

  return {
    async resolveCredential({ organizationId, providerId }) {
      const tenant = String(organizationId ?? '').trim();
      const provider = String(providerId ?? '').trim();
      // A tenant-less or provider-less lookup is refused before it reaches the
      // store, so an empty string can never widen a WHERE clause into a scan.
      if (!tenant || !provider) return null;

      let credentials: CredentialMap;
      try {
        credentials = await read(tenant, provider);
      } catch {
        // A store failure is NOT a reason to look elsewhere. The tenant either
        // has a credential we could read or it does not get a call.
        return null;
      }

      const value = credentials?.[credentialKey];
      return typeof value === 'string' && value.trim() ? value : null;
    },
  };
}

/**
 * The port PI uses in production. Named so the wiring reads as a decision
 * rather than a default, and so a caller cannot accidentally construct an
 * executor with no credential source at all.
 */
export const tenantCredentialPort: TenantCredentialPort = makeTenantCredentialPort();
