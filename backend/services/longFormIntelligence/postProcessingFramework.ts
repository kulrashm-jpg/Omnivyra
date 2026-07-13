/**
 * postProcessingFramework.ts — reusable post-processing intelligence (PMF-002 §7).
 *
 * Delegates to the engine's existing plan sanitization/normalization (title,
 * excerpt, section scaffolding cleanup, content-type alignment) and to the quality
 * evaluation used for quality metadata. Lazily loaded (their module carries
 * inference) so importing this framework never pulls the LLM gateway in.
 */

export {
  invokeSanitizeContentPlan as sanitizeContentPlan,       // cleanup / normalization / format alignment
  invokeSanitizeStoryContentPlan as sanitizeStoryContentPlan,
} from './intelligenceRegistry';

// Quality metadata generation (deterministic evaluation of the finished content).
export { evaluateLongFormContent as generateQualityMetadata } from '../../../lib/content/longFormContentEvaluator';
