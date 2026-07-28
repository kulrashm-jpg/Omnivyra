/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase D — Canonical Visitor Contract (V-D402/D404/D407).
 *
 * The FROZEN, stable contract every future visitor-aware intelligence domain (Journey / Intent /
 * Qualification / Opportunity / Decision / Customer / Revenue / Automation) MUST consume — rather than
 * redefine, re-project, re-score, or re-persist visitor semantics. It names the visitor facet surface,
 * score dimensions, graph publication, projection, explainability, and platform surface; it declares
 * the governance rules + migration prohibitions; and it validates that a produced understanding
 * conforms. It introduces NO new intelligence — it is a contract descriptor + conformance validator.
 */

import type { VisitorUnderstanding } from './types';
import { VISITOR_FACET_NAMES, VISITOR_SCORE_DIMENSIONS } from './types';
import { VISITOR_MODEL_VERSION } from './builder';

export const VISITOR_CONTRACT_VERSION = 1;

/** Edge types the Visitor Understanding publishes — references-only, into other entities. */
export const VISITOR_PUBLISHED_EDGE_TYPES = ['identified_as', 'belongs_to', 'acquired_via', 'engaged_with'] as const;

/** The FROZEN canonical Visitor contract. Downstream programs consume this; they never redefine it. */
export const VISITOR_CANONICAL_CONTRACT = Object.freeze({
  contractVersion: VISITOR_CONTRACT_VERSION,
  modelVersion: VISITOR_MODEL_VERSION,
  entity: 'visitor' as const,
  graphRootType: 'visitor' as const,
  facets: Object.freeze([...VISITOR_FACET_NAMES]),
  scoreDimensions: Object.freeze([...VISITOR_SCORE_DIMENSIONS]),
  publishedEdgeTypes: Object.freeze([...VISITOR_PUBLISHED_EDGE_TYPES]),
  projectionFields: Object.freeze(['key', 'version', 'identity', 'status', 'lifecycle', 'scores', 'overallScore', 'confidence', 'facetConfidence', 'topContradictions', 'projectedAt']),
  explainability: 'shared:explainUnderstanding' as const,               // no visitor-specific explainability primitive
  platformSurface: Object.freeze(['graph', 'reasoning', 'contradictions', 'builtAt']), // CanonicalEntityUnderstanding
  sharedPrimitives: Object.freeze(['Facet', 'EvidenceRef', 'ReasoningTrace', 'combineScoresFor', 'explainUnderstanding']),
});

/** Governance rules future architectural reviews MUST enforce for any visitor-aware module (V-D407). */
export const VISITOR_GOVERNANCE_RULES = Object.freeze([
  'Visitor Understanding is the sole canonical owner of visitor semantics',
  'Graph publication is references-only (visitor owns only its own root node)',
  'Reuse the shared EvidenceRef (no new evidence primitive)',
  'Reuse the shared Facet (no new facet primitive)',
  'Reuse the shared ReasoningTrace (no new reasoning primitive)',
  'Reuse the shared scoring (combineScoresFor; no new scoring system)',
  'Reuse the shared explainability (explainUnderstanding; no visitor-specific explainer)',
  'Consume the frozen Visitor contract via the Platform Consumption API (no downstream customization)',
]);

/** Migration prohibitions for future visitor-aware modules (V-D404). */
export const VISITOR_MIGRATION_PROHIBITIONS = Object.freeze([
  'duplicate visitor model',
  'duplicate visitor projection',
  'duplicate visitor scoring',
  'duplicate visitor persistence',
  'duplicate visitor reasoning',
  'parallel visitor graph / relationship model',
]);

export interface VisitorContractConformance { conforms: boolean; issues: string[]; }

/** Verify a produced Visitor Understanding conforms to the frozen canonical contract. */
export function validateVisitorContract(u: VisitorUnderstanding): VisitorContractConformance {
  const issues: string[] = [];
  if (u.version !== VISITOR_CANONICAL_CONTRACT.modelVersion) issues.push(`model version ${u.version} ≠ ${VISITOR_CANONICAL_CONTRACT.modelVersion}`);
  for (const f of VISITOR_CANONICAL_CONTRACT.facets) if (!(f in u.facets)) issues.push(`missing facet: ${f}`);
  for (const d of VISITOR_CANONICAL_CONTRACT.scoreDimensions) if (!(d in u.score.dimensions)) issues.push(`missing score dimension: ${d}`);
  if (u.graph.root.type !== VISITOR_CANONICAL_CONTRACT.graphRootType) issues.push(`graph root ${u.graph.root.type} ≠ visitor`);
  if (!u.graph.edges.every((e) => e.from.type === 'visitor')) issues.push('graph publication not references-only (an edge does not originate from visitor)');
  const allowed = new Set<string>(VISITOR_CANONICAL_CONTRACT.publishedEdgeTypes);
  for (const e of u.graph.edges) if (!allowed.has(e.type)) issues.push(`unpublished edge type: ${e.type}`);
  return { conforms: issues.length === 0, issues };
}
