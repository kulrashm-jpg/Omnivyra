/**
 * intelligenceRegistry.ts — the canonical Long-form Intelligence Registry (PMF-002 §2).
 *
 * ONE central catalogue of the Long-form Engine's unique intelligence. Each entry
 * DELEGATES to the engine's EXISTING implementation (imported, never reimplemented),
 * so behavior is byte-identical and no inference is migrated. This transforms the
 * engine's private, deterministic intelligence into platform-owned, reusable,
 * AIC-pluggable services WITHOUT changing the engine — the engine keeps calling its
 * own functions; the platform now exposes the same functions as registered services.
 *
 * Inference boundaries (outline planning, section generation, repair regeneration)
 * are catalogued with `extracted: false` — they are documented, not extracted.
 *
 * Modules with zero inference coupling are imported statically; the two functions
 * that live inside inference-bearing modules are loaded lazily so importing this
 * registry never pulls the LLM gateway into a consumer.
 */

// ── Inference-free intelligence (safe static delegation) ──
import { validatePlannerStability } from '../longForm/plannerStabilityValidator';
import { validateContentDuplication } from '../longForm/contentDuplicationValidator';
import { evaluateThoughtLeadershipQuality } from '../longForm/thoughtLeadershipQualityGate';
import { computeAdaptiveRecoveryBudget } from '../longForm/adaptiveRecoveryBudget';
import { scoreDifferentiation } from '../../../lib/content/longFormDifferentiationIntelligence';
import { scoreLongFormContent, scoreNeedsRepair } from '../../../lib/content/longFormSeoIntelligence';
import { evaluateLongFormContent } from '../../../lib/content/longFormContentEvaluator';

// ── Type-only handles for the two lazily-loaded (inference-bearing module) fns ──
type ValidateLongFormQualityFn = typeof import('../../../lib/content/longFormPlanningEnginePlanning').validateLongFormQuality;
type SanitizeContentPlanFn = typeof import('../../../lib/content/longFormPlanningEngineModel').sanitizeContentPlan;
type SanitizeStoryContentPlanFn = typeof import('../../../lib/content/longFormPlanningEngineModel').sanitizeStoryContentPlan;

export type IntelligenceKind = 'planner' | 'validator' | 'scorer' | 'detector' | 'repair' | 'post_processing';

export type IntelligenceComponentId =
  | 'OUTLINE_PLANNER'
  | 'OUTLINE_VALIDATOR'
  | 'SECTION_VALIDATOR'
  | 'QUALITY_SCORER'
  | 'QUALITY_VALIDATOR'
  | 'DIFFERENTIATION_SCORER'
  | 'AUTHORITY_VALIDATOR'
  | 'DUPLICATION_DETECTOR'
  | 'THOUGHT_LEADERSHIP_VALIDATOR'
  | 'SECTION_REPAIR'
  | 'REGENERATION_STRATEGY'
  | 'POST_PROCESSING'
  | 'POST_PROCESSING_STORY';

export interface IntelligenceComponent {
  id: IntelligenceComponentId;
  kind: IntelligenceKind;
  description: string;
  /** True when the component is deterministic (pure) and fully extracted. */
  deterministic: boolean;
  /** True when the platform owns a reusable delegate; false = inference boundary. */
  extracted: boolean;
  /** The engine module the delegate lives in (provenance / audit). */
  sourceModule: string;
  /** Delegating invoker — calls the engine's own function. undefined for boundaries. */
  invoke?: (...args: any[]) => Promise<unknown>;
}

/** Async delegate to the lazily-loaded functions (keeps the registry inference-free). */
export async function invokeValidateLongFormQuality(...args: Parameters<ValidateLongFormQualityFn>): Promise<ReturnType<ValidateLongFormQualityFn>> {
  const m = await import('../../../lib/content/longFormPlanningEnginePlanning');
  return m.validateLongFormQuality(...args);
}
export async function invokeSanitizeContentPlan(...args: Parameters<SanitizeContentPlanFn>): Promise<ReturnType<SanitizeContentPlanFn>> {
  const m = await import('../../../lib/content/longFormPlanningEngineModel');
  return m.sanitizeContentPlan(...args);
}
export async function invokeSanitizeStoryContentPlan(...args: Parameters<SanitizeStoryContentPlanFn>): Promise<ReturnType<SanitizeStoryContentPlanFn>> {
  const m = await import('../../../lib/content/longFormPlanningEngineModel');
  return m.sanitizeStoryContentPlan(...args);
}

// Uniform async delegate for a statically-imported sync function.
const wrap = <A extends any[], R>(fn: (...a: A) => R) => async (...a: A): Promise<R> => fn(...a);

