/**
 * resolverComparator.ts — ResolverComparator (AI-ORCH 2A-2).
 *
 * Compares the LEGACY execution configuration (what the gateway actually used) with
 * the resolver's ResolvedExecutionPlan and produces a field-level ParityResult
 * (MATCH | MISMATCH). Used ONLY in shadow mode to measure how faithfully the resolver
 * would reproduce today's behavior before it is ever made authoritative.
 *
 * PURE + READ-ONLY. It compares two objects and returns a verdict. It NEVER modifies
 * execution, never persists, never throws for a normal mismatch.
 */
import type { ResolvedExecutionPlan } from './types/ResolvedExecutionPlan';

/** The legacy execution configuration a real call used (extracted by the shadow hook). */
export interface LegacyExecutionConfig {
  provider?: string | null;
  model?: string | null;
  modelVersion?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  streaming?: boolean | null;
  structuredOutput?: boolean | null;
  vision?: boolean | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
}

export type ParityStatus = 'MATCH' | 'MISMATCH';

/**
 * The categorized kind of a parity outcome (AI-ORCH 2A-2.1). MATCH for no diffs, a
 * single field's category for exactly one diff, MULTIPLE for >1, UNKNOWN as a guard
 * for an unmapped field.
 */
export type MismatchCategory =
  | 'MATCH'
  | 'PROVIDER_MISMATCH'
  | 'MODEL_MISMATCH'
  | 'MODEL_VERSION_MISMATCH'
  | 'PROFILE_MISMATCH'
  | 'PARAMETER_MISMATCH'
  | 'TIMEOUT_MISMATCH'
  | 'RETRY_MISMATCH'
  | 'STREAMING_MISMATCH'
  | 'STRUCTURED_OUTPUT_MISMATCH'
  | 'VISION_MISMATCH'
  | 'ROUTING_MISMATCH'
  | 'FINGERPRINT_MISMATCH'
  | 'MULTIPLE'
  | 'UNKNOWN';

export interface ParityFieldDiff {
  field: string;
  legacy: unknown;
  resolved: unknown;
  /** The per-field mismatch category. */
  category: MismatchCategory;
  /** Human-readable reason for the diff. */
  reason: string;
}

export interface ParityResult {
  status: ParityStatus;
  /** Overall category: MATCH · a single field's category · MULTIPLE · UNKNOWN. */
  mismatchCategory: MismatchCategory;
  diffs: ParityFieldDiff[];
  /** Every field that was compared (for observability of coverage). */
  comparedFields: string[];
}

/** Map a compared field to its mismatch category. */
const FIELD_CATEGORY: Record<string, MismatchCategory> = {
  provider:         'PROVIDER_MISMATCH',
  model:            'MODEL_MISMATCH',
  modelVersion:     'MODEL_VERSION_MISMATCH',
  profile:          'PROFILE_MISMATCH',
  temperature:      'PARAMETER_MISMATCH',
  maxOutputTokens:  'PARAMETER_MISMATCH',
  streaming:        'STREAMING_MISMATCH',
  structuredOutput: 'STRUCTURED_OUTPUT_MISMATCH',
  vision:           'VISION_MISMATCH',
  timeoutMs:        'TIMEOUT_MISMATCH',
  maxRetries:       'RETRY_MISMATCH',
  routing:          'ROUTING_MISMATCH',
  fingerprint:      'FINGERPRINT_MISMATCH',
};

/** Treat null and undefined identically as "unset". */
const norm = (v: unknown): unknown => (v === undefined ? null : v);
const eq = (a: unknown, b: unknown): boolean => norm(a) === norm(b);

/**
 * Compare a legacy config to a resolved plan. Each listed field is compared with
 * null/undefined normalized to "unset". Any inequality (including one side setting a
 * value the other leaves unset) is a diff — surfacing exactly where the resolver
 * would diverge from today's behavior. Each diff is categorized; the overall
 * `mismatchCategory` is MATCH / the single field's category / MULTIPLE / UNKNOWN.
 */
