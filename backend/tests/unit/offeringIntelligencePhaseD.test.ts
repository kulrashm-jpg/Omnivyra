/**
 * OFFERING-INTELLIGENCE-PROGRAM-003 / Phase D — enrichment + fusion + explainability + consumer
 * adapter + cross-understanding validation + authoritative readiness. Deterministic. Confirms
 * abstain-safe additions preserve Phase C, and the consumer seam defaults to legacy (flag OFF).
 */

import { runEnrichment, assembleOfferingUnderstanding, explainOffering, fuseEvidence, validateCrossUnderstanding, assessOfferingAuthoritativeReadiness, type OfferingIntelligenceContext } from '../../services/offeringIntelligence/engines';
import { resolveOfferingProjection, validateOfferingConsumerParity } from '../../services/offeringIntelligence/adoption/consumerAdapter';
import { validateReasoning, evidenceRef } from '../../services/intelligence/canonical';
import type { OfferingSeedInput } from '../../services/offeringIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';
const KEY = { companyId: 'C1', offeringId: 'widget-pro' };
const seed = (): OfferingSeedInput => ({ companyId: 'C1', asOf: ASOF, name: 'Widget Pro', offeringType: 'product', category: 'analytics', features: ['dashboards'], plans: ['pro'] });
const rich = (): OfferingIntelligenceContext => ({
  key: KEY, asOf: ASOF, seed: seed(),
  features: { features: ['dashboards'], source: 'bd', observedAt: ASOF },
  personas: [{ name: 'Analyst', role: 'user', source: 'crm', observedAt: ASOF }],
  enrichment: { editions: ['pro', 'ent'], marketplacePresence: ['aws'], ecosystemMaturity: 'high', developerAdoption: 'strong', customerSuccess: 'high', onboardingMaturity: 'mature', implementationComplexity: 'low', source: 'clearbit', observedAt: ASOF },
});

describe('OI-D401 enrichment (abstain-safe)', () => {
  it('emits ecosystem/adoption facets + maturity+adoption; abstains empty', () => {
    const o = runEnrichment(rich());
    expect(o.facets.ecosystem?.value?.partners).toContain('aws');
    expect(o.contributions.map((c) => c.dimension)).toEqual(expect.arrayContaining(['maturity', 'adoption']));
    expect(runEnrichment({ key: KEY, asOf: ASOF }).abstained).toBe(true);
  });
  it('assembly includes enrichment; Phase C preserved when enrichment absent', () => {
    const withE = assembleOfferingUnderstanding(rich());
    expect(withE.engines.length).toBe(14); // 12 primary + enrichment + cross-engine
    const noE = assembleOfferingUnderstanding({ key: KEY, asOf: ASOF, seed: seed(), features: { features: ['dashboards'], source: 'bd', observedAt: ASOF } });
    expect(noE.engines.find((e) => e.engine === 'enrichment')?.abstained).toBe(true);
  });
});

describe('OI-D402 fusion (shared, reused)', () => {
  it('dedupes + surfaces conflicts (Program 1 fuseEvidence reused)', () => {
    const e = (id: string, v: string, sys: string) => evidenceRef({ id, kind: 'observed', label: 'name', value: v, source: { system: sys }, observedAt: ASOF, recordedAt: ASOF });
    const r = fuseEvidence([e('1', 'Widget', 'crm'), e('1b', 'Widget', 'crm'), e('2', 'Widget X', 'web')]);
    expect(r.fused.length).toBe(2); expect(r.contradictions.length).toBeGreaterThan(0);
  });
});

describe('OI-D403 explainability', () => {
  it('explains a conclusion (evidence/uncertainty)', () => {
    const u = assembleOfferingUnderstanding(rich()).understanding;
    const claim = u.reasoning[0]?.claim ?? 'feature_breadth';
    const ex = explainOffering(u, claim);
    expect(ex.evidence.length).toBeGreaterThan(0);
    expect(ex.uncertainty).toBeCloseTo(1 - ex.confidence, 5);
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
});

describe('OI-D404 consumer adapter (seam; flag-gated)', () => {
  it('flag OFF ⇒ legacy fields (zero production change); parity', () => {
    delete process.env.OFFERING_UNDERSTANDING_AUTHORITATIVE;
    const r = resolveOfferingProjection(seed());
    expect(r.source).toBe('legacy'); expect(r.fields.name).toBe('Widget Pro');
    process.env.OFFERING_UNDERSTANDING_AUTHORITATIVE = 'true';
    const c = resolveOfferingProjection(seed());
    expect(c.source).toBe('canonical'); expect(c.fields.offering_id).toBe('widget-pro');
    delete process.env.OFFERING_UNDERSTANDING_AUTHORITATIVE;
    expect(validateOfferingConsumerParity(seed()).matches).toBe(true);
  });
});

describe('OI-D405 cross-understanding validation', () => {
  it('references-only ownership; graph integrity; consistent', () => {
    const u = assembleOfferingUnderstanding(rich()).understanding;
    const r = validateCrossUnderstanding(u);
    expect(r.rootIsOffering).toBe(true); expect(r.referencesOnly).toBe(true); expect(r.noSelfLoops).toBe(true);
    expect(r.duplicateSemantics).toBe(false); expect(r.consistent).toBe(true);
    expect(r.externalReferenceCount).toBeGreaterThan(0); // persona reference
  });
});

describe('OI-D406 authoritative readiness', () => {
  it('stable, tenant-isolated, observable, cross-consistent, gated', () => {
    const r = assessOfferingAuthoritativeReadiness([{ ctx: rich(), legacy: seed() }], { parityGate: 0.5 });
    expect(r.stable).toBe(true); expect(r.tenantIsolated).toBe(true); expect(r.observable).toBe(true);
    expect(r.crossUnderstandingConsistent).toBe(true); expect(typeof r.ready).toBe('boolean');
  });
});
