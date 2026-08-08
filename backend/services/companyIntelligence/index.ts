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
