/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 3 — runtime contracts, façade, dependency and
 * compatibility validation.
 *
 * Four properties in separate groups so a mutation to one cannot be reported by another:
 *
 *   RUNTIME CONTRACTS       — the canonical export surface Platform depends on
 *   RUNTIME FAÇADE          — the single object, and that it still activates nothing
 *   READINESS VALIDATION    — dependency-seam validation, and that it invokes nothing
 *   COMPATIBILITY VALIDATION— deployment hostability
 *
 * The registry is global module state, so every test clears it first and the suite leaves it empty.
 */

import * as CompanyIntelligence from '../../services/companyIntelligence';
import {
  validateRuntimeDependencies,
  checkCompanyDeploymentCompatibility,
  createCompanyProductionFacade,
  ACQUISITION_DEPENDENCY_MEMBERS,
  PERSISTENCE_DEPENDENCY_MEMBERS,
  COMPANY_CONTRACT_VERSION,
  COMPANY_MODEL_VERSION,
  type CompanyRuntimeDependencies,
  type AcquisitionDeps,
  type ShadowPersistDeps,
} from '../../services/companyIntelligence';
import { registerProvider, __clearProvidersForTests } from '../../services/companyIntelligence/providers/registry';
import type { CompanyEnrichmentProvider } from '../../services/companyIntelligence/providers/contract';

const savedEnv = { ...process.env };
beforeEach(() => { __clearProvidersForTests(); });
afterEach(() => { __clearProvidersForTests(); process.env = { ...savedEnv }; });

const provider = (id = 'clearbit', capabilities: string[] = ['firmographics']): CompanyEnrichmentProvider => ({
  id,
  capabilities: capabilities as never,
  precedence: 10,
  isConfigured: () => false,
  fetch: async () => ({ provider: id, capability: 'firmographics', state: 'unavailable', fields: [], reasonUnavailable: 'no_credential', detail: null, costUnits: 0 }),
});

/** Counts every invocation so a "validation" that secretly calls a dependency is caught. */
const spyAcquisition = () => {
  const calls = { n: 0 };
  const deps: AcquisitionDeps = {
    loadProfile: async () => { calls.n += 1; return null; },
    crawl: async () => { calls.n += 1; return []; },
    cleanEvidence: async () => { calls.n += 1; return []; },
    runModel: async () => { calls.n += 1; return null; },
  };
  return { deps, calls };
};
const spyPersistence = () => {
  const calls = { n: 0 };
  const deps: ShadowPersistDeps = {
    readReportSettings: async () => { calls.n += 1; return null; },
    writeReportSettings: async () => { calls.n += 1; },
  };
  return { deps, calls };
};

