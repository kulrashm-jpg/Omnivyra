/**
 * longFormIntelligence — the Long-form Intelligence platform (PMF-002).
 *
 * The Long-form Engine's unique DETERMINISTIC intelligence, extracted (by
 * delegation — never reimplemented) into one registry + reusable frameworks +
 * AIC integration. The engine keeps calling its own functions; the platform now
 * exposes the SAME functions as registered, reusable, AIC-pluggable services.
 * Zero behavior change, zero inference migration.
 */

export {
  LONG_FORM_INTELLIGENCE, LONG_FORM_INTELLIGENCE_IDS,
  resolveIntelligence, intelligenceByKind, extractedComponents,
  invokeValidateLongFormQuality, invokeSanitizeContentPlan, invokeSanitizeStoryContentPlan,
} from './intelligenceRegistry';
export type { IntelligenceKind, IntelligenceComponentId, IntelligenceComponent } from './intelligenceRegistry';

export * as planningFramework from './planningFramework';
export * as qualityFramework from './qualityFramework';
export * as validationFramework from './validationFramework';
export * as repairFramework from './repairFramework';
export * as postProcessingFramework from './postProcessingFramework';

export {
  LONG_FORM_INTELLIGENCE_SERVICES, LONG_FORM_AIC_VALIDATORS,
  longFormValidationRuleFor, duplicationCapabilityRule,
} from './longFormAicIntegration';
export type { LongFormRuleAdapter } from './longFormAicIntegration';
