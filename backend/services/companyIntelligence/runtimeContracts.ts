/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 3 — Runtime dependency contracts + validation.
 *
 * Company Intelligence has exactly TWO injectable seams, and until now neither was declared as a
 * runtime surface — they lived inside the modules that consume them, so an adopter had to read
 * `canonicalEvidenceAcquisition` and `canonicalShadowJob` to discover what it was expected to supply.
 * This module names both, composes them into one dependency contract, and validates a supplied set
 * WITHOUT invoking any member of it.
 *
 * ─── VALIDATION NEVER CALLS A DEPENDENCY ───────────────────────────────────────────────────────────
 * Every member of both seams performs I/O — a crawl, an LLM call, a database read, a database write.
 * Validating by invoking would therefore be indistinguishable from running, which is precisely what
 * this phase must not do. So validation is STRUCTURAL: a member is present and callable, or it is
 * not. That is the strongest check available without side effects, and claiming more would be a lie.
 *
 * ─── DEPLOYMENT DECISIONS STAY OUTSIDE ─────────────────────────────────────────────────────────────
 * `checkCompanyDeploymentCompatibility` reports whether the ENVIRONMENT can host the subsystem — it
 * reads no credential value, and it never decides whether to deploy. It answers "would this run
 * here", never "should it". Whether to supply a credential, bind a store or register a provider
 * belongs to whoever owns the deployment, and nothing in this module can make those choices.
 */

import type { AcquisitionDeps } from './production/canonicalEvidenceAcquisition';
import type { ShadowPersistDeps } from './production/canonicalShadowJob';
import type { EnrichmentCapability } from './providers/contract';
import { ENRICHMENT_CAPABILITIES } from './providers/contract';
import { registeredProviders } from './providers/registry';
import { COMPANY_CANONICAL_CONTRACT } from './contract';

// ── The runtime dependency contract ────────────────────────────────────────────────────────────────
/**
 * Everything an adopter may inject. BOTH members are optional: the subsystem is usable with neither
 * (pure production + projection + readiness), with only `acquisition` (evidence gathering, no
 * persistence), or with both. A required dependency would force an adopter to bind a store before it
 * could evaluate anything.
 */
export interface CompanyRuntimeDependencies {
  /** Grounded evidence acquisition — loadProfile / crawl / cleanEvidence / runModel. All READS. */
  acquisition?: AcquisitionDeps;
  /** Shadow persistence — readReportSettings / writeReportSettings. The only write channel. */
  persistence?: ShadowPersistDeps;
}

export const ACQUISITION_DEPENDENCY_MEMBERS = ['loadProfile', 'crawl', 'cleanEvidence', 'runModel'] as const;
export const PERSISTENCE_DEPENDENCY_MEMBERS = ['readReportSettings', 'writeReportSettings'] as const;

export interface DependencySeamValidation {
  seam: 'acquisition' | 'persistence';
  supplied: boolean;
  missingMembers: string[];
  /** True when supplied AND every member is callable. An unsupplied seam is not "invalid". */
  satisfied: boolean;
}

export interface CompanyRuntimeDependencyValidation {
  seams: DependencySeamValidation[];
  acquisitionSatisfied: boolean;
  persistenceSatisfied: boolean;
  /** Capabilities of the subsystem that the supplied dependencies unlock. */
  unlocks: string[];
  issues: string[];
}

const validateSeam = (seam: DependencySeamValidation['seam'], members: readonly string[], supplied: unknown): DependencySeamValidation => {
  if (supplied == null) return { seam, supplied: false, missingMembers: [...members], satisfied: false };
  const bag = supplied as Record<string, unknown>;
  // Structural only — see the header note on why nothing here is invoked.
  const missingMembers = members.filter((m) => typeof bag[m] !== 'function');
  return { seam, supplied: true, missingMembers, satisfied: missingMembers.length === 0 };
};

/**
 * Validate a supplied dependency set. Pure: reads shapes, invokes nothing, and treats an unsupplied
 * seam as unsupplied rather than as a failure — an adopter evaluating the subsystem before binding
 * anything must not be told it is broken.
 */
export function validateRuntimeDependencies(deps: CompanyRuntimeDependencies = {}): CompanyRuntimeDependencyValidation {
  const acquisition = validateSeam('acquisition', ACQUISITION_DEPENDENCY_MEMBERS, deps.acquisition);
  const persistence = validateSeam('persistence', PERSISTENCE_DEPENDENCY_MEMBERS, deps.persistence);

  const issues: string[] = [];
  for (const s of [acquisition, persistence]) {
    if (s.supplied && !s.satisfied) issues.push(`${s.seam} seam supplied but incomplete: missing ${s.missingMembers.join(', ')}`);
  }

  const unlocks: string[] = [];
  if (acquisition.satisfied) unlocks.push('grounded_evidence_acquisition');
  if (persistence.satisfied) unlocks.push('shadow_persistence');

  return {
    seams: [acquisition, persistence],
    acquisitionSatisfied: acquisition.satisfied,
    persistenceSatisfied: persistence.satisfied,
    unlocks,
    issues,
  };
}

// ── Deployment compatibility ───────────────────────────────────────────────────────────────────────
export type DeploymentIncompatibility =
  | 'no_capability_surface'
  | 'registered_capability_not_recognised'
  | 'contract_version_unpublished';

export interface CompanyDeploymentCompatibility {
  contractVersion: number;
  modelVersion: number;
  /** Capabilities the shipped provider contract recognises — the ceiling of what any host can serve. */
  supportedCapabilities: readonly EnrichmentCapability[];
  /** Capabilities the CURRENT registry could route. Empty until a caller registers. */
  routableCapabilities: EnrichmentCapability[];
  incompatibilities: DeploymentIncompatibility[];
  /** Whether the environment could HOST the subsystem — never whether it should. */
  hostable: boolean;
}

/**
 * Whether this environment could host Company Intelligence. Reads no credential VALUE — only whether
 * the shipped capability surface is coherent and whether anything registered declares a capability
 * the contract does not recognise (which would mean the host is running a provider built against a
 * different version of this subsystem).
 */
export function checkCompanyDeploymentCompatibility(): CompanyDeploymentCompatibility {
  const supportedCapabilities = ENRICHMENT_CAPABILITIES;
  const registered = registeredProviders();
  const routableCapabilities = [...new Set(registered.flatMap((p) => p.capabilities))].sort();

  const recognised = new Set<string>(supportedCapabilities);
  const unrecognised = routableCapabilities.filter((c) => !recognised.has(c));

  const incompatibilities: DeploymentIncompatibility[] = [];
  if (supportedCapabilities.length === 0) incompatibilities.push('no_capability_surface');
  if (unrecognised.length > 0) incompatibilities.push('registered_capability_not_recognised');
  if (!Number.isInteger(COMPANY_CANONICAL_CONTRACT.contractVersion) || COMPANY_CANONICAL_CONTRACT.contractVersion < 1) {
    incompatibilities.push('contract_version_unpublished');
  }

  return {
    contractVersion: COMPANY_CANONICAL_CONTRACT.contractVersion,
    modelVersion: COMPANY_CANONICAL_CONTRACT.modelVersion,
    supportedCapabilities,
    routableCapabilities,
    incompatibilities,
    hostable: incompatibilities.length === 0,
  };
}

export type { AcquisitionDeps, ShadowPersistDeps };
