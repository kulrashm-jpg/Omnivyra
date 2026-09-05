/**
 * A3 — enrichment provider boundary. Public surface.
 *
 * Provider-specific shapes terminate at an adapter and never appear above it.
 * No provider is currently operational: no adapter is registered and no
 * credential is configured. `listProviderStatus()` is the authoritative answer
 * to "what can we actually call?" — never assume from a file's existence.
 */

export {
  ENRICHMENT_OUTCOMES, NON_CALLING_OUTCOMES, PROVIDER_STATES,
  classifyEnrichmentError, refuse,
} from './contract';
export type {
  EnrichmentOutcome, EnrichmentProviderAdapter, EnrichmentRequest, EnrichmentSubject,
  ProviderField, ProviderResponse, ProviderState,
} from './contract';

export {
  DECLARED_PROVIDERS, getProvider, hasCredential, listProviderStatus,
  providersFor, registerProvider, unregisterProvider,
} from './registry';
export type { DeclaredProvider, ProviderStatus } from './registry';

export {
  DEFAULT_FRESHNESS_DAYS, ENRICHMENT_EXECUTOR_VERSION,
  defaultCostPort, executeEnrichment, wasFree,
} from './execute';
export type { CostDecision, ExecuteEnrichmentPorts, ExecuteEnrichmentResult } from './execute';
