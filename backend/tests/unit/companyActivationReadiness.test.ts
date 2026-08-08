/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 2 — runtime activation readiness.
 *
 * Four properties in separate groups so a mutation to one cannot be reported by another:
 *
 *   RUNTIME CONTRACTS    — the frozen descriptor and its conformance validator
 *   ACTIVATION READINESS — the WIRING tier, and its separation from structural and deployment
 *   PROVIDER COMPATIBILITY — contract shape and the WS-4F source-trust invariant
 *   BLOCKER REPORTING    — that a blocker names exactly why activation cannot happen
 *
 * The registry is global module state, so every test that touches it clears it first and the suite
 * leaves it empty — otherwise one test's registration would silently satisfy another's assertion.
 */

import {
  COMPANY_CANONICAL_CONTRACT,
  COMPANY_CONTRACT_VERSION,
  COMPANY_GOVERNANCE_RULES,
  COMPANY_MIGRATION_PROHIBITIONS,
  validateCompanyContract,
  assessCompanyStructuralReadiness,
  assessCompanyActivationReadiness,
  assessCompanyDeploymentReadiness,
  assessCompanyRuntimeReadiness,
  checkCompanyRuntimeCompatibility,
  validateProviderCompatibility,
  validateProviderRegistration,
  createCompanyProductionFacade,
  COMPANY_MODEL_VERSION,
  COMPANY_FACET_NAMES,
  COMPANY_SCORE_DIMENSIONS,
} from '../../services/companyIntelligence';
import { assembleCompanyUnderstanding } from '../../services/companyIntelligence/engines/assembly';
import type { CompanyIntelligenceContext } from '../../services/companyIntelligence/engines/engineTypes';
import { VENDOR_PROVIDERS } from '../../services/companyIntelligence/providers/adapters';
import { registerProvider, __clearProvidersForTests } from '../../services/companyIntelligence/providers/registry';
import type { CompanyEnrichmentProvider } from '../../services/companyIntelligence/providers/contract';

const ASOF = '2026-08-08T00:00:00.000Z';

const ctx = (over: Partial<CompanyIntelligenceContext> = {}): CompanyIntelligenceContext => ({
  key: { companyId: 'co-1' },
  asOf: ASOF,
  profile: { companyId: 'co-1', asOf: ASOF, name: 'Acme', domain: 'acme.test', products: ['Widget'] },
  ...over,
});

/** A minimal well-formed provider, named in the source-trust policy. */
const goodProvider = (id = 'clearbit'): CompanyEnrichmentProvider => ({
  id,
  capabilities: ['firmographics'],
  precedence: 10,
  isConfigured: () => false,
  fetch: async () => ({ provider: id, capability: 'firmographics', state: 'unavailable', fields: [], reasonUnavailable: 'no_credential', detail: null, costUnits: 0 }),
});

const savedEnv = { ...process.env };
beforeEach(() => { __clearProvidersForTests(); });
afterEach(() => { __clearProvidersForTests(); process.env = { ...savedEnv }; });

