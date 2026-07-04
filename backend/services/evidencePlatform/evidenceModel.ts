/**
 * Canonical Evidence Model  (BETA-ARCH-001, Phase 1)
 *
 * The single, extensible shape every current and future intelligence engine can use to describe one
 * unit of evidence. It is a DESCRIPTION layer: constructing an Evidence object performs no scoring,
 * no calculation, and no I/O. The factory is deterministic (no clock/random) so a deterministic
 * engine remains deterministic after adoption.
 *
 * Every field except `id`, `engineId`, `value`, and `maturity` is optional, so engines can adopt the
 * model incrementally without restating data they don't have. `metadata` is the open extension point.
 */
import type { EvidenceMaturity } from './evidenceMaturity';
import type { CanonicalConfidence } from './confidenceContract';
import type { CanonicalProvenance } from './provenance';

/** Where the underlying signal physically comes from. Open union (extensible via `(string & {})`). */
export type EvidenceSourceType =
  | 'first_party' // owned data (crawl, analytics, GSC-connected account)
  | 'external_api' // third-party API (SERP, backlink providers, reputation)
  | 'stored_config' // user/CMS-provided configuration
  | 'derived' // produced by another engine
  | 'heuristic' // rule/pattern inference
  | (string & {});

/** How the value was obtained relative to the subject. */
export type MeasurementType =
  | 'direct' // measured directly
  | 'aggregate' // rolled up from many observations
  | 'ratio'
  | 'count'
  | 'classification'
  | 'score'
  | (string & {});

/** The nature of the observation. */
export type ObservationType =
  | 'point' // a single point-in-time value
  | 'window' // computed over a time window
  | 'snapshot' // a full-state snapshot
  | 'event'
  | (string & {});

/** Validation lifecycle of an evidence value. */
export const VALIDATION_STATUS = {
  VALIDATED: 'validated',
  UNVALIDATED: 'unvalidated',
  FAILED: 'failed',
  NOT_APPLICABLE: 'not_applicable',
} as const;
export type ValidationStatus = (typeof VALIDATION_STATUS)[keyof typeof VALIDATION_STATUS];

/** Canonical freshness descriptor (mirrors the engines' existing freshness shape; not recomputed). */
export interface CanonicalFreshness {
  lastEvaluatedAt: string | null;
  dataAgeHours?: number | null;
  stale?: boolean | null;
}

/** A reference to another evidence object this one rests on. */
export interface EvidenceRef {
  id: string;
  engineId?: string;
  relation?: 'supports' | 'derived_from' | 'depends_on' | (string & {});
}

/**
 * One canonical unit of evidence. Carries all BETA-ARCH-001 Phase-1 fields.
 */
export interface Evidence {
  /** Stable, deterministic identifier (see `evidenceId`). */
  id: string;
  /** Producing engine (matches the Evidence Registry engineId). */
  engineId: string;
  /** Source system label, e.g. 'website_crawl', 'google_search_console'. */
  sourceSystem?: string | null;
  sourceType?: EvidenceSourceType;
  measurementType?: MeasurementType;
  observationType?: ObservationType;

  /** The canonical (typically normalized) evidence value. */
  value: number | string | boolean | null;
  /** The untransformed raw value, if different from `value`. */
  rawValue?: number | string | boolean | null;
  /** The normalized (e.g. 0..100) value, if applicable. */
  normalizedValue?: number | null;
  /** Unit of `rawValue`/`value`, e.g. 'score_0_100', 'count', 'ratio', 'ms'. */
  unit?: string | null;

  /** Canonical confidence descriptor (contract shape; engine confidence preserved, not recomputed). */
  confidence?: CanonicalConfidence;
  freshness?: CanonicalFreshness | null;
  /** When the underlying observation happened (ISO). */
  observedAt?: string | null;
  /** When the value was collected/computed (ISO). */
  collectedAt?: string | null;

  provenance?: CanonicalProvenance;
  /** How many underlying observations back this value. */
  evidenceCount?: number | null;
  validationStatus?: ValidationStatus;
  /** REQUIRED: every evidence value declares how it was produced. */
  maturity: EvidenceMaturity;

  /** Human/machine-readable calculation path, e.g. ['crawl_pages', 'evaluable_checks', 'aggregate']. */
  calculationPath?: string[];
  /** Other evidence this one is supported by. */
  supportingEvidence?: EvidenceRef[];
  /** Upstream dependencies (engine ids or evidence keys). */
  dependencies?: string[];

  /** Open extension point — never interpreted by the platform core. */
  metadata?: Record<string, unknown>;
}

/**
 * Deterministic evidence id: `<engineId>:<key>`. No random/uuid so identical inputs yield identical
 * ids (preserves engine determinism + makes evidence de-dupable/traceable).
 */
export function evidenceId(engineId: string, key: string): string {
  return `${engineId}:${key}`;
}

/**
 * Construct a canonical Evidence object. Pure + deterministic — no clock, no random, no I/O.
 * `engineId`, `key`, `value`, and `maturity` are required; everything else is optional metadata.
 */
export function createEvidence(input: {
  engineId: string;
  key: string;
  value: number | string | boolean | null;
  maturity: EvidenceMaturity;
} & Partial<Omit<Evidence, 'id' | 'engineId' | 'value' | 'maturity'>>): Evidence {
  const { engineId, key, value, maturity, ...rest } = input;
  return {
    id: evidenceId(engineId, key),
    engineId,
    value,
    maturity,
    ...rest,
  };
}