const REGISTRY_INTERNAL: Record<IntelligenceComponentId, IntelligenceComponent> = {
  OUTLINE_PLANNER: {
    id: 'OUTLINE_PLANNER', kind: 'planner', deterministic: false, extracted: false,
    description: 'Outline/plan generation — LLM inference. Boundary: not extracted (PMF rule: zero inference migration).',
    sourceModule: 'lib/content/longFormPlanningEnginePlanning#generateContentPlan',
  },
  OUTLINE_VALIDATOR: {
    id: 'OUTLINE_VALIDATOR', kind: 'validator', deterministic: true, extracted: true,
    description: 'Planner-stability / outline validation (section count, sizing, sequencing, duplicate titles).',
    sourceModule: 'backend/services/longForm/plannerStabilityValidator#validatePlannerStability',
    invoke: wrap(validatePlannerStability),
  },
  SECTION_VALIDATOR: {
    id: 'SECTION_VALIDATOR', kind: 'validator', deterministic: true, extracted: true,
    description: 'Deterministic section repair-trigger (score thresholds → needs-repair).',
    sourceModule: 'lib/content/longFormSeoIntelligence#scoreNeedsRepair',
    invoke: wrap(scoreNeedsRepair),
  },
  QUALITY_SCORER: {
    id: 'QUALITY_SCORER', kind: 'scorer', deterministic: true, extracted: true,
    description: 'Long-form content scoring (SEO/AEO/GEO/differentiation/readability) + improvement hooks.',
    sourceModule: 'lib/content/longFormSeoIntelligence#scoreLongFormContent',
    invoke: wrap(scoreLongFormContent),
  },
  QUALITY_VALIDATOR: {
    id: 'QUALITY_VALIDATOR', kind: 'validator', deterministic: true, extracted: true,
    description: 'Long-form quality report (variation, framework presence, FAQ, insight density, evidence).',
    sourceModule: 'lib/content/longFormPlanningEnginePlanning#validateLongFormQuality',
    invoke: invokeValidateLongFormQuality,
  },
  DIFFERENTIATION_SCORER: {
    id: 'DIFFERENTIATION_SCORER', kind: 'scorer', deterministic: true, extracted: true,
    description: 'Differentiation scoring vs competitor profile (positioning, gaps, avoided patterns, hook strength).',
    sourceModule: 'lib/content/longFormDifferentiationIntelligence#scoreDifferentiation',
    invoke: wrap(scoreDifferentiation),
  },
  AUTHORITY_VALIDATOR: {
    id: 'AUTHORITY_VALIDATOR', kind: 'validator', deterministic: true, extracted: true,
    description: 'Post-generation authority/quality evaluation (SEO/AEO/GEO/differentiation/human quality + weaknesses).',
    sourceModule: 'lib/content/longFormContentEvaluator#evaluateLongFormContent',
    invoke: wrap(evaluateLongFormContent),
  },
  DUPLICATION_DETECTOR: {
    id: 'DUPLICATION_DETECTOR', kind: 'detector', deterministic: true, extracted: true,
    description: 'Cross-section / cross-paragraph duplication detection (Jaccard + concept-frame overlap).',
    sourceModule: 'backend/services/longForm/contentDuplicationValidator#validateContentDuplication',
    invoke: wrap(validateContentDuplication),
  },
  THOUGHT_LEADERSHIP_VALIDATOR: {
    id: 'THOUGHT_LEADERSHIP_VALIDATOR', kind: 'validator', deterministic: true, extracted: true,
    description: 'Thought-leadership quality gate (framework presence, strategic value, editorial structure, final outcome).',
    sourceModule: 'backend/services/longForm/thoughtLeadershipQualityGate#evaluateThoughtLeadershipQuality',
    invoke: wrap(evaluateThoughtLeadershipQuality),
  },
  SECTION_REPAIR: {
    id: 'SECTION_REPAIR', kind: 'repair', deterministic: false, extracted: false,
    description: 'Section repair loop — regenerates failing sections via LLM inference. Boundary: not extracted.',
    sourceModule: 'lib/content/longFormPlanningEngineRuntime#repair*Sections',
  },
  REGENERATION_STRATEGY: {
    id: 'REGENERATION_STRATEGY', kind: 'repair', deterministic: true, extracted: true,
    description: 'Deterministic adaptive recovery budget (max repairs/retries, escalation, early-stop) for regeneration.',
    sourceModule: 'backend/services/longForm/adaptiveRecoveryBudget#computeAdaptiveRecoveryBudget',
    invoke: wrap(computeAdaptiveRecoveryBudget),
  },
  POST_PROCESSING: {
    id: 'POST_PROCESSING', kind: 'post_processing', deterministic: true, extracted: true,
    description: 'Plan sanitization/normalization (title/excerpt/section scaffolding cleanup, content-type alignment).',
    sourceModule: 'lib/content/longFormPlanningEngineModel#sanitizeContentPlan',
    invoke: invokeSanitizeContentPlan,
  },
  POST_PROCESSING_STORY: {
    id: 'POST_PROCESSING_STORY', kind: 'post_processing', deterministic: true, extracted: true,
    description: 'Story-format plan sanitization/normalization.',
    sourceModule: 'lib/content/longFormPlanningEngineModel#sanitizeStoryContentPlan',
    invoke: invokeSanitizeStoryContentPlan,
  },
};

export const LONG_FORM_INTELLIGENCE: Readonly<Record<IntelligenceComponentId, IntelligenceComponent>> = REGISTRY_INTERNAL;
export const LONG_FORM_INTELLIGENCE_IDS = Object.keys(REGISTRY_INTERNAL) as IntelligenceComponentId[];

/** Resolve a component, or null. */
export function resolveIntelligence(id: IntelligenceComponentId): IntelligenceComponent | null {
  return REGISTRY_INTERNAL[id] ?? null;
}

/** All components of a given kind (deterministic order). */
export function intelligenceByKind(kind: IntelligenceKind): IntelligenceComponent[] {
  return LONG_FORM_INTELLIGENCE_IDS.map((id) => REGISTRY_INTERNAL[id]).filter((c) => c.kind === kind);
}

/** Extracted, reusable components (excludes inference boundaries). */
export function extractedComponents(): IntelligenceComponent[] {
  return LONG_FORM_INTELLIGENCE_IDS.map((id) => REGISTRY_INTERNAL[id]).filter((c) => c.extracted);
}
