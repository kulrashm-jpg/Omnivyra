/**
 * WAVE-1 — AI Integrity & Safety layer (public barrel).
 *
 * Reusable primitives realizing the frozen AI-CONTRACT-000 contracts (§C1 safe-parse,
 * §C6 pre/post-gen safety, §E1 error model, §P6 market provenance). Additive; no
 * architecture/contract change. Adopted at canonical seams by Wave-1 and later waves.
 */
export { AiError, isAiError, type AiErrorCode, type AiErrorCategory, type AiErrorSeverity, type AiErrorShape } from './aiError';
export { parseStructured, parseStructuredOr, extractJsonText, type ParseResult } from './safeParse';
export {
  detectInjection, escapeUntrusted, delimitUntrusted, screenUntrustedFields,
  INSTRUCTION_HIERARCHY_PREAMBLE,
  type UntrustedSource, type InjectionFinding, type ScreenResult,
} from './promptSafety';
export { moderateOutput, type OutboundModerationRequest, type ModerationVerdict, type ModerationEnforcement } from './outboundModeration';
export {
  hardenText, hardenTextList, hardenBlock, hardenFieldsWithTrace,
  recordPromptSafetyDecision, newReasoningId, type PromptSafetyDecision,
} from './promptSafetyAdoption';
export {
  moderateBeforePersist, resolveModerationMode, type ModerateBeforePersistCtx,
} from './outboundModerationAdoption';
export {
  parseModelOutput, parseModelOutputOr, PARSER_VERSION, type ParseCtx,
} from './structuredOutputAdoption';
export {
  classifyProviderError, computeBackoffMs, normalizeProviderError,
  type ProviderErrorClass, type ProviderErrorClassification, type BackoffOptions,
} from './providerRetryPolicy';
export {
  classifyProvenance, applyProvenance, mayTrustScore,
  type ProvenanceTier, type ProvenanceVerdict, type EvidenceInput, type SignalLike,
} from './marketProvenance';
