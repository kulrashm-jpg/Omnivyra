/**
 * executionSnapshot.ts — ExecutionSnapshotBuilder + ExecutionSnapshotHasher (AI-ORCH 2A-2.2).
 *
 * The ONE new pure abstraction (ExecutionSnapshotBuilder) + a pure hashing utility
 * (ExecutionSnapshotHasher). Together they answer, evidence-based, "would these two
 * configurations EXECUTE identically?" — not merely "are their raw fields equal?".
 *
 * PURE. No execution, no persistence, no gateway integration, no I/O. Deterministic:
 * same input → same snapshot → same hash, every run. No heuristics, no probabilistic
 * equivalence — every normalization rule is a documented, deterministic transform.
 *
 * TWO REPRESENTATIONS per source:
 *   - raw:        the value as the source expressed it (null ≠ undefined ≠ value).
 *   - normalized: the canonical execution meaning (the ExecutionSnapshot).
 * The comparator diffs both (raw vs normalized) to classify equivalence.
 */
import { canonicalize } from './configFingerprint';
import { EXECUTION_SCHEMA_VERSION, CANONICALIZATION_VERSION, FINGERPRINT_ALGORITHM } from './configFingerprint';
import { tryToPlatformProviderId } from '../aiGatewayProviderIdentity';
import { createHash } from 'crypto';
import type { ResolvedExecutionPlan } from './types/ResolvedExecutionPlan';
import type { LegacyExecutionConfig } from './resolverComparator';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';

/** Normalization-rules version. Bump on any change to the rules below (never silent). */
export const NORMALIZATION_VERSION = 1 as const;

/** Sentinel for "unset" (null / undefined / missing / empty), after normalization. */
export const UNSET = 'UNSET' as const;

/**
 * The EXECUTION-affecting fields — the only ones that determine whether two configs
 * execute identically (and thus the only ones the snapshot HASH + equivalence cover).
 */
export const EXECUTION_FIELDS = Object.freeze([
  'provider', 'model', 'modelVersion', 'deployment',
  'temperature', 'topP', 'presencePenalty', 'frequencyPenalty', 'maxOutputTokens',
  'streaming', 'structuredOutput', 'vision', 'reasoning', 'responseFormat', 'toolCalling',
  'timeout', 'retries', 'retryPolicy', 'routingPolicy', 'safetyPolicy', 'cachePolicy',
  'seedPolicy', 'costLimit', 'tokenLimit',
] as const);

/**
 * PROVENANCE fields — carried in the snapshot for logging/identity, but EXCLUDED from
 * the equivalence comparison (a legacy call has no profile/fingerprint; comparing
 * identity would spuriously force DIFFERENT). Identity ≠ execution semantics.
 */
export const PROVENANCE_FIELDS = Object.freeze([
  'executionProfile', 'executionProfileVersion', 'configurationFingerprint',
  'executionSchemaVersion', 'canonicalizationVersion', 'fingerprintAlgorithm',
] as const);

export type ExecutionField = (typeof EXECUTION_FIELDS)[number];

/**
 * DOCUMENTED, deterministic platform defaults. An UNSET modality flag executes the
 * same as an explicit `false` (absent modality = off), so normalizing UNSET→false for
 * these lets "explicit default vs implicit default" be recognized as semantically
 * equivalent WITHOUT provider-specific guesswork. Only these clearly-documented
 * platform defaults are filled; every other UNSET stays UNSET (conservative).
 */
export const NORMALIZATION_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  streaming: false,
  structuredOutput: false,
  vision: false,
  toolCalling: false,
});

/** A raw execution config: any snapshot field → its raw value (may be null/undefined). */
export type RawExecutionConfig = Record<string, unknown>;

/** The canonical, normalized execution snapshot: field → normalized value. */
export type ExecutionSnapshot = Record<string, unknown>;

// ── Source adapters (plan / legacy → RawExecutionConfig) ─────────────────────

