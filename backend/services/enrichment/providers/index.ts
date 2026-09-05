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

export {
  defaultPersistObservation, makePersistObservation, resolveEnrichmentAccount,
  toAttributeBags, UNSAFE_ACCOUNT_OUTCOMES,
} from './persistence';
export type { ResolvedEnrichmentTarget } from './persistence';

export { creditCostPort, makeCreditCostPort, PROSPECT_ENRICHMENT_ACTION, FORBIDDEN_BORROWED_ACTION } from './cost';
export type { CreditCostPortOptions } from './cost';

export {
  ACQUISITION_SOURCES, CONNECTION_STATES, SOURCE_TYPES, USABLE_STATES,
  getSource, listSourceStatus, resolveConnectionState, supportsRequest,
} from './sources';
export type {
  AcquisitionSourceDescriptor, ConnectionState, GatewaySubProvider,
  SourceCapabilities, SourceStatus, SourceType,
} from './sources';

export {
  AUTO_SELECTION, INELIGIBILITY_REASONS, evaluateSource, selectAcquisitionSource,
} from './selection';
export type {
  IneligibilityReason, SelectionCandidate, SelectionMode, SelectionOutcome, SelectionRequest,
} from './selection';

export {
  EXTENSION_SOURCE_ID, EXTENSION_SUPPLIED_ATTRIBUTES, NO_ATTRIBUTE_REASON,
  bridgeExtensionObservation, bridgeExtensionObservationSafely, defaultExtensionBridgePorts,
  normalizeExtensionObservation, observationFromExtensionEvent, REFUSED_CONTEXT_MAPPINGS,
  extensionEventBridgePorts, makeShadowIdentityPort,
} from './extensionBridge';
export type {
  BridgeOutcome, BridgeResult, ExtensionAuthorObservation, ExtensionBridgePorts, ExtensionEventData,
  NormalizationOutcome, NormalizedExtensionObservation,
} from './extensionBridge';