export function compareToLegacy(legacy: LegacyExecutionConfig, plan: ResolvedExecutionPlan): ParityResult {
  const pairs: Array<{ field: string; legacy: unknown; resolved: unknown }> = [
    { field: 'provider',         legacy: legacy.provider,         resolved: plan.model.provider },
    { field: 'model',            legacy: legacy.model,            resolved: plan.model.model },
    { field: 'modelVersion',     legacy: legacy.modelVersion,     resolved: plan.model.modelVersion },
    { field: 'temperature',      legacy: legacy.temperature,      resolved: plan.params.temperature },
    { field: 'maxOutputTokens',  legacy: legacy.maxOutputTokens,  resolved: plan.params.maxOutputTokens },
    { field: 'streaming',        legacy: legacy.streaming,        resolved: plan.params.streaming },
    { field: 'structuredOutput', legacy: legacy.structuredOutput, resolved: plan.params.structuredOutput },
    { field: 'vision',           legacy: legacy.vision,           resolved: plan.params.vision },
    { field: 'timeoutMs',        legacy: legacy.timeoutMs,        resolved: plan.reliability.timeoutMs },
    { field: 'maxRetries',       legacy: legacy.maxRetries,       resolved: plan.reliability.maxRetries },
  ];

  const diffs: ParityFieldDiff[] = [];
  for (const p of pairs) {
    if (!eq(p.legacy, p.resolved)) {
      const category = FIELD_CATEGORY[p.field] ?? 'UNKNOWN';
      diffs.push({
        field: p.field,
        legacy: norm(p.legacy),
        resolved: norm(p.resolved),
        category,
        reason: `${p.field}: legacy=${JSON.stringify(norm(p.legacy))} resolved=${JSON.stringify(norm(p.resolved))}`,
      });
    }
  }

  let mismatchCategory: MismatchCategory;
  if (diffs.length === 0) mismatchCategory = 'MATCH';
  else if (diffs.length === 1) mismatchCategory = diffs[0].category;
  else mismatchCategory = 'MULTIPLE';

  return {
    status: diffs.length === 0 ? 'MATCH' : 'MISMATCH',
    mismatchCategory,
    diffs,
    comparedFields: pairs.map((p) => p.field),
  };
}

// ── Execution equivalence (AI-ORCH 2A-2.2) ───────────────────────────────────
// A stronger question than field parity: "would these two configs EXECUTE
// identically?" Built on canonical ExecutionSnapshots — evidence-based, deterministic,
// no heuristics. Extends the comparator; does not replace compareToLegacy.

/** Three-level equivalence verdict. */
export type EquivalenceLevel = 'IDENTICAL' | 'SEMANTICALLY_EQUIVALENT' | 'DIFFERENT';

/** Classification of one difference. */
export type DifferenceCategory =
  | 'CONFIGURATION_DIFFERENCE'   // one side specifies a field the other leaves unset
  | 'SEMANTIC_DIFFERENCE'        // (reserved) meaning differs though raw looks similar
  | 'NORMALIZATION_DIFFERENCE'   // raw differs, normalized identical (null/undefined, alias, default)
  | 'EXECUTION_DIFFERENCE'       // both set, values differ → executes differently
  | 'UNSUPPORTED_DIFFERENCE'     // (reserved) provider cannot honor the field
  | 'UNKNOWN_DIFFERENCE';        // guard for an unmapped field

export interface EquivalenceFieldDiff {
  field: string;
  legacy: unknown;
  resolved: unknown;
  category: DifferenceCategory;
}

export interface EquivalenceResult {
  level: EquivalenceLevel;
  reason: string;
  snapshotHashLegacy: string;
  snapshotHashResolver: string;
  snapshotHashMatch: boolean;
  /** Fields whose RAW values differ (regardless of normalized outcome). */
  rawDiffs: EquivalenceFieldDiff[];
  /** Fields whose NORMALIZED values differ (i.e. real execution divergence). */
  normalizedDiffs: EquivalenceFieldDiff[];
  rawDifferenceCount: number;
  normalizedDifferenceCount: number;
  executionDifferenceCount: number;
  normalizationDifferenceCount: number;
}

/** Stable identity key for a value (distinguishes null vs undefined vs typed scalars). */
function valueKey(v: unknown): string {
  if (v === undefined) return 'U';
  if (v === null) return 'N';
  if (typeof v === 'object') return 'O:' + JSON.stringify(v);
  return (typeof v)[0] + ':' + String(v);
}

/**
 * Whether a RAW field value is genuinely unset (the source omitted it) — mirrors the
 * snapshot's unset rule (null/undefined/empty-string/empty-object) BEFORE any
 * normalization default is applied. Used to keep UNSET distinguishable from an
 * explicit value so an omitted field never counts as an execution difference.
 */
