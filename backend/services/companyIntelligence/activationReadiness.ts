/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 2 — Runtime Activation Readiness (pure; assessment only).
 *
 * Nothing here activates anything. Nothing registers a provider. Nothing performs egress. Every
 * function is a pure assessment over inputs the caller supplies, and the provider-facing helpers
 * deliberately take a candidate LIST rather than reading the global registry, so validating a set can
 * never be mistaken for registering it.
 *
 * ─── THREE READINESS QUESTIONS, DELIBERATELY NOT MERGED ────────────────────────────────────────────
 * They have three different owners and three different remedies, so one boolean cannot serve them.
 *
 *   STRUCTURAL  "is the code correct?"      — contract conformance, determinism, references-only
 *                                             graph, parity against legacy. A property of the CODE.
 *                                             TRUE today.
 *
 *   ACTIVATION  "may the runtime switch on?" — flag set, providers registered, at least one capability
 *                                             routable. A property of the WIRING. FALSE today: the
 *                                             known gap is that `registerDefaultProviders()` has zero
 *                                             callers, which is by DESIGN (registration is
 *                                             caller-driven) but still blocks activation.
 *
 *   DEPLOYMENT  "will it produce data here?" — credentials present for at least one capability. A
 *                                             property of the ENVIRONMENT. FALSE today: no vendor is
 *                                             credentialed anywhere.
 *
 * A structurally perfect subsystem with no registered providers is ACTIVATION-blocked, not broken.
 * A fully registered one with no credentials is DEPLOYMENT-blocked, not broken. Reporting either as
 * "not ready" without saying which would send the wrong engineer to the wrong problem.
 */

import type { CompanyEnrichmentProvider, EnrichmentCapability } from './providers/contract';
import { ENRICHMENT_CAPABILITIES } from './providers/contract';
import { registeredProviders, capabilityReadiness } from './providers/registry';
import { COMPANY_SOURCE_WEIGHTS } from './evidence/buildFromEvidence';
import { COMPANY_CANONICAL_CONTRACT, validateCompanyContract } from './contract';
import { isCompanyUnderstandingEnabled, isCompanyProjectionAuthoritative } from './flags';
import { assembleCompanyUnderstanding } from './engines/assembly';
import type { CompanyIntelligenceContext } from './engines/engineTypes';

// ── STRUCTURAL ─────────────────────────────────────────────────────────────────────────────────────
export interface CompanyStructuralReadiness {
  contractConformant: boolean;
  deterministic: boolean;
  referencesOnly: boolean;
  graphCitizen: boolean;
  tenantScoped: boolean;
  issues: string[];
  ready: boolean;
}

/** A property of the CODE — assessed by building twice and validating against the frozen contract. */
export function assessCompanyStructuralReadiness(ctx: CompanyIntelligenceContext): CompanyStructuralReadiness {
  const a = assembleCompanyUnderstanding(ctx);
  const b = assembleCompanyUnderstanding(ctx);
  const u = a.understanding;

  const conformance = validateCompanyContract(u);
  const deterministic = JSON.stringify(a.understanding) === JSON.stringify(b.understanding);
  const graphCitizen = u.graph.root.type === 'company' && u.graph.edges.every((e) => e.from.type === 'company');
  const referencesOnly = u.graph.edges.every((e) => e.to.type !== 'company');
  const tenantScoped = !!String(u.key.companyId ?? '').trim();

  const issues = [...conformance.issues];
  if (!deterministic) issues.push('assembly is not deterministic across identical reruns');
  if (!graphCitizen) issues.push('graph is not company-rooted');
  if (!referencesOnly) issues.push('graph publication is not references-only');

  return {
    contractConformant: conformance.conforms,
    deterministic, referencesOnly, graphCitizen, tenantScoped, issues,
    ready: conformance.conforms && deterministic && graphCitizen && referencesOnly && tenantScoped,
  };
}

// ── PROVIDER COMPATIBILITY ─────────────────────────────────────────────────────────────────────────
export interface ProviderCompatibilityRow {
  id: string;
  contractShaped: boolean;
  hasCapabilities: boolean;
  precedenceNumeric: boolean;
  /** WS-4F: an unnamed system is fused at the 0.5 fallback and its calibration is silently lost. */
  sourceTrustNamed: boolean;
  unknownCapabilities: string[];
  compatible: boolean;
  issues: string[];
}
export interface ProviderCompatibilityReport {
  rows: ProviderCompatibilityRow[];
  compatibleCount: number;
  incompatibleCount: number;
  allCompatible: boolean;
}

