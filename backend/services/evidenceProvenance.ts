/**
 * Canonical evidence PROVENANCE boundary (Phase 2).
 *
 * The canonical report already records evidence *strength* (`ScoreState`: measured /
 * inferred / insufficient_signal / unavailable) and evidence *kind*
 * (`EvidenceSourceKind`: crawler, gsc, wikidata, …). What it could not express is
 * evidence *origin* — whether a signal came from the public web or from a private,
 * customer-connected source.
 *
 * Report 1 (Digital Snapshot) is a PUBLIC-DOMAIN report: it may only assert things
 * Omnivyra can independently observe about a company from outside. Report 2 and later
 * layers additionally consume company-confirmed answers, Omnivyra's own activity, and
 * connected analytics. Without a provenance axis those two worlds are indistinguishable
 * at the type level, and private evidence can silently leak into a public report.
 *
 * This module adds ONLY that axis. It changes no score, no engine and no output on its
 * own; it is the classification vocabulary plus a deterministic mapping from the
 * existing `EvidenceSourceKind` union, so nothing has to be re-tagged by hand.
 */
import type { EvidenceSourceKind } from './canonicalReport/canonicalReportTypes';

/**
 * Where a piece of evidence came from, independent of how strong it is.
 *
 * Report 1 may use the first four. The last three exist so the system can *recognise*
 * private evidence and keep it out — they are not consumed by Report 1 today.
 */
export type EvidenceProvenanceClass =
  /** Directly observed from a public source (the company's own site, SERP, an answer engine, a public graph). */
  | 'PUBLIC_OBSERVED'
  /** Derived by deterministic reasoning over public observations. Not itself observed. */
  | 'INFERRED'
  /** Modelled or approximated from public observations. Weaker than INFERRED. */
  | 'ESTIMATED'
  /** The required evidence could not be obtained at all. */
  | 'UNAVAILABLE'
  /** The company told us (profile answers, confirmed facts). Report 2+. */
  | 'COMPANY_CONFIRMED'
  /** Omnivyra's own platform activity for this tenant (campaigns, content, history). Report 2+. */
  | 'OMNIVYRA_OBSERVED'
  /** A private source the customer connected (GA4, Search Console, CRM). Report 2+. */
  | 'CONNECTED_SOURCE';

/** The provenance classes Report 1 is permitted to assert on. */
export const REPORT1_PROVENANCE: ReadonlySet<EvidenceProvenanceClass> = new Set([
  'PUBLIC_OBSERVED',
  'INFERRED',
  'ESTIMATED',
  'UNAVAILABLE',
]);

/** Provenance classes that represent private / customer-owned evidence. Never Report 1. */
export const PRIVATE_PROVENANCE: ReadonlySet<EvidenceProvenanceClass> = new Set([
  'COMPANY_CONFIRMED',
  'OMNIVYRA_OBSERVED',
  'CONNECTED_SOURCE',
]);

/**
 * Deterministic mapping from the EXISTING evidence-source vocabulary to provenance.
 *
 * Rationale for the non-obvious entries:
 *  • `gsc` is CONNECTED_SOURCE — Search Console data exists only because the customer
 *    granted OAuth. It is private, even though it describes public search behaviour.
 *    This is the single most important entry in this table: it is the boundary that
 *    keeps Report 1 honest about being a public report.
 *  • `trajectory_history` is OMNIVYRA_OBSERVED — it is Omnivyra's own stored history of
 *    previous scans for this tenant, not an external observation.
 *  • `decisions` and `heuristic` are INFERRED — both are derived from other observations
 *    rather than observed directly.
 *  • `benchmark_dataset` is ESTIMATED — a peer distribution positions a company by
 *    modelling, not by observing that company.
 *  • `unspecified` maps to UNAVAILABLE so an untagged observation can never be mistaken
 *    for a public measurement.
 */
