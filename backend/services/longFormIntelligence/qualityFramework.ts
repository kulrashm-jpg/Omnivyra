/**
 * qualityFramework.ts — reusable quality intelligence (PMF-002 §4).
 *
 * Delegates to the engine's existing quality intelligence: content scoring
 * (SEO/AEO/GEO/differentiation/readability), differentiation, authority/quality
 * evaluation, thought-leadership gate, and the quality report. No AI redesign — the
 * exact engine functions are re-surfaced as platform services.
 */

export { scoreLongFormContent } from '../../../lib/content/longFormSeoIntelligence';
export { scoreDifferentiation } from '../../../lib/content/longFormDifferentiationIntelligence';
export { evaluateLongFormContent } from '../../../lib/content/longFormContentEvaluator';
export { evaluateThoughtLeadershipQuality } from '../longForm/thoughtLeadershipQualityGate';

// Quality report (variation / framework / FAQ / insight density / evidence) — lazy.
export { invokeValidateLongFormQuality as validateLongFormQuality } from './intelligenceRegistry';
