/**
 * Canonical Company Understanding runtime (COMPANY-INTELLIGENCE-PROGRAM-002 / Phase B).
 * The 2nd canonical Understanding entity on the SHARED Product-Intelligence spine — one builder, one
 * evidence model (Facet), one reasoning contract, one scoring contract, one projection, one graph,
 * one persistence contract, a shadow runtime, and observability. Foundation only (no engines — those
 * are Phase C). Flag-dark, shadow-only, additive, deterministic. Adopts (not rebuilds) the certified
 * COMPANY-PROFILE-ONTOLOGY-001 domain design onto the shared contracts.
 */
export * from './types';
export * from './builder';
export * from './fromProfile';
export * from './projection';
export * from './graph';
export * from './persistence';
export * from './shadowRuntime';
export * from './metrics';
export { isCompanyUnderstandingEnabled, isCompanyProjectionAuthoritative } from './flags';
// Phase 2 — runtime activation readiness. Frozen contract, three-tier readiness, provider validation,
// and THE production facade. Nothing here activates anything or registers a provider.
export {
  COMPANY_CANONICAL_CONTRACT, COMPANY_CONTRACT_VERSION, COMPANY_PUBLISHED_EDGE_TYPES,
  COMPANY_GOVERNANCE_RULES, COMPANY_MIGRATION_PROHIBITIONS,
  validateCompanyContract, type CompanyContractConformance,
} from './contract';
export {
  assessCompanyStructuralReadiness, assessCompanyActivationReadiness, assessCompanyDeploymentReadiness,
  assessCompanyRuntimeReadiness, checkCompanyRuntimeCompatibility,
  validateProviderCompatibility, validateProviderRegistration,
  type CompanyStructuralReadiness, type CompanyActivationReadiness, type CompanyDeploymentReadiness,
  type CompanyRuntimeReadinessReport, type CompanyRuntimeCompatibility,
  type CompanyActivationBlocker, type CompanyDeploymentBlocker,
  type ProviderCompatibilityRow, type ProviderCompatibilityReport, type ProviderRegistrationValidation,
} from './activationReadiness';
export {
  createCompanyProductionFacade,
  type CompanyProductionFacade, type CompanyProducerPort, type CompanyConsumerPort, type CompanyEnrichmentPort,
} from './production/facade';

// ── Phase 3 — runtime dependency contracts + deployment compatibility ─────────────────────────────
export {
  validateRuntimeDependencies, checkCompanyDeploymentCompatibility,
  ACQUISITION_DEPENDENCY_MEMBERS, PERSISTENCE_DEPENDENCY_MEMBERS,
  type CompanyRuntimeDependencies, type CompanyRuntimeDependencyValidation, type DependencySeamValidation,
  type CompanyDeploymentCompatibility, type DeploymentIncompatibility,
  type AcquisitionDeps, type ShadowPersistDeps,
} from './runtimeContracts';

/**
 * ── Phase 3 — CANONICAL RUNTIME EXPORTS ───────────────────────────────────────────────────────────
 * Until now `engines`, `evidence`, `providers` and `adoption` were reachable only by deep import, so
 * a consumer pinned an internal FILE PATH and any reorganisation inside this subsystem became a
 * breaking change for it. These curated re-exports are the contract surface: named rather than
 * `export *`, so what Platform may depend on is a deliberate list and internals stay internal.
 *
 * `registerProvider` and `registerDefaultProviders` ARE exported. That is not a contradiction of the
 * caller-driven invariant — it is the invariant: registration must be an explicit act the caller
 * writes and a reviewer can see. What is prohibited is registration happening on import, which no
 * re-export can cause.
 */
