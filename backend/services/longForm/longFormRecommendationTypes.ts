/**
 * Long-form recommendation types — BARREL. Single source of truth for engine,
 * validator, API, and frontend cards (133 importers keep this exact path).
 * Content split into three <1000-LOC modules:
 *   …TypesCore      — alignment modes, scoring dimensions, recommendation card
 *   …TypesEvidence  — claims, verification, grounding, sequencing
 *   …TypesLearning  — archetypes, cross-modal formats, traces, limits
 */
export * from './longFormRecommendationTypesCore';
export * from './longFormRecommendationTypesEvidence';
export * from './longFormRecommendationTypesLearning';
