/**
 * longFormAicIntegration.ts — AIC integration for long-form intelligence (PMF-002 §8).
 *
 * Makes the extracted deterministic intelligence available to AIC-001 as OPTIONAL,
 * reusable services — without touching the AIC core and without touching the
 * Long-form Engine. It provides:
 *   • LONG_FORM_INTELLIGENCE_SERVICES — the extracted, reusable components any AIC
 *     capability can call directly.
 *   • longFormValidationRuleFor(...) — adapts a deterministic validator/detector to
 *     an AIC CapabilityRule so a capability can plug it into the AIC validation
 *     framework (via deps.rules) with no bespoke validator of its own.
 *
 * Rules are SYNCHRONOUS and FAIL-OPEN (a thrown/adapter-mismatch never breaks a
 * capability) — they can only ADD a validation signal, never change engine behavior.
 */

import type { CapabilityRule, ValidationContext } from '../aiCapability/capabilityValidation';
import { validateContentDuplication } from '../longForm/contentDuplicationValidator';
import { validatePlannerStability } from '../longForm/plannerStabilityValidator';
import { evaluateThoughtLeadershipQuality } from '../longForm/thoughtLeadershipQualityGate';
import { scoreNeedsRepair } from '../../../lib/content/longFormSeoIntelligence';
import { evaluateLongFormContent } from '../../../lib/content/longFormContentEvaluator';
import {
  extractedComponents, type IntelligenceComponent, type IntelligenceComponentId,
} from './intelligenceRegistry';

/** The reusable, extracted intelligence components exposed to AIC. */
export const LONG_FORM_INTELLIGENCE_SERVICES: IntelligenceComponent[] = extractedComponents();

/** The subset usable as synchronous AIC validation rules (deterministic + sync). */
export const LONG_FORM_AIC_VALIDATORS: ReadonlyArray<IntelligenceComponentId> = [
  'OUTLINE_VALIDATOR', 'SECTION_VALIDATOR', 'DUPLICATION_DETECTOR', 'AUTHORITY_VALIDATOR', 'THOUGHT_LEADERSHIP_VALIDATOR',
];

const SYNC_DELEGATE: Partial<Record<IntelligenceComponentId, (input: any) => any>> = {
  OUTLINE_VALIDATOR: validatePlannerStability,
  SECTION_VALIDATOR: scoreNeedsRepair,
  DUPLICATION_DETECTOR: validateContentDuplication,
  AUTHORITY_VALIDATOR: evaluateLongFormContent,
  THOUGHT_LEADERSHIP_VALIDATOR: evaluateThoughtLeadershipQuality,
};

export interface LongFormRuleAdapter<I> {
  /** Build the component's input from the AIC capability result (null → skip). */
  extract: (result: unknown, ctx: ValidationContext) => I | null;
  /** Map the component's output to a failure message, or null when satisfied. */
  verdict: (output: any) => string | null;
}

/**
 * Adapt a deterministic long-form validator/detector into an AIC CapabilityRule.
 * Fail-open: adapter mismatch or a thrown delegate yields `null` (no failure), so a
 * capability that plugs this in can only gain a signal, never be broken by it.
 */
export function longFormValidationRuleFor<I>(componentId: IntelligenceComponentId, adapter: LongFormRuleAdapter<I>): CapabilityRule {
  const delegate = SYNC_DELEGATE[componentId];
  return (result, ctx) => {
    if (!delegate) return null;
    let input: I | null;
    try { input = adapter.extract(result, ctx); } catch { return null; }
    if (input == null) return null;
    try { return adapter.verdict(delegate(input)); } catch { return null; }
  };
}

/**
 * Convenience: a ready-made duplication rule for capabilities whose result carries
 * `content_html`. Flags repeated sections via the DUPLICATION_DETECTOR.
 */
export const duplicationCapabilityRule: CapabilityRule = longFormValidationRuleFor<string>('DUPLICATION_DETECTOR', {
  extract: (result) => {
    const html = (result as { content_html?: unknown })?.content_html;
    return typeof html === 'string' && html.length > 0 ? html : null;
  },
  verdict: (out) => (out?.repeatedSectionPairs?.length > 0 ? `duplicate_sections:${out.repeatedSectionPairs.length}` : null),
});
