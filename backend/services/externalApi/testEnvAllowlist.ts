/**
 * Security boundary for the ad-hoc external-API test endpoint.
 *
 * `POST /api/external-apis/test` builds a throwaway source entirely from the request body,
 * including `api_key_env_name`. `resolveEnvValue` then performs `process.env[name]` with no
 * restriction, and the resolved value is injected into a request aimed at the caller's own
 * `base_url`. A caller could therefore name ANY server environment variable — a database
 * key, a platform secret — and have its value sent to a destination they control.
 *
 * Super Admin authorization does not neutralise that: the platform deliberately withholds
 * credential VALUES even from this role (`describeProviderCredential` reports "never the
 * value, never a fragment, never a length that could narrow it").
 *
 * The boundary here is deliberately NOT a new hard-coded list. An environment variable is
 * testable only when the application already declares it as an external-API credential, in
 * one of the two registries that already exist:
 *
 *   1. `PROVIDER_CREDENTIALS[*].envNames` — the canonical provider descriptors.
 *   2. `external_api_sources.api_key_env_name` — env names registered on real API sources.
 *      Write paths already reject secret-shaped input here via `isEnvVarName`, so a value in
 *      this column is a NAME the operator registered, not a pasted secret.
 *
 * Anything else is refused. Registering a source is the existing prerequisite for testing a
 * new provider, so this removes the arbitrary-lookup capability without removing the feature.
 */
import { PROVIDER_CREDENTIALS } from '../providerCredentialResolver';
import { ownedDbTable } from '../../db/writeOwner';
import { isEnvVarName } from '../../security/credentialSafety';

/**
 * A single shape rather than a discriminated union: this repository compiles with
 * `strict: false`, under which narrowing a union on a boolean literal does not apply, so
 * `if (!d.allowed) d.reason` would not type-check at the call site.
 */
export type EnvNameDecision = {
  allowed: boolean;
  /** The accepted name, or '' when no credential was requested. */
  envName: string;
  /** Shape-only explanation when refused — names the identifier, never a value. */
  reason: string;
};

/** Env names declared by the canonical provider descriptors. */
export function canonicalDescriptorEnvNames(): Set<string> {
  const names = new Set<string>();
  for (const descriptor of Object.values(PROVIDER_CREDENTIALS)) {
    for (const name of descriptor.envNames ?? []) names.add(name);
  }
  return names;
}

/** Env names registered on existing external API sources. Failures yield an empty set. */
export async function registeredSourceEnvNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const { data, error } = await ownedDbTable('external_api_sources').select('api_key_env_name');
    if (error || !Array.isArray(data)) return names;
    for (const row of data as Array<{ api_key_env_name?: string | null }>) {
      const value = row?.api_key_env_name;
      // Only well-formed NAMES count. A legacy row holding a pasted secret must never
      // become an allowlist entry.
      if (typeof value === 'string' && isEnvVarName(value)) names.add(value);
    }
  } catch {
    /* fail closed: an unreadable registry grants nothing */
  }
  return names;
}

/**
 * Decide whether the caller-supplied env-var name may be resolved by the test endpoint.
 *
 * The reason string is shape-only — it names the rejected identifier, never a value.
 */
export async function assertTestableEnvVarName(raw: unknown): Promise<EnvNameDecision> {
  if (raw === null || typeof raw === 'undefined' || raw === '') {
    // No credential requested; the caller is testing an unauthenticated endpoint.
    return { allowed: true, envName: '', reason: '' };
  }
  if (typeof raw !== 'string' || !isEnvVarName(raw)) {
    return {
      allowed: false,
      envName: '',
      reason: 'api_key_env_name must be an environment variable NAME (A-Z, 0-9, underscore).',
    };
  }
  if (canonicalDescriptorEnvNames().has(raw)) return { allowed: true, envName: raw, reason: '' };
  if ((await registeredSourceEnvNames()).has(raw)) return { allowed: true, envName: raw, reason: '' };
  return {
    allowed: false,
    envName: '',
    reason:
      `"${raw}" is not registered as an external-API credential. Register the API source with `
      + 'this environment variable before testing it.',
  };
}