/** An empty (or all-unset) policy object carries no execution meaning → treat as absent. */
function nonEmptyObj(o: unknown): unknown {
  return o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o as object).length === 0 ? undefined : o;
}

export function rawConfigFromPlan(plan: ResolvedExecutionPlan): RawExecutionConfig {
  return {
    provider: plan.model.provider, model: plan.model.model, modelVersion: plan.model.modelVersion, deployment: plan.model.deploymentId,
    temperature: plan.params.temperature, topP: plan.params.topP, presencePenalty: undefined, frequencyPenalty: undefined,
    maxOutputTokens: plan.params.maxOutputTokens, streaming: plan.params.streaming, structuredOutput: plan.params.structuredOutput,
    vision: plan.params.vision, reasoning: plan.params.reasoningLevel, responseFormat: plan.params.responseFormat, toolCalling: plan.params.toolCalling,
    timeout: plan.reliability.timeoutMs, retries: plan.reliability.maxRetries, retryPolicy: plan.reliability.retryPolicy,
    routingPolicy: plan.routingPolicyKey ?? plan.routingPolicyId, safetyPolicy: nonEmptyObj(plan.safety), cachePolicy: nonEmptyObj(plan.caching),
    seedPolicy: plan.params.seedPolicy, costLimit: plan.limits.maxCostUsdPerCall, tokenLimit: plan.limits.tokenCeiling,
    // provenance (not compared)
    executionProfile: plan.profileKey, executionProfileVersion: plan.profileVersion, configurationFingerprint: plan.configFingerprint,
    executionSchemaVersion: EXECUTION_SCHEMA_VERSION, canonicalizationVersion: CANONICALIZATION_VERSION, fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
  };
}

/**
 * AI-ORCH 2A-2.3 — raw config from the FULL LegacyExecutionConfiguration produced by
 * the LegacyExecutionAdapter. Mirrors rawConfigFromPlan field-for-field (same
 * nonEmptyObj treatment) so the adapter's snapshot round-trips IDENTICALLY to the
 * plan's snapshot. Reuses the SAME builder — no second snapshot implementation.
 */
export function rawConfigFromLegacyConfiguration(cfg: LegacyExecutionConfiguration): RawExecutionConfig {
  return {
    provider: cfg.provider, model: cfg.model, modelVersion: cfg.modelVersion, deployment: cfg.deploymentId,
    temperature: cfg.temperature, topP: cfg.topP, presencePenalty: cfg.presencePenalty, frequencyPenalty: cfg.frequencyPenalty,
    maxOutputTokens: cfg.maxOutputTokens, streaming: cfg.streaming, structuredOutput: cfg.structuredOutput, vision: cfg.vision,
    reasoning: cfg.reasoning, responseFormat: cfg.responseFormat, toolCalling: cfg.toolCalling,
    timeout: cfg.timeoutMs, retries: cfg.maxRetries, retryPolicy: cfg.retryPolicy,
    routingPolicy: cfg.routingPolicy, safetyPolicy: nonEmptyObj(cfg.safety), cachePolicy: nonEmptyObj(cfg.cachePolicy),
    seedPolicy: cfg.seedPolicy, costLimit: cfg.costLimit, tokenLimit: cfg.tokenLimit,
    // provenance (not compared for execution equivalence)
    executionProfile: undefined, executionProfileVersion: undefined, configurationFingerprint: cfg.configFingerprint,
    executionSchemaVersion: EXECUTION_SCHEMA_VERSION, canonicalizationVersion: CANONICALIZATION_VERSION, fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
  };
}