/**
 * Validate a CANDIDATE provider list against the provider contract and the source-trust policy.
 * Takes the list explicitly — it never reads the registry — so validating can never be mistaken for
 * registering.
 */
export function validateProviderCompatibility(candidates: readonly CompanyEnrichmentProvider[]): ProviderCompatibilityReport {
  const known = new Set<string>(ENRICHMENT_CAPABILITIES);

  const rows: ProviderCompatibilityRow[] = candidates.map((p) => {
    const issues: string[] = [];
    const id = String(p?.id ?? '');
    const hasCapabilities = Array.isArray(p?.capabilities) && p.capabilities.length > 0;
    const precedenceNumeric = Number.isFinite(p?.precedence as number);
    const contractShaped = !!id && typeof p?.isConfigured === 'function' && typeof p?.fetch === 'function';
    const sourceTrustNamed = !!id && Object.prototype.hasOwnProperty.call(COMPANY_SOURCE_WEIGHTS, id);
    const unknownCapabilities = (p?.capabilities ?? []).filter((c) => !known.has(c)).map(String);

    if (!contractShaped) issues.push('does not satisfy CompanyEnrichmentProvider (id / isConfigured / fetch)');
    if (!hasCapabilities) issues.push('declares no capabilities — it can never be routed');
    if (!precedenceNumeric) issues.push('precedence is not a finite number — conflict resolution would be non-deterministic');
    if (!sourceTrustNamed) issues.push(`'${id}' is absent from COMPANY_SOURCE_WEIGHTS — its evidence would fuse at the 0.5 fallback (WS-4F)`);
    for (const c of unknownCapabilities) issues.push(`unknown capability '${c}'`);

    return {
      id, contractShaped, hasCapabilities, precedenceNumeric, sourceTrustNamed, unknownCapabilities,
      compatible: issues.length === 0, issues,
    };
  });

  const compatibleCount = rows.filter((r) => r.compatible).length;
  return { rows, compatibleCount, incompatibleCount: rows.length - compatibleCount, allCompatible: rows.length > 0 && compatibleCount === rows.length };
}

// ── PROVIDER REGISTRATION VALIDATION (dry-run; registers nothing) ──────────────────────────────────
export interface ProviderRegistrationValidation {
  registeredCount: number;
  /** True when nothing is registered — the expected, designed state at import time. */
  callerDrivenPreserved: boolean;
  duplicateIds: string[];
  candidateCompatibility: ProviderCompatibilityReport;
  /** Capabilities the candidate set WOULD cover if a caller registered it. */
  wouldCoverCapabilities: EnrichmentCapability[];
  safeToRegister: boolean;
}

/**
 * Answer "would registering this set be safe" WITHOUT registering it. Also reports whether the
 * caller-driven invariant still holds: importing this subsystem must leave the registry empty, and a
 * non-empty registry at assessment time means some module registered on import.
 */
export function validateProviderRegistration(candidates: readonly CompanyEnrichmentProvider[]): ProviderRegistrationValidation {
  const registeredCount = registeredProviders().length;
  const ids = candidates.map((p) => String(p?.id ?? ''));
  const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  const candidateCompatibility = validateProviderCompatibility(candidates);

  const covered = new Set<EnrichmentCapability>();
  for (const p of candidates) for (const c of p?.capabilities ?? []) covered.add(c);

  return {
    registeredCount,
    callerDrivenPreserved: registeredCount === 0,
    duplicateIds,
    candidateCompatibility,
    wouldCoverCapabilities: [...covered].sort(),
    safeToRegister: candidateCompatibility.allCompatible && duplicateIds.length === 0,
  };
}

// ── ACTIVATION ─────────────────────────────────────────────────────────────────────────────────────
export type CompanyActivationBlocker =
  | 'understanding_flag_disabled'
  | 'no_providers_registered'
  | 'no_routable_capability'
  | 'incompatible_providers_registered'
  | 'projection_not_authoritative';

export interface CompanyActivationReadiness {
  understandingEnabled: boolean;
  projectionAuthoritative: boolean;
  registeredProviderCount: number;
  routableCapabilities: EnrichmentCapability[];
  blockers: CompanyActivationBlocker[];
  canActivate: boolean;
}

/**
 * A property of the WIRING. `projection_not_authoritative` is REPORTED but does not gate activation:
 * shadow operation is a valid activation state, and requiring authority to activate would force the
 * subsystem straight from dark to load-bearing.
 */
