/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 2 — Company production façade.
 *
 * THE single surface Platform will consume. Producer port, consumer port, readiness across all three
 * tiers, provider validation and parity are all reachable from here, so activation becomes wiring
 * rather than another change inside Company Intelligence.
 *
 * ─── THE FAÇADE CANNOT REGISTER A PROVIDER ─────────────────────────────────────────────────────────
 * It deliberately exposes no `register`. Registration stays caller-driven — the invariant the provider
 * registry was built around: "a module import must never make an external provider reachable". A
 * façade that could register would relocate that decision into a constructor, where nobody reviews it.
 * What it offers instead is `validateRegistration(candidates)`, which answers whether registering a
 * set would be safe without registering it.
 *
 * Creating a façade starts nothing, registers nothing, connects to nothing and performs no egress.
 */

import type { CompanyUnderstanding, CompanyProjection } from '../types';
import type { CompanyProfileInput } from '../fromProfile';
import type { CompanyIntelligenceContext } from '../engines/engineTypes';
import type { CompanyEnrichmentProvider, EnrichmentRequest } from '../providers/contract';
import type { EnrichmentAggregate, OrchestrationOptions } from '../providers/orchestrator';
import type { CompanyShadowBundle } from '../shadowRuntime';
import type { CanonicalIdentityResult, WriteEvidenceInputs } from './canonicalIdentityProducer';
import type { ProductionParityCase, ProductionParityReport } from './productionParity';
import type {
  CompanyStructuralReadiness, CompanyActivationReadiness, CompanyDeploymentReadiness,
  CompanyRuntimeReadinessReport, CompanyRuntimeCompatibility,
  ProviderCompatibilityReport, ProviderRegistrationValidation,
} from '../activationReadiness';

import { produceCanonicalIdentity, writeInputsFromProfileAndExtraction } from './canonicalIdentityProducer';
import { runProductionParity } from './productionParity';
import { computeCompanyUnderstandingShadow } from '../shadowRuntime';
import { projectCompany } from '../projection';
import { validateCompanyContract, type CompanyContractConformance } from '../contract';
import { enrichCompany } from '../providers/orchestrator';
import { VENDOR_PROVIDERS } from '../providers/adapters';
import {
  assessCompanyStructuralReadiness, assessCompanyActivationReadiness, assessCompanyDeploymentReadiness,
  assessCompanyRuntimeReadiness, checkCompanyRuntimeCompatibility,
  validateProviderCompatibility, validateProviderRegistration,
} from '../activationReadiness';
import { validateRuntimeDependencies, checkCompanyDeploymentCompatibility } from '../runtimeContracts';
import type {
  CompanyRuntimeDependencies, CompanyRuntimeDependencyValidation, CompanyDeploymentCompatibility,
} from '../runtimeContracts';

// ── Ports Platform codes against ───────────────────────────────────────────────────────────────────
export interface CompanyProducerPort {
  /** Build the canonical evidence-derived identity + a persistable record. Pure. */
  produce(input: WriteEvidenceInputs): CanonicalIdentityResult;
  /** Adapt profile facts + AI extraction into write-path inputs. Pure. */
  fromProfileAndExtraction: typeof writeInputsFromProfileAndExtraction;
}

export interface CompanyConsumerPort {
  /** Project a produced understanding. Pure. */
  project(u: CompanyUnderstanding, projectedAt: string): CompanyProjection;
  /** The flag-gated shadow bundle, or null when dark. */
  shadow(profile: CompanyProfileInput): CompanyShadowBundle | null;
  /** Contract conformance for a produced understanding. */
  validate(u: CompanyUnderstanding): CompanyContractConformance;
}

/**
 * Enrichment is exposed but NOT armed: `enrichCompany` consults only the providers it is handed or
 * those a caller registered, and an unconfigured provider is never called. With nothing registered
 * and nothing credentialed — today's state — this performs no egress and returns the honest empty
 * aggregate.
 */
export interface CompanyEnrichmentPort {
  enrich(request: EnrichmentRequest, options?: OrchestrationOptions): Promise<EnrichmentAggregate>;
  /** The six vendor adapters as CANDIDATES. Exposed for validation; exposing them registers nothing. */
  readonly candidates: readonly CompanyEnrichmentProvider[];
}

export interface CompanyProductionFacade {
  readonly producer: CompanyProducerPort;
  readonly consumer: CompanyConsumerPort;
  readonly enrichment: CompanyEnrichmentPort;

  structuralReadiness(ctx: CompanyIntelligenceContext): CompanyStructuralReadiness;
  activationReadiness(): CompanyActivationReadiness;
  deploymentReadiness(): CompanyDeploymentReadiness;
  runtimeReadiness(ctx?: CompanyIntelligenceContext): CompanyRuntimeReadinessReport;

  validateProviders(candidates?: readonly CompanyEnrichmentProvider[]): ProviderCompatibilityReport;
  validateRegistration(candidates?: readonly CompanyEnrichmentProvider[]): ProviderRegistrationValidation;

  compatibility(expectedContractVersion: number, expectedModelVersion?: number): CompanyRuntimeCompatibility;
  parity(cases: ProductionParityCase[]): ProductionParityReport;

  /** Structural validation of an injected dependency set. Invokes no member of it. */
  validateDependencies(deps?: CompanyRuntimeDependencies): CompanyRuntimeDependencyValidation;
  /** Whether this environment could HOST the subsystem — never whether it should be deployed. */
  deploymentCompatibility(): CompanyDeploymentCompatibility;
}

const producerPort: CompanyProducerPort = {
  produce: produceCanonicalIdentity,
  fromProfileAndExtraction: writeInputsFromProfileAndExtraction,
};

const consumerPort: CompanyConsumerPort = {
  project: projectCompany,
  shadow: computeCompanyUnderstandingShadow,
  validate: validateCompanyContract,
};

const enrichmentPort: CompanyEnrichmentPort = {
  enrich: enrichCompany,
  candidates: VENDOR_PROVIDERS,
};

/**
 * Build the façade. No side effect: no registration, no connection, no timer, no egress. Ports are
 * shared singletons because they are stateless pure delegations to the certified seams.
 */
export function createCompanyProductionFacade(): CompanyProductionFacade {
  return {
    producer: producerPort,
    consumer: consumerPort,
    enrichment: enrichmentPort,

    structuralReadiness: assessCompanyStructuralReadiness,
    activationReadiness: assessCompanyActivationReadiness,
    deploymentReadiness: assessCompanyDeploymentReadiness,
    runtimeReadiness: assessCompanyRuntimeReadiness,

    // Default to the six vendor adapters — the set an adopter is most likely to be considering.
    validateProviders: (candidates = VENDOR_PROVIDERS) => validateProviderCompatibility(candidates),
    validateRegistration: (candidates = VENDOR_PROVIDERS) => validateProviderRegistration(candidates),

    compatibility: checkCompanyRuntimeCompatibility,
    parity: runProductionParity,

    validateDependencies: (d = {}) => validateRuntimeDependencies(d),
    deploymentCompatibility: checkCompanyDeploymentCompatibility,
  };
}

export type { WriteEvidenceInputs, CanonicalIdentityResult, ProductionParityCase, ProductionParityReport };
