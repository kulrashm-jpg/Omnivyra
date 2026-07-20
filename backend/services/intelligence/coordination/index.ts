/**
 * Coordination Intelligence Layer — public barrel (OMNIVYRA-PMO-001 Zone A2).
 *
 * The shared coordination seam for all specialized intelligences. Reusable,
 * additive, module-agnostic. Consumers import ONLY from here.
 *
 *   import { communicationRegistry } from '@/backend/services/intelligence/coordination';
 *   const verdict = await communicationRegistry.checkDuplicateIntent({ companyId, communicationIntent: 'promote', topic });
 */

// Contracts (types + interfaces)
export * from './coordinationContracts';

// Semantic continuity contracts (OMNI-COORD-002): SemanticRoot, graph, continuity, drift
export * from './semanticContinuityContracts';

// Semantic Root registry (canonical origin store)
export {
  semanticRootRegistry,
  createSemanticRootRegistry,
  createInMemorySemanticRootRegistry,
  type SemanticRootRegistryDeps,
} from './semanticRootRegistry';

// Communication graph projector (pure, metadata only)
export { buildCommunicationGraph, nodeKindForArtifact } from './communicationGraph';

// Semantic Coordination Platform facade (binds everything; inert evaluators)
export {
  semanticCoordinationPlatform,
  createSemanticCoordinationPlatform,
  type SemanticCoordinationPlatform,
  type SemanticCoordinationPlatformDeps,
} from './semanticCoordinationPlatform';

// Semantic Root stores (port implementations)
export { InMemorySemanticRootStore } from './stores/inMemorySemanticRootStore';
export { SupabaseSemanticRootStore } from './stores/supabaseSemanticRootStore';

// Registry (canonical service + factories + default singleton)
export {
  communicationRegistry,
  createCommunicationRegistry,
  createInMemoryCommunicationRegistry,
  type CommunicationRegistryDeps,
} from './communicationRegistry';

// Duplicate-intent detector (pure evaluation + thresholds)
export {
  evaluateDuplicateIntent,
  DUPLICATE_INTENT_THRESHOLD,
  RELATED_INTENT_THRESHOLD,
  type DuplicateIntentCandidate,
} from './duplicateIntentDetector';

// Comparators (embedding-seam + inert)
export { embeddingSeamComparator, inertComparator } from './semanticIntentComparator';

// Stores (port implementations)
export { InMemoryCoordinationStore } from './stores/inMemoryCoordinationStore';
export { SupabaseCoordinationStore } from './stores/supabaseCoordinationStore';

// Keys (deterministic derivation)
export { deriveSemanticRootId, normalizeTopic } from './coordinationKeys';

// Flags
export {
  isCoordinationRegistryEnabled,
  isCoordinationPersistEnabled,
  isCoordinationEmbeddingEnabled,
  COORDINATION_REGISTRY_ENV_VAR,
  COORDINATION_PERSIST_ENV_VAR,
  COORDINATION_EMBEDDING_ENV_VAR,
} from './coordinationFlags';

// Observability
export {
  recordCoordinationRegister,
  recordDuplicateIntentDecision,
  recordCoordinationDegrade,
} from './coordinationObservability';