// ── RUNTIME CONTRACTS (the canonical export surface) ───────────────────────────────────────────────
describe('Company canonical runtime exports', () => {
  it('exposes the provider surface without a deep import', () => {
    for (const name of ['registerProvider', 'registerDefaultProviders', 'registeredProviders', 'providersFor',
      'supportedCapabilities', 'capabilityReadiness', 'enrichCompany', 'toFirmographicInputs', 'VENDOR_PROVIDERS']) {
      expect(CompanyIntelligence).toHaveProperty(name);
    }
  });

  it('exposes the evidence surface, including the source-trust policy', () => {
    for (const name of ['ingestCompanyEvidence', 'buildCompanyUnderstandingFromEvidence',
      'classifyLegacySurfaceDelta', 'COMPANY_SOURCE_WEIGHTS', 'explainCompanyField']) {
      expect(CompanyIntelligence).toHaveProperty(name);
    }
  });

  it('exposes the engine, adoption and production surfaces', () => {
    for (const name of ['assembleCompanyUnderstanding', 'assessCompanyAuthoritativeReadiness',
      'resolveCompanyProjection', 'validateConsumerParity',
      'produceCanonicalIdentity', 'runProductionParity']) {
      expect(CompanyIntelligence).toHaveProperty(name);
    }
  });

  it('exposes every symbol production actually consumes — no consumer needs a deep import', () => {
    // WS-4H. This list is not aspirational: it is exactly the set of symbols imported from this
    // module by non-test code. A missing entry means some production file is pinning an internal
    // path, and any reorganisation inside this subsystem breaks it.
    for (const name of [
      'adoptCompanyProfileIdentity', 'adoptCompetitorCompanyIdentity', 'adoptMarketPulseIdentity',
      'adoptExecutionCompanyIdentity', 'adoptContentArchitectIdentity', 'adoptLeadCompanyIdentity',
      'acquireGroundedEvidence', 'makeProductionAcquisitionDeps',
      'runCanonicalShadowJob', 'makeSupabaseShadowDeps',
      'isCompanyProjectionAuthoritative',
    ]) {
      expect(typeof (CompanyIntelligence as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('the barrel re-export is the SAME reference as the implementation — no wrapper, no behaviour change', async () => {
    // An export that wrapped or re-implemented would change runtime behaviour. Identity comparison
    // is the only check that rules that out.
    const acquisition = await import('../../services/companyIntelligence/production/canonicalEvidenceAcquisition');
    const shadowJob = await import('../../services/companyIntelligence/production/canonicalShadowJob');
    const profileConsumer = await import('../../services/companyIntelligence/adoption/consumers/companyProfileConsumer');

    expect(CompanyIntelligence.acquireGroundedEvidence).toBe(acquisition.acquireGroundedEvidence);
    expect(CompanyIntelligence.makeProductionAcquisitionDeps).toBe(acquisition.makeProductionAcquisitionDeps);
    expect(CompanyIntelligence.runCanonicalShadowJob).toBe(shadowJob.runCanonicalShadowJob);
    expect(CompanyIntelligence.makeSupabaseShadowDeps).toBe(shadowJob.makeSupabaseShadowDeps);
    expect(CompanyIntelligence.adoptCompanyProfileIdentity).toBe(profileConsumer.adoptCompanyProfileIdentity);
  });

  it('exports registration explicitly — the caller-driven invariant, not a contradiction of it', () => {
    // Registration must be an act a caller WRITES and a reviewer can SEE. What is prohibited is
    // registration happening on import — asserted next.
    expect(typeof CompanyIntelligence.registerDefaultProviders).toBe('function');
  });

  it('importing the barrel registers NOTHING', () => {
    // The whole module graph is already loaded by this file's import. If any module registered on
    // import, the registry would be non-empty before any test acted.
    expect(CompanyIntelligence.registeredProviders()).toEqual([]);
  });

  it('the exported source-trust policy still names every shipped vendor (WS-4F)', () => {
    for (const p of CompanyIntelligence.VENDOR_PROVIDERS) {
      expect(Object.prototype.hasOwnProperty.call(CompanyIntelligence.COMPANY_SOURCE_WEIGHTS, p.id)).toBe(true);
    }
  });
});

// ── READINESS VALIDATION (dependency seams) ────────────────────────────────────────────────────────
describe('Company runtime dependency validation', () => {
  it('treats an unsupplied seam as unsupplied, never as broken', () => {
    const v = validateRuntimeDependencies({});
    expect(v.acquisitionSatisfied).toBe(false);
    expect(v.persistenceSatisfied).toBe(false);
    expect(v.issues).toEqual([]);           // absence is not an error
    expect(v.unlocks).toEqual([]);
    expect(v.seams.map((s) => s.supplied)).toEqual([false, false]);
  });

  it('accepts a complete acquisition seam and reports what it unlocks', () => {
    const v = validateRuntimeDependencies({ acquisition: spyAcquisition().deps });
    expect(v.acquisitionSatisfied).toBe(true);
    expect(v.unlocks).toEqual(['grounded_evidence_acquisition']);
  });

  it('accepts both seams', () => {
    const v = validateRuntimeDependencies({ acquisition: spyAcquisition().deps, persistence: spyPersistence().deps });
    expect(v.unlocks).toEqual(['grounded_evidence_acquisition', 'shadow_persistence']);
    expect(v.issues).toEqual([]);
  });

  it('names the missing members of a partially-supplied seam', () => {
    const v = validateRuntimeDependencies({ persistence: { readReportSettings: async () => null } as unknown as ShadowPersistDeps });
    expect(v.persistenceSatisfied).toBe(false);
    const seam = v.seams.find((s) => s.seam === 'persistence')!;
    expect(seam.supplied).toBe(true);
    expect(seam.missingMembers).toEqual(['writeReportSettings']);
    expect(v.issues[0]).toContain('missing writeReportSettings');
  });

  it('lists the full member set for an unsupplied seam', () => {
    const v = validateRuntimeDependencies({});
    expect(v.seams.find((s) => s.seam === 'acquisition')!.missingMembers).toEqual([...ACQUISITION_DEPENDENCY_MEMBERS]);
    expect(v.seams.find((s) => s.seam === 'persistence')!.missingMembers).toEqual([...PERSISTENCE_DEPENDENCY_MEMBERS]);
  });

  it('INVOKES NOTHING — validating is not running', () => {
    // Every member of both seams performs I/O; validating by invoking would be indistinguishable
    // from running the subsystem.
    const a = spyAcquisition();
    const p = spyPersistence();
    validateRuntimeDependencies({ acquisition: a.deps, persistence: p.deps });
    expect(a.calls.n).toBe(0);
    expect(p.calls.n).toBe(0);
  });
});

// ── COMPATIBILITY VALIDATION (deployment hostability) ──────────────────────────────────────────────
describe('Company deployment compatibility', () => {
  it('is hostable on a clean environment and publishes its versions', () => {
    const c = checkCompanyDeploymentCompatibility();
    expect(c.hostable).toBe(true);
    expect(c.incompatibilities).toEqual([]);
    expect(c.contractVersion).toBe(COMPANY_CONTRACT_VERSION);
    expect(c.modelVersion).toBe(COMPANY_MODEL_VERSION);
    expect([...c.supportedCapabilities]).toEqual(['firmographics', 'technology', 'funding', 'hiring', 'identity']);
  });

  it('reports nothing routable until a caller registers', () => {
    expect(checkCompanyDeploymentCompatibility().routableCapabilities).toEqual([]);
    registerProvider(provider());
    expect(checkCompanyDeploymentCompatibility().routableCapabilities).toEqual(['firmographics']);
  });

  it('flags a provider declaring a capability this contract does not recognise', () => {
    // Means the host is running a provider built against a different version of this subsystem.
    registerProvider(provider('clearbit', ['telepathy']));
    const c = checkCompanyDeploymentCompatibility();
    expect(c.incompatibilities).toContain('registered_capability_not_recognised');
    expect(c.hostable).toBe(false);
  });

  it('reads no credential value — an unconfigured provider is still routable', () => {
    registerProvider(provider());   // isConfigured() === false
    expect(checkCompanyDeploymentCompatibility().routableCapabilities).toEqual(['firmographics']);
    expect(checkCompanyDeploymentCompatibility().hostable).toBe(true);
  });
});

// ── RUNTIME FAÇADE ─────────────────────────────────────────────────────────────────────────────────
describe('Company production façade — Phase 3 surface', () => {
  it('validates dependencies through the façade without invoking them', () => {
    const a = spyAcquisition();
    const f = createCompanyProductionFacade();
    const v = f.validateDependencies({ acquisition: a.deps } as CompanyRuntimeDependencies);
    expect(v.acquisitionSatisfied).toBe(true);
    expect(a.calls.n).toBe(0);
  });

  it('defaults to an empty dependency set rather than throwing', () => {
    expect(createCompanyProductionFacade().validateDependencies().issues).toEqual([]);
  });

  it('surfaces deployment compatibility', () => {
    expect(createCompanyProductionFacade().deploymentCompatibility().hostable).toBe(true);
  });

  it('still activates nothing and registers nothing', () => {
    const f = createCompanyProductionFacade();
    f.validateDependencies({ persistence: spyPersistence().deps });
    f.deploymentCompatibility();
    expect(f.activationReadiness().registeredProviderCount).toBe(0);
    expect(f.activationReadiness().canActivate).toBe(false);
  });

  it('exposes the complete Phase 1–3 surface from one object', () => {
    const f = createCompanyProductionFacade();
    for (const m of ['producer', 'consumer', 'enrichment', 'structuralReadiness', 'activationReadiness',
      'deploymentReadiness', 'runtimeReadiness', 'validateProviders', 'validateRegistration',
      'compatibility', 'parity', 'validateDependencies', 'deploymentCompatibility']) {
      expect(f).toHaveProperty(m);
    }
  });

  it('still exposes NO register method', () => {
    const f = createCompanyProductionFacade() as unknown as Record<string, unknown>;
    expect(Object.keys(f).filter((k) => /^register/i.test(k))).toEqual([]);
  });
});