function isRawUnset(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Compare a legacy config and a resolved plan for EXECUTION EQUIVALENCE via canonical
 * snapshots. Returns raw + normalized diffs, both snapshot hashes, and the level:
 *   IDENTICAL             — raw AND normalized identical on every execution field.
 *   SEMANTICALLY_EQUIVALENT — normalized identical, but some raw representations differ
 *                             (null vs undefined, provider alias, explicit vs implicit default).
 *   DIFFERENT             — a normalized execution field differs.
 */
export function compareExecutionEquivalence(
  legacy: LegacyExecutionConfig,
  plan: ResolvedExecutionPlan,
): EquivalenceResult {
  // Lazy import to keep the field-parity path dependency-free.
  const {
    ExecutionSnapshotBuilder, hashExecutionSnapshot, EXECUTION_FIELDS, UNSET,
    rawConfigFromLegacy, rawConfigFromPlan, normalizeField,
  } = require('./executionSnapshot') as typeof import('./executionSnapshot');

  const rawLegacy = rawConfigFromLegacy(legacy);
  const rawResolved = rawConfigFromPlan(plan);
  const snapLegacy = ExecutionSnapshotBuilder.build(rawLegacy);
  const snapResolved = ExecutionSnapshotBuilder.build(rawResolved);

  const rawDiffs: EquivalenceFieldDiff[] = [];
  const normalizedDiffs: EquivalenceFieldDiff[] = [];

  for (const field of EXECUTION_FIELDS) {
    const rawL = rawLegacy[field];
    const rawR = rawResolved[field];
    const normL = snapLegacy[field];
    const normR = snapResolved[field];
    const rawEqual = valueKey(rawL) === valueKey(rawR);
    const normEqual = valueKey(normL) === valueKey(normR);

    if (!normEqual) {
      // Fidelity (Phase 3B): a field OMITTED on one side must never register as an
      // EXECUTION_DIFFERENCE merely because a documented normalization default (e.g.
      // streaming UNSET→false) then differs from the other side's explicit value. The
      // omitting side expressed no execution intent, so this is a
      // CONFIGURATION_DIFFERENCE (resolver-more-complete), not behavioural divergence.
      // A genuine EXECUTION_DIFFERENCE requires BOTH sides to carry an explicit value.
      const oneUnset = isRawUnset(rawL) || isRawUnset(rawR) || normL === UNSET || normR === UNSET;
      const category: DifferenceCategory = oneUnset ? 'CONFIGURATION_DIFFERENCE' : 'EXECUTION_DIFFERENCE';
      normalizedDiffs.push({ field, legacy: normL, resolved: normR, category });
      rawDiffs.push({ field, legacy: rawL, resolved: rawR, category });
    } else if (!rawEqual) {
      rawDiffs.push({ field, legacy: rawL, resolved: rawR, category: 'NORMALIZATION_DIFFERENCE' });
    }
  }

  const snapshotHashLegacy = hashExecutionSnapshot(snapLegacy);
  const snapshotHashResolver = hashExecutionSnapshot(snapResolved);
  const snapshotHashMatch = snapshotHashLegacy === snapshotHashResolver;

  const executionDifferenceCount = normalizedDiffs.filter((d) => d.category === 'EXECUTION_DIFFERENCE').length;
  const configurationDifferenceCount = normalizedDiffs.filter((d) => d.category === 'CONFIGURATION_DIFFERENCE').length;
  const normalizationDifferenceCount = rawDiffs.filter((d) => d.category === 'NORMALIZATION_DIFFERENCE').length;

  let level: EquivalenceLevel;
  let reason: string;
  if (normalizedDiffs.length === 0) {
    if (rawDiffs.length === 0) { level = 'IDENTICAL'; reason = 'raw + normalized identical on every execution field'; }
    else { level = 'SEMANTICALLY_EQUIVALENT'; reason = `${normalizationDifferenceCount} normalization-only diff(s); normalized execution identical`; }
  } else {
    level = 'DIFFERENT';
    reason = `${executionDifferenceCount} execution + ${configurationDifferenceCount} configuration diff(s)`;
  }

  return {
    level, reason,
    snapshotHashLegacy, snapshotHashResolver, snapshotHashMatch,
    rawDiffs, normalizedDiffs,
    rawDifferenceCount: rawDiffs.length,
    normalizedDifferenceCount: normalizedDiffs.length,
    executionDifferenceCount,
    normalizationDifferenceCount,
  };
}
