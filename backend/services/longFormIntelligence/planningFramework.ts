/**
 * planningFramework.ts — reusable planning intelligence (PMF-002 §3).
 *
 * Delegates to the engine's existing planning intelligence. Outline GENERATION is
 * LLM inference and stays in the engine (not extracted); what is extracted here is
 * the deterministic planning intelligence around it: outline validation (planner
 * stability — which also yields planning confidence + metadata) and plan
 * normalization. No planning quality is changed.
 */

// Outline validation → the result's `recommendation` + `reasoning` ARE the planning
// confidence signal and planning metadata.
export { validatePlannerStability } from '../longForm/plannerStabilityValidator';

// Plan normalization / post-processing (lazily loaded — its module carries inference).
export {
  invokeSanitizeContentPlan as sanitizeContentPlan,
  invokeSanitizeStoryContentPlan as sanitizeStoryContentPlan,
} from './intelligenceRegistry';
