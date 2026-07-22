/**
 * Coordination Intelligence Layer — feature flags (default-closed, additive).
 *
 * Matches the repo convention (e.g. autonomousFeatureFlag.ts): a named predicate
 * per flag, `SCREAMING_SNAKE` env var ending in `_ENABLED`, strict `=== 'true'`,
 * default OFF. The layer is inert until a consumer opts in — adopting it later is
 * therefore always safe and reversible by unsetting the flag.
 */

const REGISTRY_ENV = 'COORDINATION_REGISTRY_ENABLED';
const PERSIST_ENV = 'COORDINATION_REGISTRY_PERSIST_ENABLED';
const EMBEDDING_ENV = 'COORDINATION_SEMANTIC_EMBEDDING_ENABLED';

export const COORDINATION_REGISTRY_ENV_VAR = REGISTRY_ENV;
export const COORDINATION_PERSIST_ENV_VAR = PERSIST_ENV;
export const COORDINATION_EMBEDDING_ENV_VAR = EMBEDDING_ENV;

/**
 * Master switch a consumer checks before ROUTING through the coordination layer.
 * OFF (default) ⇒ a consumer should treat coordination as unavailable and behave
 * exactly as it does today.
 */
export function isCoordinationRegistryEnabled(): boolean {
  return process.env[REGISTRY_ENV] === 'true';
}

/**
 * Gates durable persistence. OFF (default) ⇒ the registry uses the in-memory
 * store (inert, process-local, safe). ON ⇒ the Supabase-backed store is used.
 */
export function isCoordinationPersistEnabled(): boolean {
  return process.env[PERSIST_ENV] === 'true';
}

/**
 * Gates the embedding seam. OFF (default) ⇒ the comparator never calls the
 * (cost-bearing) embedding provider; semantic comparison degrades to
 * `not_evaluable` rather than fabricating a similarity. ON ⇒ topic seeds are
 * embedded via the frozen `signalEmbeddingService` seam.
 */
export function isCoordinationEmbeddingEnabled(): boolean {
  return process.env[EMBEDDING_ENV] === 'true';
}