export function assessCompanyActivationReadiness(): CompanyActivationReadiness {
  const understandingEnabled = isCompanyUnderstandingEnabled();
  const projectionAuthoritative = isCompanyProjectionAuthoritative();
  const registered = registeredProviders();
  const routableCapabilities = [...new Set(registered.flatMap((p) => p.capabilities))].sort();
  const compatibility = validateProviderCompatibility(registered);

  const blockers: CompanyActivationBlocker[] = [];
  if (!understandingEnabled) blockers.push('understanding_flag_disabled');
  if (registered.length === 0) blockers.push('no_providers_registered');
  if (registered.length > 0 && routableCapabilities.length === 0) blockers.push('no_routable_capability');
  if (registered.length > 0 && !compatibility.allCompatible) blockers.push('incompatible_providers_registered');
  if (!projectionAuthoritative) blockers.push('projection_not_authoritative');

  return {
    understandingEnabled,
    projectionAuthoritative,
    registeredProviderCount: registered.length,
    routableCapabilities,
    blockers,
    canActivate: understandingEnabled && registered.length > 0 && routableCapabilities.length > 0 && compatibility.allCompatible,
  };
}

// ── DEPLOYMENT ─────────────────────────────────────────────────────────────────────────────────────
export type CompanyDeploymentBlocker = 'no_provider_credentials' | 'no_capability_ready';

export interface CompanyDeploymentReadiness {
  capabilities: ReturnType<typeof capabilityReadiness>;
  readyCapabilities: EnrichmentCapability[];
  starvedCapabilities: EnrichmentCapability[];
  blockers: CompanyDeploymentBlocker[];
  canProduceData: boolean;
}

/**
 * A property of the ENVIRONMENT — reuses the certified `capabilityReadiness()` rather than
 * re-deriving it. A starved capability is "one key away from working", which is exactly the
 * distinction an operator needs and the reason `no_credential` is not collapsed into `no_coverage`.
 */
export function assessCompanyDeploymentReadiness(): CompanyDeploymentReadiness {
  const capabilities = capabilityReadiness();
  const readyCapabilities = capabilities.filter((c) => c.ready).map((c) => c.capability);
  const starvedCapabilities = capabilities.filter((c) => !c.ready).map((c) => c.capability);

  const blockers: CompanyDeploymentBlocker[] = [];
  if (capabilities.length === 0) blockers.push('no_capability_ready');
  else if (readyCapabilities.length === 0) blockers.push('no_provider_credentials');

  return { capabilities, readyCapabilities, starvedCapabilities, blockers, canProduceData: readyCapabilities.length > 0 };
}

// ── Runtime compatibility ──────────────────────────────────────────────────────────────────────────
export interface CompanyRuntimeCompatibility {
  contractVersion: number;
  modelVersion: number;
  compatible: boolean;
  reason: string | null;
}

/** Whether a consumer pinned to a contract version may consume this subsystem. */
export function checkCompanyRuntimeCompatibility(expectedContractVersion: number, expectedModelVersion?: number): CompanyRuntimeCompatibility {
  const contractVersion = COMPANY_CANONICAL_CONTRACT.contractVersion;
  const modelVersion = COMPANY_CANONICAL_CONTRACT.modelVersion;

  if (expectedContractVersion !== contractVersion) {
    return { contractVersion, modelVersion, compatible: false, reason: `consumer expects contract v${expectedContractVersion}, subsystem publishes v${contractVersion}` };
  }
  if (expectedModelVersion != null && expectedModelVersion !== modelVersion) {
    return { contractVersion, modelVersion, compatible: false, reason: `consumer expects model v${expectedModelVersion}, subsystem publishes v${modelVersion}` };
  }
  return { contractVersion, modelVersion, compatible: true, reason: null };
}

// ── Consolidated report ────────────────────────────────────────────────────────────────────────────
export interface CompanyRuntimeReadinessReport {
  structural: CompanyStructuralReadiness | null;
  activation: CompanyActivationReadiness;
  deployment: CompanyDeploymentReadiness;
  /** Every blocker across both gated tiers, in the order an adopter should resolve them. */
  allBlockers: Array<CompanyActivationBlocker | CompanyDeploymentBlocker>;
  ready: boolean;
}

/**
 * One report, three tiers kept distinct. `structural` is null when no context was supplied — absence
 * of an assessment is reported as absence, never as failure.
 */
export function assessCompanyRuntimeReadiness(ctx?: CompanyIntelligenceContext): CompanyRuntimeReadinessReport {
  const structural = ctx ? assessCompanyStructuralReadiness(ctx) : null;
  const activation = assessCompanyActivationReadiness();
  const deployment = assessCompanyDeploymentReadiness();
  return {
    structural,
    activation,
    deployment,
    allBlockers: [...activation.blockers, ...deployment.blockers],
    ready: (structural?.ready ?? false) && activation.canActivate && deployment.canProduceData,
  };
}
