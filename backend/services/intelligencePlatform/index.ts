/**
 * Intelligence Platform Consumption API (PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase D).
 *
 * The stable ADOPTION SEAM that turns the Canonical Intelligence Graph (Phase B) + Cross-Entity
 * Intelligence (Phase C) into permanent platform infrastructure for every future intelligence domain.
 * Downstream programs consume THIS surface — canonical context / graph traversal / evidence / reasoning
 * / explainability — instead of building parallel relationship or reasoning models. It adds NO new
 * graph/relationship/reasoning primitive, moves NO ownership, redesigns NO canonical Understanding, and
 * mutates NO graph. Flag-dark, shadow-only, additive — Programs 1–4 unchanged.
 */
export * from './types';
export { toCanonicalContext } from './contextContracts';
export { openIntelligencePlatform, openIntelligencePlatformSnapshot } from './consumptionApi';
export { isIntelligencePlatformEnabled } from './flags';
