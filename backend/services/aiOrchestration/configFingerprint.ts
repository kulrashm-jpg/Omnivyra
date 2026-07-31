/**
 * configFingerprint.ts — Configuration Fingerprint (AI-ORCH 2B.1A).
 *
 * THE single, canonical, deterministic fingerprint of the EFFECTIVE EXECUTION
 * SEMANTICS of an immutable Execution Profile Version. It exists so that config
 * comparison, audit, cache validation, rollback verification, and execution
 * reproducibility all key off ONE hash produced by ONE implementation — the exact
 * dual-implementation drift the platform's provider contracts (PB-001..006) guard
 * against.
 *
 * DORMANT IN 2B.1A. Nothing in any execution path imports this at runtime. It is
 * used only (a) offline to bake the seed fingerprints into the fingerprint
 * migration and (b) by its unit test. Later phases (the resolver / observability)
 * import THIS SAME module, so the fingerprint they compute at runtime is
 * byte-identical to the seeded ones. No hash is ever computed inside
 * executeGatewayCompletion / resolveLlmConfig / resolveEffectiveModel /
 * resolveTransport / aiCapabilityRuntime — those are untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS FINGERPRINTED (execution semantics only)
 *   mode · quality_tier · capability_requirements · resolved provider ref ·
 *   resolved model ref · model_version_tag · deployment_id · resolved routing
 *   content · params (temperature, top_p, max_output_tokens, reasoning_level,
 *   seed_policy, stop, penalties, …) · modality (streaming, structured_output,
 *   response_format, tool_calling, vision, image_params) · reliability (timeout_ms,
 *   max_retries, retry_policy, circuit_breaker, partial_allowed) · limits
 *   (max_cost_usd_per_call, token_ceiling) · caching (cacheable, ttl) · safety
 *   CONTENT (moderation, prompt_injection_guard, resolved safety-policy content).
 *
 * WHAT IS EXCLUDED (never affects execution semantics)
 *   surrogate DB ids (id, profile_id, provider_id, model_id, model_family_id,
 *   routing_policy_id, safety_policy_id) · version number · status · created_by ·
 *   created_at / updated_at · display names · descriptions · audit fields.
 *   NOTE: id-typed REFERENCES are excluded, but the RESOLVED CONTENT they point at
 *   (provider name, model key, routing chain, safety policy body) IS included —
 *   the caller resolves references to content before fingerprinting.
 *
 * DETERMINISM / ORDER-INDEPENDENCE
 *   - Object KEY order is normalized (keys sorted recursively), so a fingerprint
 *     never depends on the order fields happen to be written.
 *   - ARRAY element order is PRESERVED — it is semantically meaningful (a provider
 *     fallback chain, stop_sequences, …), so reordering an array is a real config
 *     change and must change the fingerprint.
 *   - null / undefined are treated as ABSENT and dropped, so "unset" is canonical
 *     regardless of whether it is stored as null or omitted.
 *   - The canonical form is JSON with sorted keys; the digest is SHA-256 hex.
 *
 * ALGORITHM TAG: 'sha256:v1'. Any change to the field set or canonicalization is a
 * NEW tag ('sha256:v2'), never a silent change — old fingerprints stay comparable.
 */
import { createHash } from 'crypto';

/** Current fingerprint algorithm tag. Bump on any semantic/canonicalization change. */
export const CONFIG_FINGERPRINT_ALGO = 'sha256:v1' as const;

// ── Separated fingerprint versioning (AI-ORCH-2B.1B) ─────────────────────────
// The combined `CONFIG_FINGERPRINT_ALGO` tag ('sha256:v1') decomposes into three
// INDEPENDENTLY-EVOLVING concepts, persisted separately on
// ai_execution_profile_versions (execution_schema_version / canonicalization_version
// / fingerprint_algorithm). These constants are the code-side source of truth for
// those columns; ADDITIVE — they change no fingerprint VALUE and no existing export.

/** Version of the SET of execution-semantic fields covered (EXECUTION_SEMANTIC_FIELDS). */
export const EXECUTION_SCHEMA_VERSION = 1 as const;
/** Version of the canonicalization algorithm (key-sort, null-drop, array-order-preserve). */
export const CANONICALIZATION_VERSION = 1 as const;
/** Hash function used for the digest. */
export const FINGERPRINT_ALGORITHM = 'sha256' as const;

/**
 * The execution-semantic view of a profile version. Callers resolve id-typed
 * references (provider/model/routing/safety-policy) to their CONTENT and pass that
 * content here — never surrogate ids. Every field is optional; absent === unset.
 */
export interface ExecutionSemantics {
  mode?: string | null;
  quality_tier?: string | null;
  capability_requirements?: Record<string, unknown> | null;
  /** Resolved provider name (e.g. 'openai'), NOT provider_id. */
  provider_ref?: string | null;
  /** Resolved model key (e.g. 'gpt-4o-mini'), NOT model_id. */
  model_ref?: string | null;
  model_version_tag?: string | null;
  deployment_id?: string | null;
  /** Resolved routing policy CONTENT (ordered chain + breaker), NOT routing_policy_id. */
  routing?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  modality?: Record<string, unknown> | null;
  reliability?: Record<string, unknown> | null;
  limits?: Record<string, unknown> | null;
  caching?: Record<string, unknown> | null;
  /** Safety CONTENT (moderation flags + resolved safety-policy body), NOT safety_policy_id. */
  safety?: Record<string, unknown> | null;
}

/** The exact, ordered set of execution-semantic top-level fields the fingerprint covers. */
export const EXECUTION_SEMANTIC_FIELDS: readonly (keyof ExecutionSemantics)[] = Object.freeze([
  'mode',
  'quality_tier',
  'capability_requirements',
  'provider_ref',
  'model_ref',
  'model_version_tag',
  'deployment_id',
  'routing',
  'params',
  'modality',
  'reliability',
  'limits',
  'caching',
  'safety',
]);

/**
 * Recursively produce a canonical value: sorted object keys, preserved array
 * order, null/undefined dropped. Pure; never mutates its input.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    // Preserve order (semantic); drop null/undefined elements canonically.
    return value.map((v) => (v === null || v === undefined ? null : canonicalize(v)));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const cv = canonicalize((value as Record<string, unknown>)[key]);
      if (cv !== undefined) out[key] = cv;
    }
    return out;
  }
  return value;
}

/**
 * Pick ONLY the execution-semantic fields from a profile-version-like row/object,
 * in canonical field order. Excludes every surrogate id / audit / display field
 * by construction (they are simply not selected).
 */
export function extractExecutionSemantics(row: ExecutionSemantics): ExecutionSemantics {
  const out: ExecutionSemantics = {};
  for (const field of EXECUTION_SEMANTIC_FIELDS) {
    const v = row[field];
    if (v !== null && v !== undefined) {
      // @ts-expect-error indexed assignment across the union is safe here.
      out[field] = v;
    }
  }
  return out;
}

/** The canonical JSON string a fingerprint is computed over (also useful for diffs). */
export function canonicalConfigString(semantics: ExecutionSemantics): string {
  return JSON.stringify(canonicalize(extractExecutionSemantics(semantics)));
}

/**
 * THE fingerprint: `sha256:v1:<64-hex>` over the canonical execution-semantics
 * string. Deterministic, key-order independent, stable across runs and machines.
 */
export function computeConfigFingerprint(semantics: ExecutionSemantics): string {
  const canonical = canonicalConfigString(semantics);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `${CONFIG_FINGERPRINT_ALGO}:${hex}`;
}
