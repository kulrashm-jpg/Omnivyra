/**
 * knowledgeConsumption — the canonical Company Knowledge Consumption Framework
 * (CKC-001). Single import surface for every AI capability that consumes Company
 * Knowledge. Downstream modules import from here; they do not read or assemble
 * Company Knowledge directly.
 */

export {
  getKnowledgeContext,
  getKnowledgeContextForConsumer,
  invalidateKnowledgeContext,
} from './companyKnowledgeConsumer';

export type {
  KnowledgeConsumerId,
  KnowledgeContext,
  KnowledgeContextDomain,
  KnowledgeContextMetadata,
  KnowledgeContextMode,
  KnowledgeContextRequest,
  KnowledgeVersionSelector,
} from './knowledgeContextContracts';
export { estimateTokens } from './knowledgeContextContracts';

export { CONSUMER_PROFILES, KNOWN_CONSUMERS, resolveConsumerProfile } from './knowledgeConsumerProfiles';
export type { ConsumerProfile } from './knowledgeConsumerProfiles';

export { assembleKnowledgeContext } from './knowledgeContextAssembler';
export { resolveKnowledgeForSelector, selectorKey } from './knowledgeVersionSelector';
export { getCachedContext, setCachedContext, invalidateContextCache, contextCacheKey, clearContextMemoryCache } from './knowledgeContextCache';
export {
  emitConsumerEvent, metricForConsumerEvent, recordContextTelemetry,
  CONSUMPTION_EVENT_CAPABILITY_PREFIX,
} from './knowledgeConsumerEvents';
export type { ConsumerEventName } from './knowledgeConsumerEvents';
