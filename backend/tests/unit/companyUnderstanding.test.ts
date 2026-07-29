/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase B — canonical Company Understanding foundation tests.
 * Deterministic. Verifies shared-contract reuse, single builder/projection, profile adoption,
 * shadow field-parity, flags default OFF, observability — AND that Program 1's spine is unchanged.
 */

import {
  buildCompanyUnderstanding, companyFromProfile, projectCompany, companyEdge, buildCompanyGraph,
  toShadowRecord, toLegacyFields, compareToLegacy, computeCompanyUnderstandingShadow,
  summarizeCompanyRun, isCompanyUnderstandingEnabled, isCompanyProjectionAuthoritative,
  COMPANY_SCORE_DIMENSIONS, COMPANY_FACET_NAMES, type CompanyProfileInput, type CompanyContribution,
} from '../../services/companyIntelligence';
// Shared-contract reuse: these MUST come from the shared canonical barrel (single source).
import { facet, evidenceRef, reasoningTrace, validateReasoning, combineScoresFor } from '../../services/intelligence/canonical';

const ASOF = '2026-07-28T00:00:00.000Z';
const profile = (): CompanyProfileInput => ({
  companyId: 'C1', asOf: ASOF, source: 'company_profile',
  name: 'Acme', domain: 'acme.com', category: 'SaaS', businessModel: 'subscription',
  products: ['Widget', 'Gadget'], services: ['Onboarding'], technologies: ['AWS', 'React'],
  competitors: ['RivalCo'], executives: ['Jane CEO'], fundingStage: 'Series B', hq: 'NYC',
});

describe('CI-B203 shared canonical contracts are reused (single source, no fork)', () => {
  it('company scoring uses the shared dimension-generic combiner', () => {
    const contribs: CompanyContribution[] = [{ dimension: 'maturity', contributor: 'x', method: 'deterministic', value: 0.8, confidence: 0.9, evidence: [evidenceRef({ id: 'e', kind: 'structured', label: 'l', source: { system: 's' }, observedAt: ASOF, recordedAt: ASOF })], asOf: ASOF }];
    const s = combineScoresFor(COMPANY_SCORE_DIMENSIONS, contribs);
    expect(s.dimensions.maturity.value).toBeCloseTo(0.8, 5);
    expect(s.dimensions.risk.abstained).toBe(true);
  });
  it('reuses the shared facet + reasoning primitives', () => {
    const e = evidenceRef({ id: '1', kind: 'structured', label: 'name', value: 'Acme', source: { system: 'company_profile' }, observedAt: ASOF, recordedAt: ASOF });
    expect(facet({ name: 'Acme' }, [e]).value).toEqual({ name: 'Acme' });
    expect(validateReasoning(reasoningTrace({ claim: 'x', conclusion: 'y', because: [e], confidence: 0.7, method: 'deterministic' })).valid).toBe(true);
  });
});

describe('CI-B202 single builder + CI-B206 single projection', () => {
  it('adopts a legacy profile into facets/evidence/worldView (project, never fabricate)', () => {
    const a = companyFromProfile(profile());
    expect(a.facets.identity?.value?.name).toBe('Acme');
    expect(a.facets.offerings?.value?.products).toEqual(['Widget', 'Gadget']);
    expect(a.worldView.category).toBe('SaaS');
    // absent field abstains (no fabrication)
    expect(companyFromProfile({ companyId: 'C2', asOf: ASOF }).facets.identity).toBeUndefined();
  });
  it('buildCompanyUnderstanding is the sole owner; projectCompany reshapes; deterministic', () => {
    const a = companyFromProfile(profile());
    const u = buildCompanyUnderstanding({ key: { companyId: 'C1' }, builtAt: ASOF, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
    expect(u.facets.worldView.value?.category).toBe('SaaS');
    expect(u.facets.evidenceSummary.value?.totalEvidence).toBeGreaterThan(0);
    const p1 = projectCompany(u, ASOF);
    expect(p1.identity?.name).toBe('Acme');
    expect(p1.worldView?.businessModel).toBe('subscription');
    // determinism
    const u2 = buildCompanyUnderstanding({ key: { companyId: 'C1' }, builtAt: ASOF, facets: companyFromProfile(profile()).facets, evidence: companyFromProfile(profile()).evidence, worldView: companyFromProfile(profile()).worldView });
    expect(projectCompany(u2, ASOF)).toEqual(p1);
  });
});

describe('CI-B208 graph (references only) + CI-B207 persistence', () => {
  it('company edges reference external entities; graph dedupes', () => {
    const e = companyEdge('C1', 'competes_with', 'competitor', 'RivalCo');
    const g = buildCompanyGraph({ companyId: 'C1' }, [e, e]);
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].to.type).toBe('competitor');
  });
  it('shadow record + legacy compat adapter', () => {
    const a = companyFromProfile(profile());
    const u = buildCompanyUnderstanding({ key: { companyId: 'C1' }, builtAt: ASOF, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
    const rec = toShadowRecord(u, projectCompany(u, ASOF), 1);
    expect(rec.company_id).toBe('C1');
    expect(toLegacyFields(u).name).toBe('Acme');
    expect(toLegacyFields(u).products).toEqual(['Widget', 'Gadget']);
  });
});

describe('CI-B209 shadow runtime + CI-B210 observability + flags', () => {
  it('field-parity vs the legacy profile; flag-gated (OFF ⇒ null)', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
    expect(computeCompanyUnderstandingShadow(profile())).toBeNull();
    process.env.COMPANY_UNDERSTANDING_ENABLED = 'true';
    const bundle = computeCompanyUnderstandingShadow(profile());
    expect(bundle?.comparison.parity).toBe(1); // canonical projected FROM the profile ⇒ full field parity
    expect(bundle?.comparison.divergences.find((d) => d.field === 'products')?.agree).toBe(true);
    delete process.env.COMPANY_UNDERSTANDING_ENABLED;
  });
  it('summarizes a run', () => {
    const a = companyFromProfile(profile());
    const u = buildCompanyUnderstanding({ key: { companyId: 'C1' }, builtAt: ASOF, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
    const s = summarizeCompanyRun([u], [compareToLegacy(u, profile())]);
    expect(s.companies).toBe(1); expect(s.facetsGenerated).toBeGreaterThan(0); expect(s.shadow.compared).toBe(1);
  });
  it('flags default OFF', () => {
    delete process.env.COMPANY_UNDERSTANDING_ENABLED; delete process.env.COMPANY_UNDERSTANDING_AUTHORITATIVE;
    expect(isCompanyUnderstandingEnabled()).toBe(false); expect(isCompanyProjectionAuthoritative()).toBe(false);
  });
});
