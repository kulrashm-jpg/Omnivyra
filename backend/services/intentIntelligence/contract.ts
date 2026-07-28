/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase D — Canonical Intent Contract (I-D402/D404/D407).
 *
 * The FROZEN, stable contract every future inferential / intent-aware intelligence domain
 * (Qualification / Opportunity / Decision / Customer / Revenue / Automation) MUST consume — rather than
 * redefine, re-project, re-score, re-persist, or re-derive interpretation semantics. It names the
 * intent facet surface, interpretation dimensions, references-only graph publication (NO reasoning
 * edges), projection, explainability, and platform surface; declares governance rules + migration
 * prohibitions; and validates that a produced understanding conforms. It introduces NO new intelligence
 * — a contract descriptor + conformance validator only.
 */

import type { IntentUnderstanding } from './types';
import { INTENT_FACET_NAMES, INTENT_SCORE_DIMENSIONS } from './types';
import { INTENT_MODEL_VERSION } from './builder';

export const INTENT_CONTRACT_VERSION = 1;

/** Edge types the Intent Understanding publishes — references-only, from the intent root. Interpretation is NOT published (it lives in facets); NO reasoning edges. */
export const INTENT_PUBLISHED_EDGE_TYPES = ['intent_of', 'intent_toward'] as const;

/** The FROZEN canonical Intent contract. Downstream programs consume this; they never redefine it. */
export const INTENT_CANONICAL_CONTRACT = Object.freeze({
  contractVersion: INTENT_CONTRACT_VERSION,
  modelVersion: INTENT_MODEL_VERSION,
  entity: 'intent' as const,
  graphRootType: 'intent' as const,
  facets: Object.freeze([...INTENT_FACET_NAMES]),
  scoreDimensions: Object.freeze([...INTENT_SCORE_DIMENSIONS]),
  publishedEdgeTypes: Object.freeze([...INTENT_PUBLISHED_EDGE_TYPES]),
  projectionFields: Object.freeze(['key', 'version', 'identity', 'primaryObjective', 'competingObjectives', 'abstained', 'scores', 'overallScore', 'confidence', 'uncertainty', 'facetConfidence', 'topContradictions', 'projectedAt']),
  interpretationSource: 'observed_evidence' as const,                  // interpretation is descriptive over observed evidence — never a forecast
  orderingSource: 'evidence_chronology' as const,                      // chronology from EvidenceRef.observedAt
  explainability: 'shared:explainUnderstanding' as const,
  platformSurface: Object.freeze(['graph', 'reasoning', 'contradictions', 'builtAt']), // CanonicalEntityUnderstanding
  sharedPrimitives: Object.freeze(['Facet', 'EvidenceRef', 'ReasoningTrace', 'validateReasoning', 'fuseEvidence', 'detectEvidenceContradictions', 'combineScoresFor', 'explainUnderstanding']),
});

/** Governance rules future architectural reviews MUST enforce for any intent-aware module (I-D407). */
export const INTENT_GOVERNANCE_RULES = Object.freeze([
  'Intent Understanding is the sole canonical owner of interpretation semantics',
  'Journey Understanding remains the sole canonical owner of progression semantics',
  'Visitor Understanding remains the sole canonical owner of visitor semantics',
  'Interpretation is descriptive over observed evidence — never a prediction',
  'Graph publication is references-only (intent owns only its own root node); NO reasoning edges',
  'Reuse the shared EvidenceRef / Facet / ReasoningTrace / validateReasoning / fuseEvidence / detectEvidenceContradictions',
  'Reuse the shared scoring (combineScoresFor; no new scoring or inference framework)',
  'Reuse the shared explainability (explainUnderstanding; no intent-specific explainer)',
  'Competing intents are represented, never resolved; abstention is honest and deterministic',
  'Consume the frozen Intent contract via the Platform Consumption API (no downstream customization)',
]);

/** Migration prohibitions for future intent-aware modules (I-D404). */
export const INTENT_MIGRATION_PROHIBITIONS = Object.freeze([
  'duplicate intent model',
  'duplicate interpretation logic',
  'duplicate inference framework',
  'duplicate intent projection',
  'duplicate intent scoring',
  'duplicate intent persistence',
  'duplicate intent reasoning',
  'parallel intent graph / reasoning-edge model',
]);

export interface IntentContractConformance { conforms: boolean; issues: string[]; }

/** Verify a produced Intent Understanding conforms to the frozen canonical contract. */
export function validateIntentContract(u: IntentUnderstanding): IntentContractConformance {
  const issues: string[] = [];
  if (u.version !== INTENT_CANONICAL_CONTRACT.modelVersion) issues.push(`model version ${u.version} ≠ ${INTENT_CANONICAL_CONTRACT.modelVersion}`);
  for (const f of INTENT_CANONICAL_CONTRACT.facets) if (!(f in u.facets)) issues.push(`missing facet: ${f}`);
  for (const d of INTENT_CANONICAL_CONTRACT.scoreDimensions) if (!(d in u.score.dimensions)) issues.push(`missing score dimension: ${d}`);
  if (u.graph.root.type !== INTENT_CANONICAL_CONTRACT.graphRootType) issues.push(`graph root ${u.graph.root.type} ≠ intent`);
  if (!u.graph.edges.every((e) => e.from.type === 'intent')) issues.push('graph publication not references-only (an edge does not originate from intent)');
  const allowed = new Set<string>(INTENT_CANONICAL_CONTRACT.publishedEdgeTypes);
  for (const e of u.graph.edges) if (!allowed.has(e.type)) issues.push(`unpublished edge type: ${e.type} (interpretation must not leak into the graph — no reasoning edges)`);
  return { conforms: issues.length === 0, issues };
}
