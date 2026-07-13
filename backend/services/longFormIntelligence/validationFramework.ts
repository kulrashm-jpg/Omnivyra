/**
 * validationFramework.ts — reusable deterministic validators (PMF-002 §5).
 *
 * Delegates to the engine's existing deterministic validators: outline validation,
 * section repair-trigger, duplication detection, authority/quality evaluation, and
 * the quality report. These plug into AIC via longFormAicIntegration (§8). No logic
 * is reimplemented.
 */

export { validatePlannerStability } from '../longForm/plannerStabilityValidator';   // outline validation
export { scoreNeedsRepair } from '../../../lib/content/longFormSeoIntelligence';      // section validation (repair trigger)
export { validateContentDuplication } from '../longForm/contentDuplicationValidator'; // duplication validation
export { evaluateLongFormContent } from '../../../lib/content/longFormContentEvaluator'; // authority validation
export { evaluateThoughtLeadershipQuality } from '../longForm/thoughtLeadershipQualityGate';
export { invokeValidateLongFormQuality as validateLongFormQuality } from './intelligenceRegistry'; // quality validation

// AIC-pluggable rule adapters (§5 "plug into AIC").
export { longFormValidationRuleFor, LONG_FORM_AIC_VALIDATORS } from './longFormAicIntegration';
