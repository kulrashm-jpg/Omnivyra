/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase D — Canonical Journey Contract (J-D402/D404/D407).
 *
 * The FROZEN, stable contract every future journey-aware / temporal intelligence domain (Intent /
 * Qualification / Opportunity / Decision / Customer / Revenue / Automation) MUST consume — rather than
 * redefine, re-project, re-score, or re-persist progression semantics. It names the journey facet
 * surface, progression dimensions, references-only graph publication, projection, explainability, and
 * platform surface; declares governance rules + migration prohibitions; and validates that a produced
 * understanding conforms. It introduces NO new intelligence — a contract descriptor + conformance
 * validator only.
 */

import type { JourneyUnderstanding } from './types';
import { JOURNEY_FACET_NAMES, JOURNEY_SCORE_DIMENSIONS } from './types';
import { JOURNEY_MODEL_VERSION } from './builder';

export const JOURNEY_CONTRACT_VERSION = 1;

/** Edge types the Journey Understanding publishes — references-only, from the journey root. Ordering is NOT published (it lives in facets). */
export const JOURNEY_PUBLISHED_EDGE_TYPES = ['journey_of', 'belongs_to', 'has_touchpoint', 'reached_stage', 'achieved_milestone', 'engaged_with'] as const;

/** The FROZEN canonical Journey contract. Downstream programs consume this; they never redefine it. */
export const JOURNEY_CANONICAL_CONTRACT = Object.freeze({
  contractVersion: JOURNEY_CONTRACT_VERSION,
  modelVersion: JOURNEY_MODEL_VERSION,
  entity: 'journey' as const,
  graphRootType: 'journey' as const,
  facets: Object.freeze([...JOURNEY_FACET_NAMES]),
  scoreDimensions: Object.freeze([...JOURNEY_SCORE_DIMENSIONS]),
  publishedEdgeTypes: Object.freeze([...JOURNEY_PUBLISHED_EDGE_TYPES]),
  projectionFields: Object.freeze(['key', 'version', 'identity', 'status', 'currentStage', 'touchpointCount', 'scores', 'overallScore', 'confidence', 'facetConfidence', 'topContradictions', 'projectedAt']),
  orderingSource: 'evidence_chronology' as const,                      // ordering derives from EvidenceRef.observedAt, never the graph
  explainability: 'shared:explainUnderstanding' as const,
  platformSurface: Object.freeze(['graph', 'reasoning', 'contradictions', 'builtAt']), // CanonicalEntityUnderstanding
  sharedPrimitives: Object.freeze(['Facet', 'EvidenceRef', 'ReasoningTrace', 'combineScoresFor', 'explainUnderstanding']),
});

/** Governance rules future architectural reviews MUST enforce for any journey-aware module (J-D407). */
export const JOURNEY_GOVERNANCE_RULES = Object.freeze([
  'Journey Understanding is the sole canonical owner of progression semantics',
  'Visitor Understanding remains the sole canonical owner of visitor semantics',
  'Ordering derives from evidence chronology (observedAt) — never from the graph',
  'Graph publication is references-only (journey owns only its own root node)',
  'Reuse the shared EvidenceRef (no new evidence primitive)',
  'Reuse the shared Facet (no new facet primitive)',
  'Reuse the shared ReasoningTrace (no new reasoning primitive)',
  'Reuse the shared scoring (combineScoresFor; no new scoring system)',
  'Reuse the shared explainability (explainUnderstanding; no journey-specific explainer)',
  'Consume the frozen Journey contract via the Platform Consumption API (no downstream customization)',
]);

/** Migration prohibitions for future journey-aware modules (J-D404). */
export const JOURNEY_MIGRATION_PROHIBITIONS = Object.freeze([
  'duplicate journey model',
  'duplicate progression logic',
  'duplicate journey projection',
  'duplicate journey scoring',
  'duplicate journey persistence',
  'duplicate journey reasoning',
  'parallel journey graph / ordering model',
]);

export interface JourneyContractConformance { conforms: boolean; issues: string[]; }

/** Verify a produced Journey Understanding conforms to the frozen canonical contract. */
export function validateJourneyContract(u: JourneyUnderstanding): JourneyContractConformance {
  const issues: string[] = [];
  if (u.version !== JOURNEY_CANONICAL_CONTRACT.modelVersion) issues.push(`model version ${u.version} ≠ ${JOURNEY_CANONICAL_CONTRACT.modelVersion}`);
  for (const f of JOURNEY_CANONICAL_CONTRACT.facets) if (!(f in u.facets)) issues.push(`missing facet: ${f}`);
  for (const d of JOURNEY_CANONICAL_CONTRACT.scoreDimensions) if (!(d in u.score.dimensions)) issues.push(`missing score dimension: ${d}`);
  if (u.graph.root.type !== JOURNEY_CANONICAL_CONTRACT.graphRootType) issues.push(`graph root ${u.graph.root.type} ≠ journey`);
  if (!u.graph.edges.every((e) => e.from.type === 'journey')) issues.push('graph publication not references-only (an edge does not originate from journey)');
  const allowed = new Set<string>(JOURNEY_CANONICAL_CONTRACT.publishedEdgeTypes);
  for (const e of u.graph.edges) if (!allowed.has(e.type)) issues.push(`unpublished edge type: ${e.type}`);
  // ordering must NOT be published to the graph — order lives in facets
  if (u.graph.edges.some((e) => e.type === 'transitioned_to')) issues.push('ordering leaked into graph (transitioned_to published)');
  return { conforms: issues.length === 0, issues };
}
