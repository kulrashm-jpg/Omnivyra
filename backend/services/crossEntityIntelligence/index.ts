/**
 * Cross-Entity Intelligence (PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase C).
 *
 * A deterministic reasoning layer that reasons ACROSS the canonical Understanding entities
 * (Lead/Company/Offering) by CONSUMING the Phase-B Canonical Intelligence Graph + their canonical
 * evidence — REUSING the shared evidence/reasoning/fusion/explain contracts (no new primitive). It
 * produces only DERIVED evidence + DERIVED reasoning + relationship intelligence + context
 * projections, and OWNS NO entity semantics: the graph stays infrastructure-only, each entity stays
 * authoritative, nothing is re-scored, re-projected, persisted, or mutated. Flag-dark, shadow-only.
 */
export * from './types';
export { resolveNeighborhood } from './multiHopResolver';
export { assembleCrossEntityContext, evidenceOf, type ContextOptions } from './contextAssembler';
export { fuseCrossEntityEvidence } from './evidenceFusion';
export { reasonAcrossEntities } from './reasoningEngine';
export { assessRelationships } from './relationshipIntelligence';
export { projectContext } from './contextProjection';
export { explainInsight, explainAll } from './explainability';
export { computeCrossEntityIntelligence, computeCrossEntitySnapshot } from './runtime';
export { isCrossEntityIntelligenceEnabled } from './flags';
