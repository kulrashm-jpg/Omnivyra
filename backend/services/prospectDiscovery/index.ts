/**
 * B4-A1 — the prospect discovery execution layer.
 *
 * Three concepts, kept apart deliberately:
 *   ENRICHMENT  operate on a canonical entity that already exists  (enrichment/)
 *   DISCOVERY   execute a search that may create the first evidence (here)
 *   INGESTION   normalise provider records into the canonical spine (leadIngestion/)
 *
 * This barrel exports the discovery half only. It deliberately re-exports nothing
 * from `leadIngestion` or `prospectIdentity`: a caller that needs the canonical
 * spine must reach it through the orchestrator every other source uses, and a
 * convenience re-export here would be the first step towards a second path into it.
 */

export {
  DISCOVERY_EXECUTION_STATUSES,
  DISCOVERY_REFUSALS,
  DISCOVERY_BOUND_LIMITS,
  DISCOVERY_EXECUTOR_VERSION,
  PROVIDER_CALL_STATES,
  OPEN_DISCOVERY_STATUSES,
  isOpenDiscoveryStatus,
  canonicalizeSearchCriteria,
  computeSearchDigest,
  validateBounds,
  MalformedSearchError,
  type DiscoveryExecutionStatus,
  type DiscoveryRefusal,
  type DiscoveryBounds,
  type DiscoverySearchRequest,
  type DiscoveryPage,
  type DiscoveryProviderAdapter,
  type ProviderCallState,
} from './contract';

export {
  openDiscoveryExecution,
  claimDiscoveryExecution,
  reclaimExpiredDiscoveryExecution,
  nextDiscoveryAttemptNumber,
  findLiveDiscoveryExecution,
  getDiscoveryExecution,
  markDiscoveryProviderCallPending,
  recordDiscoveryPage,
  completeDiscoveryExecution,
  type DiscoveryAttemptRow,
  type DiscoveryClaim,
} from './discoveryAttemptStore';

export {
  registerDiscoveryProvider,
  getDiscoveryProvider,
  hasDiscoveryProvider,
  listDiscoveryProviders,
  UnregisteredDiscoveryProviderError,
  DiscoveryProviderRegistrationError,
  __resetDiscoveryProviderRegistry,
} from './providerRegistry';

export {
  createDiscoveryExecution,
  runDiscoveryExecution,
  DISCOVERY_LEASE_MS,
  type CreateDiscoveryExecutionInput,
  type CreateDiscoveryExecutionResult,
  type DiscoveryPorts,
  type RunDiscoveryResult,
} from './discoveryExecutor';