// ── RUNTIME CONTRACTS ──────────────────────────────────────────────────────────────────────────────
describe('Company contract — frozen descriptor', () => {
  it('is frozen and self-consistent with the model it describes', () => {
    expect(Object.isFrozen(COMPANY_CANONICAL_CONTRACT)).toBe(true);
    expect(COMPANY_CANONICAL_CONTRACT.contractVersion).toBe(COMPANY_CONTRACT_VERSION);
    expect(COMPANY_CANONICAL_CONTRACT.modelVersion).toBe(COMPANY_MODEL_VERSION);
    expect([...COMPANY_CANONICAL_CONTRACT.facets]).toEqual([...COMPANY_FACET_NAMES]);
    expect([...COMPANY_CANONICAL_CONTRACT.scoreDimensions]).toEqual([...COMPANY_SCORE_DIMENSIONS]);
  });

  it('records the WS-4F source-trust invariant as governance, not folklore', () => {
    expect(COMPANY_GOVERNANCE_RULES.some((r) => r.includes('COMPANY_SOURCE_WEIGHTS'))).toBe(true);
    expect(COMPANY_GOVERNANCE_RULES.some((r) => r.includes('CALLER-DRIVEN'))).toBe(true);
    expect(COMPANY_MIGRATION_PROHIBITIONS).toContain('import-time provider registration');
    expect(COMPANY_MIGRATION_PROHIBITIONS).toContain('duplicate source-trust policy');
  });

  it('a produced understanding conforms', () => {
    const { understanding } = assembleCompanyUnderstanding(ctx());
    expect(validateCompanyContract(understanding)).toEqual({ conforms: true, issues: [] });
  });

  it('rejects a model-version mismatch and an untenanted key', () => {
    const { understanding } = assembleCompanyUnderstanding(ctx());
    expect(validateCompanyContract({ ...understanding, version: 99 }).conforms).toBe(false);

    const untenanted = validateCompanyContract({ ...understanding, key: { companyId: '' } });
    expect(untenanted.conforms).toBe(false);
    expect(untenanted.issues).toContain('identity key missing companyId');
  });

  it('rejects a foreign graph root', () => {
    const { understanding } = assembleCompanyUnderstanding(ctx());
    const r = validateCompanyContract({ ...understanding, graph: { ...understanding.graph, root: { type: 'lead', id: 'co-1' } } });
    expect(r.conforms).toBe(false);
    expect(r.issues.join(' ')).toContain('graph root lead');
  });
});

// ── PROVIDER COMPATIBILITY ─────────────────────────────────────────────────────────────────────────
describe('Company provider compatibility', () => {
  it('all six shipped vendor adapters are compatible', () => {
    const r = validateProviderCompatibility(VENDOR_PROVIDERS);
    expect(r.rows).toHaveLength(6);
    expect(r.incompatibleCount).toBe(0);
    expect(r.allCompatible).toBe(true);
  });

  it('flags a provider absent from COMPANY_SOURCE_WEIGHTS — the WS-4F failure mode', () => {
    const r = validateProviderCompatibility([goodProvider('brand-new-vendor')]);
    expect(r.rows[0].sourceTrustNamed).toBe(false);
    expect(r.rows[0].compatible).toBe(false);
    expect(r.rows[0].issues.join(' ')).toContain('0.5 fallback');
  });

  it('flags a provider that declares no capabilities — it could never be routed', () => {
    const r = validateProviderCompatibility([{ ...goodProvider(), capabilities: [] }]);
    expect(r.rows[0].hasCapabilities).toBe(false);
    expect(r.rows[0].compatible).toBe(false);
  });

  it('flags non-finite precedence — conflict resolution would be non-deterministic', () => {
    const r = validateProviderCompatibility([{ ...goodProvider(), precedence: NaN }]);
    expect(r.rows[0].precedenceNumeric).toBe(false);
    expect(r.rows[0].compatible).toBe(false);
  });

  it('flags an unknown capability', () => {
    const r = validateProviderCompatibility([{ ...goodProvider(), capabilities: ['telepathy'] as never }]);
    expect(r.rows[0].unknownCapabilities).toEqual(['telepathy']);
    expect(r.rows[0].compatible).toBe(false);
  });

  it('validating a candidate set registers NOTHING', () => {
    validateProviderCompatibility(VENDOR_PROVIDERS);
    expect(assessCompanyActivationReadiness().registeredProviderCount).toBe(0);
  });
});