const PROVENANCE_BY_SOURCE: Record<EvidenceSourceKind, EvidenceProvenanceClass> = {
  crawler: 'PUBLIC_OBSERVED',
  public_audit: 'PUBLIC_OBSERVED',
  competitor_intelligence: 'PUBLIC_OBSERVED',
  // GAP-06/07: own-domain rows read from public search results. Publicly observable by anyone —
  // deliberately distinct from `gsc`, which describes the same search engine but through the
  // customer's authenticated, private property.
  serp: 'PUBLIC_OBSERVED',
  social_links: 'PUBLIC_OBSERVED',
  wikidata: 'PUBLIC_OBSERVED',
  google_kg: 'PUBLIC_OBSERVED',
  schema_org: 'PUBLIC_OBSERVED',
  // D1 — a retrieval-grounded answer engine returned the sources behind its
  // answer. Anyone can open those URLs and check them, which is exactly what
  // PUBLIC_OBSERVED means here.
  answer_engine: 'PUBLIC_OBSERVED',
  // D1 — DEMOTED, and this is the entry that let a fabrication reach Report 1.
  // A chat model answering "What is {brand}?" from its weights has observed
  // nothing: the question contains the brand, so a confabulated answer names it
  // by construction and scored identically to a genuine citation. Classing that
  // as PUBLIC_OBSERVED made the provenance boundary — the mechanism built to
  // keep unverifiable evidence out — wave it through. A model's recall is an
  // inference about the world, never an observation of it.
  llm_probe: 'INFERRED',
  backlink_api: 'PUBLIC_OBSERVED',
  review_aggregator: 'PUBLIC_OBSERVED',
  expertise_extractor: 'INFERRED',
  decisions: 'INFERRED',
  heuristic: 'INFERRED',
  benchmark_dataset: 'ESTIMATED',
  trajectory_history: 'OMNIVYRA_OBSERVED',
  gsc: 'CONNECTED_SOURCE',
  unspecified: 'UNAVAILABLE',
};

/** Provenance for one evidence source. Total over the union — no default branch. */
export function provenanceForSource(source: EvidenceSourceKind): EvidenceProvenanceClass {
  return PROVENANCE_BY_SOURCE[source] ?? 'UNAVAILABLE';
}

/** True when this provenance class may appear in Report 1. */
export function isReport1Provenance(provenance: EvidenceProvenanceClass): boolean {
  return REPORT1_PROVENANCE.has(provenance);
}

/** True when this evidence source is public and therefore Report 1 eligible. */
export function isReport1Source(source: EvidenceSourceKind): boolean {
  return isReport1Provenance(provenanceForSource(source));
}

export interface ProvenanceSummary {
  /** Distinct provenance classes present across the inspected sources. */
  classes: EvidenceProvenanceClass[];
  /** Sources that are NOT Report 1 eligible (private / connected). Empty is the healthy state. */
  privateSources: EvidenceSourceKind[];
  /** True when every inspected source is Report 1 eligible. */
  report1Clean: boolean;
}

/**
 * Summarise the provenance of a set of evidence sources. Used by the Report 1
 * regression test to assert that no private source reached the public report.
 */
export function summarizeProvenance(sources: readonly EvidenceSourceKind[]): ProvenanceSummary {
  const classes = new Set<EvidenceProvenanceClass>();
  const privateSources: EvidenceSourceKind[] = [];
  for (const source of sources) {
    const provenance = provenanceForSource(source);
    classes.add(provenance);
    if (PRIVATE_PROVENANCE.has(provenance)) privateSources.push(source);
  }
  return {
    classes: [...classes],
    privateSources,
    report1Clean: privateSources.length === 0,
  };
}

/**
 * G-8 — provenance of a persisted `social_profiles` entry.
 *
 * THE DEFECT THIS ANSWERS
 * `persistResolvedReportInputs` stamped every resolved social URL with
 * `source: 'report_input', confidence: 'high'`, overwriting the per-entry `source` the refinement
 * pipeline had already established (`buildSocialProfileList` carries the extraction's own
 * `source`/`confidence` through). A URL the company typed into the report form was therefore
 * stored as indistinguishable from one observed on the company's own website.
 *
 * The two are not the same kind of evidence: a declared link is the company asserting an identity,
 * a discovered link is a public observation of one. This maps the EXISTING per-entry vocabulary
 * onto the EXISTING provenance taxonomy — it adds no field, no table and no second taxonomy.
 *
 *   'website' | 'social'          the link was read off a public page          → PUBLIC_OBSERVED
 *   'user' | 'report_input'       the company supplied it                      → COMPANY_CONFIRMED
 *   'inferred'                    derived rather than seen                     → INFERRED
 *   'missing' | absent | unknown  no evidence of origin survives               → UNAVAILABLE
 *
 * UNAVAILABLE for the unknown case is deliberate and matches `unspecified` in the source table
 * above: an untagged entry must never be readable as a public measurement.
 */
export function provenanceForSocialProfileSource(
  source: string | null | undefined,
): EvidenceProvenanceClass {
  switch ((source ?? '').trim().toLowerCase()) {
    case 'website':
    case 'social':
      return 'PUBLIC_OBSERVED';
    case 'user':
    case 'report_input':
      return 'COMPANY_CONFIRMED';
    case 'inferred':
      return 'INFERRED';
    default:
      return 'UNAVAILABLE';
  }
}