export {
  // Enrichment provider surface
  registerProvider, registerDefaultProviders, registeredProviders, providersFor,
  supportedCapabilities, capabilityReadiness, __clearProvidersForTests,
  enrichCompany, fieldValue, toFirmographicInputs, VENDOR_PROVIDERS,
  measured, unavailable, ENRICHMENT_CAPABILITIES,
  cacheKey, cachedFetch, costSummary, createMemoryStore, readLedger,
  type CompanyEnrichmentProvider, type EnrichmentCapability, type EnrichmentRequest,
  type EnrichmentField, type ProviderResult, type ProviderState, type UnavailableReason,
  type EnrichmentAggregate, type OrchestrationOptions, type ResolvedField, type FieldContribution,
  type CapabilityOutcome,
} from './providers';
export {
  // Evidence surface
  ingestCompanyEvidence, companyFromEvidence, buildCompanyUnderstandingFromEvidence, explainCompanyField,
  classifyLegacySurfaceDelta, runSemanticDelta, COMPANY_SOURCE_WEIGHTS,
  APPROVED_DIVERGENCE, PARITY_LOCKED,
  type EvidenceSources, type FirmographicInput, type EvidenceBuild,
  type FieldDelta, type SurfaceDelta, type SemanticDeltaReport, type DeltaClass,
} from './evidence';
export {
  // Engine + assembly surface
  assembleCompanyUnderstanding, assessCompanyAuthoritativeReadiness, explainCompany, explainCompanyAll,
  validateCompanyShadowBatch,
  type CompanyIntelligenceContext, type CompanyAssemblyResult, type CompanyAuthoritativeReadiness,
  type CompanyShadowReport, type CompanyShadowValidation,
} from './engines';
export {
  // Adoption / consumer read seam
  resolveCompanyProjection, validateConsumerParity,
  type ResolvedCompanyProjection, type ProjectionPath, type ProjectionObservation, type ConsumerParity,
} from './adoption/consumerAdapter';
export {
  // Production producer + parity
  produceCanonicalIdentity, writeInputsFromProfileAndExtraction, collectWriteEvidence,
  type WriteEvidenceInputs, type CanonicalIdentityRecord, type CanonicalIdentityResult, type ProfileFactsLike,
} from './production/canonicalIdentityProducer';
export {
  runProductionParity,
  type ProductionParityCase, type ProductionParityRow, type ProductionParityReport,
} from './production/productionParity';

/**
 * ── PUBLIC API COMPLETION (WS-4H) ─────────────────────────────────────────────────────────────────
 * The symbols below were already being consumed by production, but only by DEEP IMPORT — eight files
 * reached into `adoption/consumers/*` and `production/*` directly, so any reorganisation inside this
 * subsystem was a breaking change for them. The Phase 3 export surface was assembled from what a
 * future Platform consumer was predicted to need; this closes the gap between that prediction and
 * what production actually calls today.
 *
 * The consumers themselves are the source of truth for this list — it is exactly the set of symbols
 * imported from this module by non-test code, and nothing more. No internal helper is exported
 * merely because it exists.
 *
 * Export-only: no implementation, signature, name or behaviour changes.
 */
export {
  // Identity adopters — each already called by exactly one production surface.
  adoptCompanyProfileIdentity,
} from './adoption/consumers/companyProfileConsumer';
export { adoptCompetitorCompanyIdentity } from './adoption/consumers/competitorIntelligenceConsumer';
export { adoptMarketPulseIdentity } from './adoption/consumers/marketPulseConsumer';
export { adoptExecutionCompanyIdentity } from './adoption/consumers/executionIntelligenceConsumer';
export { adoptContentArchitectIdentity } from './adoption/consumers/contentArchitectConsumer';
export { adoptLeadCompanyIdentity } from './adoption/consumers/leadIntelligenceConsumer';
export {
  // Isolated production path — grounded evidence acquisition (reads only; no mutation).
  acquireGroundedEvidence, makeProductionAcquisitionDeps,
} from './production/canonicalEvidenceAcquisition';
export {
  // Isolated production path — canonical shadow job + its store binding.
  runCanonicalShadowJob, makeSupabaseShadowDeps,
} from './production/canonicalShadowJob';