describe('Company provider registration validation', () => {
  it('confirms the caller-driven invariant holds — importing registers nothing', () => {
    const v = validateProviderRegistration(VENDOR_PROVIDERS);
    expect(v.registeredCount).toBe(0);
    expect(v.callerDrivenPreserved).toBe(true);
  });

  it('reports the capabilities a set WOULD cover, without registering it', () => {
    const v = validateProviderRegistration(VENDOR_PROVIDERS);
    expect(v.wouldCoverCapabilities).toEqual(['firmographics', 'funding', 'hiring', 'identity', 'technology']);
    expect(v.safeToRegister).toBe(true);
    expect(assessCompanyActivationReadiness().registeredProviderCount).toBe(0);
  });

  it('refuses a set with duplicate ids', () => {
    const v = validateProviderRegistration([goodProvider('clearbit'), goodProvider('clearbit')]);
    expect(v.duplicateIds).toEqual(['clearbit']);
    expect(v.safeToRegister).toBe(false);
  });

  it('detects a registry that is no longer empty', () => {
    registerProvider(goodProvider());
    expect(validateProviderRegistration(VENDOR_PROVIDERS).callerDrivenPreserved).toBe(false);
  });
});

// ── ACTIVATION READINESS ───────────────────────────────────────────────────────────────────────────
describe('Company activation readiness — the WIRING tier', () => {
  it('is blocked today, and the primary blocker is that nothing is registered', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
    const a = assessCompanyActivationReadiness();
    expect(a.canActivate).toBe(false);
    expect(a.registeredProviderCount).toBe(0);
    expect(a.blockers).toContain('no_providers_registered');
    expect(a.blockers).toContain('understanding_flag_disabled');
  });

  it('the flag alone does not activate — registration is still required', () => {
    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    const a = assessCompanyActivationReadiness();
    expect(a.understandingEnabled).toBe(true);
    expect(a.canActivate).toBe(false);
    expect(a.blockers).toContain('no_providers_registered');
  });

  it('activates once the flag is set AND a compatible provider is registered', () => {
    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    registerProvider(goodProvider());
    const a = assessCompanyActivationReadiness();
    expect(a.registeredProviderCount).toBe(1);
    expect(a.routableCapabilities).toEqual(['firmographics']);
    expect(a.canActivate).toBe(true);
  });

  it('an INCOMPATIBLE registered provider blocks activation', () => {
    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    registerProvider(goodProvider('unnamed-vendor'));   // absent from the source-trust policy
    const a = assessCompanyActivationReadiness();
    expect(a.blockers).toContain('incompatible_providers_registered');
    expect(a.canActivate).toBe(false);
  });

  it('authoritative projection is reported but does NOT gate activation — shadow is a valid state', () => {
    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    registerProvider(goodProvider());
    const a = assessCompanyActivationReadiness();
    expect(a.projectionAuthoritative).toBe(false);
    expect(a.blockers).toContain('projection_not_authoritative');
    expect(a.canActivate).toBe(true);
  });
});

describe('Company readiness — the three tiers stay distinct', () => {
  it('STRUCTURAL is true today even though activation is not', () => {
    const s = assessCompanyStructuralReadiness(ctx());
    expect(s.contractConformant).toBe(true);
    expect(s.deterministic).toBe(true);
    expect(s.graphCitizen).toBe(true);
    expect(s.ready).toBe(true);
    expect(assessCompanyActivationReadiness().canActivate).toBe(false);
  });

  it('DEPLOYMENT is blocked separately — registered but starved of credentials', () => {
    registerProvider(goodProvider());  // isConfigured() === false
    const d = assessCompanyDeploymentReadiness();
    expect(d.readyCapabilities).toEqual([]);
    expect(d.starvedCapabilities).toEqual(['firmographics']);
    expect(d.blockers).toContain('no_provider_credentials');
    expect(d.canProduceData).toBe(false);
  });

  it('with nothing registered there are no capabilities at all — a different blocker', () => {
    const d = assessCompanyDeploymentReadiness();
    expect(d.capabilities).toEqual([]);
    expect(d.blockers).toContain('no_capability_ready');
  });

  it('the consolidated report keeps all three tiers separate', () => {
    const r = assessCompanyRuntimeReadiness(ctx());
    expect(r.structural?.ready).toBe(true);
    expect(r.activation.canActivate).toBe(false);
    expect(r.deployment.canProduceData).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('a missing structural assessment is reported as absent, never as failure', () => {
    const r = assessCompanyRuntimeReadiness();
    expect(r.structural).toBeNull();
    expect(r.activation).toBeDefined();
  });
});

// ── BLOCKER REPORTING ──────────────────────────────────────────────────────────────────────────────
describe('Company blocker reporting', () => {
  it('names every blocker across the gated tiers, activation first', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
    const r = assessCompanyRuntimeReadiness(ctx());
    expect(r.allBlockers).toEqual([
      'understanding_flag_disabled', 'no_providers_registered', 'projection_not_authoritative', 'no_capability_ready',
    ]);
  });

  it('blockers shrink as each is resolved', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
    const before = assessCompanyRuntimeReadiness().allBlockers.length;

    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    registerProvider(goodProvider());
    const after = assessCompanyRuntimeReadiness().allBlockers;

    expect(after.length).toBeLessThan(before);
    expect(after).not.toContain('understanding_flag_disabled');
    expect(after).not.toContain('no_providers_registered');
    // Still deployment-blocked: registered, but no credential.
    expect(after).toContain('no_provider_credentials');
  });
});

