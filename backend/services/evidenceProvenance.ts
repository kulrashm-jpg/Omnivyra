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
  social_links: 'PUBLIC_OBSERVED',
  wikidata: 'PUBLIC_OBSERVED',
  google_kg: 'PUBLIC_OBSERVED',
  schema_org: 'PUBLIC_OBSERVED',
  llm_probe: 'PUBLIC_OBSERVED',
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
