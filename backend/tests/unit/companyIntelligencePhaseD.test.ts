/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase D — convergence + enrichment + fusion + explainability +
 * consumer adapter + authoritative readiness. Deterministic. Confirms abstain-safe additions preserve
 * Phase C, and the consumer seam defaults to legacy (flag OFF).
 */

import { runEnrichment, assembleCompanyUnderstanding, explainCompany, fuseEvidence, assessCompanyAuthoritativeReadiness, type CompanyIntelligenceContext } from '../../services/companyIntelligence/engines';
import { resolveCompanyProjection, validateConsumerParity } from '../../services/companyIntelligence/adoption/consumerAdapter';
import { validateReasoning, evidenceRef, combineScoresFor } from '../../services/intelligence/canonical';
import { COMPANY_SCORE_DIMENSIONS, type CompanyContribution } from '../../services/companyIntelligence';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';
const KEY = { companyId: 'C1' };
const profile = (): CompanyProfileInput => ({ companyId: 'C1', asOf: ASOF, name: 'Acme', domain: 'acme.com', category: 'SaaS', businessModel: 'subscription', products: ['Widget'], competitors: ['RivalCo'] });
const rich = (): CompanyIntelligenceContext => ({
  key: KEY, asOf: ASOF, profile: profile(),
  technology: { stack: ['React'], ai: ['LLM'], source: 'bd', observedAt: ASOF },
  signals: [{ type: 'funding', source: 'news', observedAt: ASOF }],
  enrichment: { subsidiaries: ['SubCo'], certifications: ['SOC2', 'ISO27001'], patents: ['P1'], sustainability: ['carbon-neutral'], research: ['AI lab'], source: 'clearbit', observedAt: ASOF },
});

describe('CI-D401 shared scoring convergence (verified via Program 1 regression elsewhere)', () => {
  it('company + shared generic scoring produce a value', () => {
    const c: CompanyContribution[] = [{ dimension: 'maturity', contributor: 'x', method: 'deterministic', value: 0.7, confidence: 0.9, evidence: [evidenceRef({ id: 'e', kind: 'structured', label: 'l', source: { system: 's' }, observedAt: ASOF, recordedAt: ASOF })], asOf: ASOF }];
    expect(combineScoresFor(COMPANY_SCORE_DIMENSIONS, c).dimensions.maturity.value).toBeCloseTo(0.7, 5);
  });
});

describe('CI-D404 enrichment (abstain-safe)', () => {
  it('emits corporateStructure/brand/strategicInitiatives facets + maturity; abstains empty', () => {
    const o = runEnrichment(rich());
    expect(o.facets.corporateStructure?.value?.subsidiaries).toEqual(['SubCo']);
    expect(o.facets.brand?.value?.themes).toContain('carbon-neutral');
    expect(o.contributions.find((c) => c.dimension === 'maturity')?.value).toBeGreaterThan(0);
    expect(runEnrichment({ key: KEY, asOf: ASOF }).abstained).toBe(true);
  });
  it('assembly includes enrichment; Phase C preserved when enrichment absent', () => {
    const withEnrich = assembleCompanyUnderstanding(rich());
    expect(withEnrich.engines.length).toBe(10); // 9 + enrichment
    expect(withEnrich.understanding.facets.corporateStructure.value).not.toBeNull();
    const noEnrich = assembleCompanyUnderstanding({ key: KEY, asOf: ASOF, profile: profile(), technology: { stack: ['React'], source: 'bd', observedAt: ASOF } });
    expect(noEnrich.engines.find((e) => e.engine === 'enrichment')?.abstained).toBe(true);
  });
});

describe('CI-D405 fusion (shared, reused)', () => {
  it('dedupes + surfaces conflicts (Program 1 fuseEvidence reused)', () => {
    const e = (id: string, label: string, value: string, sys: string) => evidenceRef({ id, kind: 'observed', label, value, source: { system: sys }, observedAt: ASOF, recordedAt: ASOF });
    const r = fuseEvidence([e('1', 'name', 'Acme', 'crm'), e('1b', 'name', 'Acme', 'crm'), e('2', 'name', 'Acme Inc', 'web')]);
    expect(r.fused.length).toBe(2); expect(r.contradictions.length).toBeGreaterThan(0);
  });
});

describe('CI-D406 explainability', () => {
  it('explains a conclusion (why/evidence/uncertainty)', () => {
    const u = assembleCompanyUnderstanding(rich()).understanding;
    const claim = u.reasoning[0]?.claim ?? 'operational_maturity';
    const ex = explainCompany(u, claim);
    expect(ex.evidence.length).toBeGreaterThan(0);
    expect(ex.uncertainty).toBeCloseTo(1 - ex.confidence, 5);
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
});

describe('CI-D407 consumer adapter (seam; flag-gated)', () => {
  it('flag OFF ⇒ legacy fields (zero production change); parity harness', () => {
    delete process.env.COMPANY_UNDERSTANDING_AUTHORITATIVE;
    const r = resolveCompanyProjection(profile());
    expect(r.source).toBe('legacy'); expect(r.fields.name).toBe('Acme');
    process.env.COMPANY_UNDERSTANDING_AUTHORITATIVE = 'true';
    const c = resolveCompanyProjection(profile());
    expect(c.source).toBe('canonical'); expect(c.fields.name).toBe('Acme');
    delete process.env.COMPANY_UNDERSTANDING_AUTHORITATIVE;
    expect(validateConsumerParity(profile()).matches).toBe(true);
  });
});

describe('CI-D408 authoritative readiness', () => {
  it('stable, tenant-isolated, observable, gated', () => {
    const r = assessCompanyAuthoritativeReadiness([{ ctx: rich(), legacy: profile() }], { parityGate: 0.5 });
    expect(r.stable).toBe(true); expect(r.tenantIsolated).toBe(true); expect(r.observable).toBe(true);
    expect(typeof r.ready).toBe('boolean');
  });
});