// ── COMPATIBILITY + FAÇADE ─────────────────────────────────────────────────────────────────────────
describe('Company runtime compatibility', () => {
  it('accepts the published version and refuses others', () => {
    expect(checkCompanyRuntimeCompatibility(COMPANY_CONTRACT_VERSION).compatible).toBe(true);
    expect(checkCompanyRuntimeCompatibility(COMPANY_CONTRACT_VERSION + 1).compatible).toBe(false);
    expect(checkCompanyRuntimeCompatibility(COMPANY_CONTRACT_VERSION, 99).compatible).toBe(false);
  });
});

describe('Company production façade', () => {
  it('creating one registers nothing and activates nothing', () => {
    const f = createCompanyProductionFacade();
    expect(f.activationReadiness().registeredProviderCount).toBe(0);
    expect(f.activationReadiness().canActivate).toBe(false);
  });

  it('exposes NO register method — registration stays caller-driven', () => {
    const f = createCompanyProductionFacade() as unknown as Record<string, unknown>;
    expect(Object.keys(f).filter((k) => /register(?!ation)/i.test(k))).toEqual([]);
    expect(typeof (f as { register?: unknown }).register).toBe('undefined');
  });

  it('exposes the vendor adapters as CANDIDATES without registering them', () => {
    const f = createCompanyProductionFacade();
    expect(f.enrichment.candidates).toHaveLength(6);
    expect(f.activationReadiness().registeredProviderCount).toBe(0);
  });

  it('validates the default candidate set out of the box', () => {
    const f = createCompanyProductionFacade();
    expect(f.validateProviders().allCompatible).toBe(true);
    expect(f.validateRegistration().safeToRegister).toBe(true);
  });

  it('enrichment with nothing registered performs no egress and returns the honest empty aggregate', async () => {
    const f = createCompanyProductionFacade();
    const agg = await f.enrichment.enrich({ companyId: 'co-1', domain: 'acme.test', companyName: 'Acme', asOf: ASOF });
    expect(agg.empty).toBe(true);
    expect(agg.fields).toEqual([]);
    expect(agg.costUnits).toBe(0);
  });

  it('the consumer shadow port stays dark by default', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
    const f = createCompanyProductionFacade();
    expect(f.consumer.shadow({ companyId: 'co-1', asOf: ASOF, name: 'Acme' })).toBeNull();
  });

  it('surfaces all three readiness tiers from one object', () => {
    const f = createCompanyProductionFacade();
    expect(f.structuralReadiness(ctx()).ready).toBe(true);
    expect(f.activationReadiness().canActivate).toBe(false);
    expect(f.deploymentReadiness().canProduceData).toBe(false);
    expect(f.runtimeReadiness(ctx()).ready).toBe(false);
  });
});
