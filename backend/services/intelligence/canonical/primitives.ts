/**
 * Shared canonical PRIMITIVES — the ONE implementation of facet / evidence / reasoning /
 * contradiction / graph behaviour, re-exported from the production-certified Program 1 module so
 * Lead + Company + Offering reuse identical logic (no duplication, no drift).
 */

export { facet, nullFacet, facetConfidenceFromEvidence } from '../../leadUnderstanding/facets';
export {
  evidenceRef, refresh, supersede, expire, applyExpiry, activeEvidence, normalizeEvidence, countByKind,
} from '../../leadUnderstanding/evidence';
export { reasoningTrace, isGrounded, validateReasoning } from '../../leadUnderstanding/reasoning';
export { detectEvidenceContradictions, resolveContradiction } from '../../leadUnderstanding/contradiction';
export { node, edge, buildLeadGraph as buildEntityGraph, neighbours } from '../../leadUnderstanding/graph';