// ── D3 — DECISION-LEVEL PROVENANCE ──────────────────────────────────────────
//
// WHY THIS EXISTS. The table above classifies an EvidenceSourceKind, and
// `enforceTraceProvenance` applies it to every EvidenceTrace entering Report 1.
// But Report 1's `visual_intelligence` surface is not built from traces — it is
// built from persisted DECISION OBJECTS, so it never passed that gate.
//
// The consequence was a live contract violation. `seoIntelligenceService` reads
// the customer's connected Search Console property and emits `report_tier:
// 'snapshot'` decisions carrying `impressions`, `clicks`, `ctr` and
// `avg_position`. Those flowed into `search_visibility_funnel` (stamped
// `confidence: 'high'`), into `seo_capability_radar.rank_tracking_score` (tagged
// `['GSC']`, state `measured`) and into `opportunity_coverage_matrix` — and out
// through the Report 1 payload.
//
// GAP-07 had already named this exact hazard and closed half of it: Report 1
// stopped DERIVING its search-visibility and digital-snapshot readings from the
// GSC axis, because "a private signal acquiring public-observed standing merely
// by entering a Report 1 dimension" was the prohibition. What it did not do was
// stop Report 1 from SHIPPING the axis. Not deriving from private evidence and
// not publishing it are two different things; only the first was done.
//
// This is deliberately part of the existing provenance module rather than a
// second one. There is one provenance vocabulary; this adds the decision-shaped
// entry point to it.

/**
 * Services whose decisions carry CONNECTED_SOURCE evidence.
 *
 * Membership is a claim about where a service gets its facts, established by
 * reading what it consumes — not inferred from its name:
 *
 *   seoIntelligenceService         Search Console via `searchConsoleProviderBridge`
 *                                  + `keyword_metrics` (GSC ingestion)
 *   intentIntelligenceService      `searchConsoleProviderBridge` + `keyword_metrics`
 *   geoStrategyIntelligenceService `searchConsoleProviderBridge` + `keyword_metrics`
 *   trafficIntelligenceService     GA4 `canonical_sessions`
 *   distributionIntelligenceService            GA4 `canonical_sessions`
 *   advancedRevenueAttributionIntelligenceService  GA4 `canonical_sessions`
 *
 * Of these, only `seoIntelligenceService` currently emits snapshot-tier
 * decisions, so only it can reach Report 1 today. The others are listed because
 * the boundary must hold the moment one of them does, and an architectural test
 * asserts that this set stays in step with what actually emits snapshot tier.
 */
export const CONNECTED_SOURCE_DECISION_SERVICES: ReadonlySet<string> = new Set([
  'seoIntelligenceService',
  'intentIntelligenceService',
  'geoStrategyIntelligenceService',
  'trafficIntelligenceService',
  'distributionIntelligenceService',
  'advancedRevenueAttributionIntelligenceService',
]);

/**
 * The provenance class of a decision, from the service that produced it.
 *
 * Anything not known to read a connected source is `PUBLIC_OBSERVED` — the
 * decision producers are crawl-, SERP- and audit-derived by default, and the
 * connected ones are the enumerated exception. A service added later that reads
 * private data and is NOT listed here would be misclassified, which is what the
 * architectural guard in the D3 suite exists to catch.
 */
export function provenanceForDecisionService(
  sourceService: string | null | undefined,
): EvidenceProvenanceClass {
  const service = (sourceService ?? '').trim();
  if (!service) return 'UNAVAILABLE';
  return CONNECTED_SOURCE_DECISION_SERVICES.has(service) ? 'CONNECTED_SOURCE' : 'PUBLIC_OBSERVED';
}

/** True when a decision's evidence may appear on a Report 1 public surface. */
export function isReport1Decision(decision: { source_service?: string | null }): boolean {
  return isReport1Provenance(provenanceForDecisionService(decision.source_service));
}

/**
 * Split decisions into what Report 1 may present and what it may not.
 *
 * Returns both halves rather than only the allowed one, on purpose: the
 * connected half is legitimate evidence for the surfaces entitled to it, and a
 * filter that simply discarded it would invite a caller to re-derive it from
 * somewhere else. Report 2 and the enterprise analytics path read that data from
 * their own sources and are untouched by this.
 */
export function partitionDecisionsForReport1<T extends { source_service?: string | null }>(
  decisions: readonly T[],
): { publicEvidence: T[]; connectedEvidence: T[] } {
  const publicEvidence: T[] = [];
  const connectedEvidence: T[] = [];
  for (const decision of decisions) {
    (isReport1Decision(decision) ? publicEvidence : connectedEvidence).push(decision);
  }
  return { publicEvidence, connectedEvidence };
}
