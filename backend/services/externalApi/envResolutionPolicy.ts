/**
 * SEC91-B2 — which environment variables an external-API EXECUTION may resolve.
 *
 * `buildExternalApiRequest` substitutes server environment values into the outbound
 * request — `api_key_env_name` (Authorization / apiKey) and every upper-case
 * `{{ENV_NAME}}` header or query template — and sends it to the source's `base_url`.
 * Before this policy it resolved `process.env[name]` for ANY name. A tenant who can edit
 * a source (base_url, api_key_env_name, headers, query_params) could therefore have e.g.
 * `{{SUPABASE_SECRET_KEY}}` delivered to a server they control — by a scheduled run, or
 * by a Super Admin pressing "test" on the tenant's row.
 *
 * Reusing the registry approach of testEnvAllowlist.ts (no new hand-kept list of provider
 * keys), a name resolves only when ALL of the following hold:
 *
 *   1. it is a well-formed env-var NAME and NOT a platform infrastructure secret
 *      (infrastructureSecretNames.ts — Supabase, DB, Redis, payment, signing keys, …);
 *   2. it is DECLARED as an external-API credential for this request:
 *        - the canonical provider descriptors (PROVIDER_CREDENTIALS[*].envNames),
 *        - the code presets (externalApiPresets: api_key_env_name + {{TEMPLATE}} names),
 *        - the source's own api_key_env_name / api_key_name, and the provider account's
 *          env reference (both written only by the row's configurer / Super Admin),
 *        - names the caller explicitly approved (the ad-hoc test route, after
 *          assertTestableEnvVarName);
 *   3. the DESTINATION is approved for platform credentials:
 *        - platform rows (company_id IS NULL) are Super-Admin-authored → approved;
 *        - tenant rows only when Super Admin whitelisted THIS configuration
 *          (is_whitelisted === true; any tenant edit of base_url / auth / env names /
 *          headers / query templates resets it — pages/api/external-apis/[id].ts), or when
 *          the name is declared by a code preset whose base_url has the SAME ORIGIN as the
 *          row (company-installed presets keep working; the key only ever goes to the
 *          provider it belongs to).
 *
 * A refused name resolves to `undefined`: it is reported in `missingEnv` and its
 * `{{TEMPLATE}}` stays literal in the request, so no value is ever substituted.
 */
import { PROVIDER_CREDENTIALS } from '../providerCredentialResolver';
import { externalApiPresets } from '../externalApiPresets';
import { isEnvVarName } from '../../security/credentialSafety';
import { isPlatformInfrastructureSecretName } from './infrastructureSecretNames';

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export type EnvPolicySource = {
  base_url?: string | null;
  company_id?: string | null;
  is_whitelisted?: boolean | null;
  api_key_env_name?: string | null;
  api_key_name?: string | null;
};

export type EnvPolicyContext = {
  /** Env reference of the resolved provider account (Super-Admin managed), if any. */
  accountEnvName?: string | null;
  /** Names the caller has already approved through its own gate (ad-hoc test route). */
  approvedEnvNames?: readonly string[] | null;
};

function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function templateNames(record: Record<string, unknown> | undefined | null): string[] {
  const out: string[] = [];
  for (const v of Object.values(record ?? {})) {
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(TEMPLATE_RE)) out.push(m[1]);
  }
  return out;
}

let presetOriginsCache: Map<string, Set<string>> | null = null;

/** Env name → origins of the code presets that declare it. */
export function presetEnvNameOrigins(): Map<string, Set<string>> {
  if (presetOriginsCache) return presetOriginsCache;
  const map = new Map<string, Set<string>>();
  for (const preset of externalApiPresets) {
    const origin = originOf(preset.base_url);
    if (!origin) continue;
    const names = [
      preset.api_key_env_name ?? null,
      ...templateNames(preset.headers),
      ...templateNames(preset.query_params as Record<string, unknown>),
    ].filter((n): n is string => typeof n === 'string' && isEnvVarName(n));
    for (const n of names) {
      if (!map.has(n)) map.set(n, new Set());
      map.get(n)!.add(origin);
    }
  }
  presetOriginsCache = map;
  return map;
}

/** Canonical descriptor + code-preset credential env names. */
export function declaredProviderEnvNames(): Set<string> {
  const names = new Set<string>();
  for (const d of Object.values(PROVIDER_CREDENTIALS)) for (const n of d.envNames ?? []) names.add(n);
  for (const n of presetEnvNameOrigins().keys()) names.add(n);
  return names;
}

function isTenantOwned(source: EnvPolicySource): boolean {
  return typeof source.company_id === 'string' && source.company_id.trim() !== '';
}

/** The decision, exported for tests and diagnostics. Never looks at a value. */
export function isEnvNameResolvableForSource(
  name: unknown,
  source: EnvPolicySource,
  ctx: EnvPolicyContext = {},
): boolean {
  if (typeof name !== 'string' || !isEnvVarName(name)) return false;
  const n = name.trim();
  if (isPlatformInfrastructureSecretName(n)) return false;
  if (ctx.approvedEnvNames?.includes(n)) return true;

  const own = [source.api_key_env_name, source.api_key_name, ctx.accountEnvName]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
  const declared = declaredProviderEnvNames().has(n) || own.includes(n);

  if (!isTenantOwned(source)) return declared;
  if (source.is_whitelisted === true) return declared;
  // Unapproved tenant configuration: only a preset-declared key, and only towards that
  // preset's own origin.
  const origins = presetEnvNameOrigins().get(n);
  const origin = originOf(source.base_url);
  return Boolean(origins && origin && origins.has(origin));
}

/**
 * The resolver `buildExternalApiRequest` uses for this source. Returns the env value only
 * when the policy allows the name; otherwise `undefined` (reported as missing).
 */
export function createSourceEnvResolver(
  source: EnvPolicySource,
  ctx: EnvPolicyContext = {},
): (name?: string | null) => string | undefined {
  return (name?: string | null) => {
    if (!name) return undefined;
    if (!isEnvNameResolvableForSource(name, source, ctx)) return undefined;
    const value = process.env[name.trim()];
    return value ? value : undefined;
  };
}