export function rawConfigFromLegacy(legacy: LegacyExecutionConfig): RawExecutionConfig {
  return {
    provider: legacy.provider, model: legacy.model, modelVersion: legacy.modelVersion, deployment: undefined,
    temperature: legacy.temperature, topP: undefined, presencePenalty: undefined, frequencyPenalty: undefined,
    maxOutputTokens: legacy.maxOutputTokens, streaming: legacy.streaming, structuredOutput: legacy.structuredOutput,
    vision: legacy.vision, reasoning: undefined, responseFormat: undefined, toolCalling: undefined,
    timeout: legacy.timeoutMs, retries: legacy.maxRetries, retryPolicy: undefined,
    routingPolicy: undefined, safetyPolicy: undefined, cachePolicy: undefined,
    seedPolicy: undefined, costLimit: undefined, tokenLimit: undefined,
    executionProfile: undefined, executionProfileVersion: undefined, configurationFingerprint: undefined,
    executionSchemaVersion: undefined, canonicalizationVersion: undefined, fingerprintAlgorithm: undefined,
  };
}

// ── Normalization (deterministic; documented) ────────────────────────────────

/**
 * Normalize ONE field value → its canonical execution meaning:
 *   1. strings trimmed; empty → treated as unset
 *   2. `provider` mapped through the PB-006 identity map (chatgpt→openai, claude→
 *      anthropic; other aliases lowercased) so aliases and canonical ids agree
 *   3. null / undefined / empty → the documented default for that field, else UNSET
 *   4. objects → canonical (sorted keys, null dropped, array order preserved)
 */
export function normalizeField(field: string, value: unknown): unknown {
  let v = value;
  if (typeof v === 'string') v = v.trim();
  if (field === 'provider' && typeof v === 'string' && v.length > 0) {
    const mapped = tryToPlatformProviderId(v as any);
    return mapped ?? v.toLowerCase();
  }
  if (v === undefined || v === null || v === '') {
    return Object.prototype.hasOwnProperty.call(NORMALIZATION_DEFAULTS, field) ? NORMALIZATION_DEFAULTS[field] : UNSET;
  }
  if (typeof v === 'object') {
    const c = canonicalize(v);
    // An empty policy object (or one that canonicalizes to empty) carries no
    // execution meaning → treat as unset, so `{}` and "omitted" agree.
    if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c as object).length === 0) return UNSET;
    return c;
  }
  return v;
}

/**
 * ExecutionSnapshotBuilder — build the canonical normalized snapshot from a raw config.
 * Covers every EXECUTION + PROVENANCE field so the snapshot is complete; only the
 * EXECUTION fields participate in the hash + equivalence (see the comparator).
 */
export const ExecutionSnapshotBuilder = {
  build(raw: RawExecutionConfig): ExecutionSnapshot {
    const snap: ExecutionSnapshot = {};
    for (const field of [...EXECUTION_FIELDS, ...PROVENANCE_FIELDS]) {
      snap[field] = normalizeField(field, raw[field]);
    }
    return snap;
  },
  fromPlan(plan: ResolvedExecutionPlan): ExecutionSnapshot { return this.build(rawConfigFromPlan(plan)); },
  fromLegacy(legacy: LegacyExecutionConfig): ExecutionSnapshot { return this.build(rawConfigFromLegacy(legacy)); },
  fromLegacyConfiguration(cfg: LegacyExecutionConfiguration): ExecutionSnapshot { return this.build(rawConfigFromLegacyConfiguration(cfg)); },
};

// ── ExecutionSnapshotHasher (pure) ───────────────────────────────────────────

/**
 * Hash the EXECUTION subset of a snapshot: canonical JSON (sorted keys) → SHA-256.
 * Provenance fields are excluded so the hash means "these execute the same". Tagged
 * with the normalization version so a rules change never silently collides with old
 * hashes. Not persisted; not logged by default.
 */
export function hashExecutionSnapshot(snapshot: ExecutionSnapshot): string {
  const executionOnly: Record<string, unknown> = {};
  for (const field of EXECUTION_FIELDS) executionOnly[field] = snapshot[field];
  const canonical = JSON.stringify(canonicalize(executionOnly));
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `snap:v${NORMALIZATION_VERSION}:${hex}`;
}

export const ExecutionSnapshotHasher = { hash: hashExecutionSnapshot };
