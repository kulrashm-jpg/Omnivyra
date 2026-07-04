/**
 * Canonical Provenance Model  (BETA-ARCH-001, Phase 3)
 *
 * Every canonical evidence object can identify exactly where its value came from and how it was
 * transformed. Deterministic + pure: builders take explicit inputs and never call Date.now()/random,
 * so an engine that is deterministic stays deterministic after adopting provenance.
 */

/** One deterministic transformation/calculation applied on the path from origin → value. */
export interface ProvenanceStep {
  /** Short machine label, e.g. 'aggregate', 'clamp', 'geometric_mean', 'ratio'. */
  op: string;
  /** Optional human detail, e.g. 'evaluable/total'. */
  detail?: string;
}

export interface CanonicalProvenance {
  /** The ultimate data origin, e.g. 'canonical_pages', 'google_search_console', 'canonical_backlink_signals'. */
  origin: string;
  /** What collected the raw signal, e.g. 'regex_crawler', 'gsc_ingestion', 'analytics_ingestion'. */
  collector?: string | null;
  /** The engine that produced the value (engineId). */
  engine: string;
  /** Deterministic transformation steps (data shaping). */
  transformationSteps: ProvenanceStep[];
  /** Deterministic calculation steps (numeric derivation). */
  calculationSteps: ProvenanceStep[];
  /** Engine/contract version at production time. */
  version: string;
  /** The observation/collection timestamp this provenance describes (ISO), or null if unknown. */
  timestamp: string | null;
  /** Optional validator identifier that attested the value. */
  validator?: string | null;
}

/** Deterministic provenance builder. All values explicit — no clock/random access. */
export function buildProvenance(input: {
  origin: string;
  engine: string;
  version: string;
  collector?: string | null;
  transformationSteps?: ProvenanceStep[];
  calculationSteps?: ProvenanceStep[];
  timestamp?: string | null;
  validator?: string | null;
}): CanonicalProvenance {
  return {
    origin: input.origin,
    collector: input.collector ?? null,
    engine: input.engine,
    transformationSteps: input.transformationSteps ?? [],
    calculationSteps: input.calculationSteps ?? [],
    version: input.version,
    timestamp: input.timestamp ?? null,
    validator: input.validator ?? null,
  };
}
