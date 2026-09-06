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
  PROVIDER_API_KEY, makeTenantCredentialPort, tenantCredentialPort,
} from './credentials';

// A3U — register the adapters that exist, at load, exactly as WS-4 does.
// Importing this barrel is what makes `getProvider('clearbit')` answer.
import { registerPiEnrichmentAdapters } from './adapters';
registerPiEnrichmentAdapters();
export {
  PI_ENRICHMENT_ADAPTERS, registerPiEnrichmentAdapters,
  clearbitEnrichmentAdapter, mapClearbitPayload, CLEARBIT_SUPPORTED_ATTRIBUTES,
} from './adapters';
export type { TenantCredentialPort, TenantCredentialPortOptions } from './credentials';

export {
  defaultPersistObservation, makePersistObservation, resolveEnrichmentAccount,
  toAttributeBags, UNSAFE_ACCOUNT_OUTCOMES,
} from './persistence';
export type { ResolvedEnrichmentTarget } from './persistence';

export {
  creditCostPort, makeCreditCostPort, PROSPECT_ENRICHMENT_ACTION, FORBIDDEN_BORROWED_ACTION,
  // A3X — tenant-funded provider economics. See `cost.ts`.
  tenantFundedExecutionPort, makeTenantFundedExecutionPort,
} from './cost';
export type { TenantFundedPortOptions } from './cost';
export type { CreditCostPortOptions } from './cost';

export {
  ACQUISITION_SOURCES, CONNECTION_STATES, FUNDING_MODELS, SOURCE_TYPES, USABLE_STATES,
  getSource, listSourceStatus, resolveConnectionState, supportsRequest,
} from './sources';
export type {
  AcquisitionSourceDescriptor, ConnectionState, FundingModel, GatewaySubProvider,
  SourceCapabilities, SourceStatus, SourceType,
} from './sources';

export {
  AUTO_SELECTION, INELIGIBILITY_REASONS, evaluateEconomics, evaluateSource, selectAcquisitionSource,
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
