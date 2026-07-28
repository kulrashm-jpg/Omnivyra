/**
 * OFFERING-INTELLIGENCE-PROGRAM-003 / Phase B — canonical Offering Understanding foundation tests.
 * Deterministic. Verifies shared-contract reuse, single builder/projection, seed adoption + discovery
 * + resolution, references-only graph, shadow field-parity, flags OFF, observability.
 */

import {
  buildOfferingUnderstanding, offeringFromSeed, discoverOfferingSeeds, resolveOfferingId, projectOffering,
  offeringEdge, buildOfferingGraph, toShadowRecord, toLegacyFields, compareToLegacy, computeOfferingUnderstandingShadow,
  summarizeOfferingRun, isOfferingUnderstandingEnabled, isOfferingProjectionAuthoritative,
  OFFERING_SCORE_DIMENSIONS, type OfferingSeedInput, type OfferingContribution,
} from '../../services/offeringIntelligence';
import { facet, evidenceRef, reasoningTrace, validateReasoning, combineScoresFor } from '../../services/intelligence/canonical';

const ASOF = '2026-07-28T00:00:00.000Z';
const seed = (): OfferingSeedInput => ({ companyId: 'C1', asOf: ASOF, source: 'company_profile', name: 'Widget Pro', offeringType: 'product', category: 'analytics', positioning: 'fastest', differentiators: ['speed', 'price'], features: ['dashboards', 'alerts'], pricingModel: 'subscription', plans: ['pro', 'enterprise'], industries: ['saas'], personas: ['analyst'] });

describe('OI-B202 shared canonical contracts reused (single source, no fork)', () => {
  it('offering scoring uses the shared dimension-generic combiner', () => {
    const c: OfferingContribution[] = [{ dimension: 'differentiation', contributor: 'x', method: 'deterministic', value: 0.8, confidence: 0.9, evidence: [evidenceRef({ id: 'e', kind: 'structured', label: 'l', source: { system: 's' }, observedAt: ASOF, recordedAt: ASOF })], asOf: ASOF }];
    const s = combineScoresFor(OFFERING_SCORE_DIMENSIONS, c);
    expect(s.dimensions.differentiation.value).toBeCloseTo(0.8, 5);
    expect(s.dimensions.adoption.abstained).toBe(true);
  });
  it('reuses shared facet + reasoning primitives', () => {
    const e = evidenceRef({ id: '1', kind: 'structured', label: 'name', value: 'Widget', source: { system: 'company_profile' }, observedAt: ASOF, recordedAt: ASOF });
    expect(facet({ name: 'Widget' }, [e]).value).toEqual({ name: 'Widget' });
    expect(validateReasoning(reasoningTrace({ claim: 'x', conclusion: 'y', because: [e], confidence: 0.7, method: 'deterministic' })).valid).toBe(true);
  });
});

describe('OI-B201/B203 discovery + resolution + single builder', () => {
  it('resolves deterministic canonical id; discovers seeds from company products/services (dedup+sort)', () => {
    expect(resolveOfferingId('Widget Pro!')).toBe('widget-pro');
    const seeds = discoverOfferingSeeds({ companyId: 'C1', asOf: ASOF, products: ['Widget', 'Widget'], services: ['Onboarding'] });
    expect(seeds.length).toBe(2); // dup collapsed
    expect(seeds.map((s) => s.offeringType)).toEqual(expect.arrayContaining(['product', 'service']));
  });
  it('adopts a seed into facets/evidence (project, never fabricate); abstains on absent fields', () => {
    const a = offeringFromSeed(seed());
    expect(a.key.offeringId).toBe('widget-pro');
    expect(a.facets.features?.value?.features).toEqual(['dashboards', 'alerts']);
    expect(a.facets.compliance).toBeUndefined(); // absent ⇒ abstain
  });
  it('buildOfferingUnderstanding is the sole owner; projectOffering reshapes; deterministic', () => {
    const a = offeringFromSeed(seed());
    const u = buildOfferingUnderstanding({ key: a.key, builtAt: ASOF, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
    expect(u.facets.offeringType.value).toBe('product');
    expect(u.facets.evidenceSummary.value?.totalEvidence).toBeGreaterThan(0);
    const p1 = projectOffering(u, ASOF);
    expect(p1.identity?.name).toBe('Widget Pro'); expect(p1.offeringType).toBe('product');
    const u2 = buildOfferingUnderstanding({ key: offeringFromSeed(seed()).key, builtAt: ASOF, facets: offeringFromSeed(seed()).facets, evidence: offeringFromSeed(seed()).evidence, offeringType: 'product' });
    expect(projectOffering(u2, ASOF)).toEqual(p1);
  });
});

describe('OI-B207 graph (references only) + OI-B208 persistence', () => {
  it('offering edges reference external entities; graph dedupes', () => {
    const e = offeringEdge('widget-pro', 'has_feature', 'feature', 'dashboards');
    const g = buildOfferingGraph({ companyId: 'C1', offeringId: 'widget-pro' }, [e, e]);
    expect(g.edges.length).toBe(1); expect(g.edges[0].to.type).toBe('feature');
  });
  it('shadow record + legacy compat adapter', () => {
    const a = offeringFromSeed(seed());
    const u = buildOfferingUnderstanding({ key: a.key, builtAt: ASOF, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
    const rec = toShadowRecord(u, projectOffering(u, ASOF), 1);
    expect(rec.offering_id).toBe('widget-pro');
    expect(toLegacyFields(u).features).toEqual(['dashboards', 'alerts']);
  });
});

describe('OI-B209 shadow runtime + OI-B210 observability + flags', () => {
  it('field-parity vs the seed; flag-gated (OFF ⇒ null)', () => {
    delete process.env.OFFERING_UNDERSTANDING_ENABLED;
    expect(computeOfferingUnderstandingShadow(seed())).toBeNull();
    process.env.OFFERING_UNDERSTANDING_ENABLED = 'true';
    const bundle = computeOfferingUnderstandingShadow(seed());
    expect(bundle?.comparison.parity).toBe(1); // projected FROM the seed ⇒ full parity
    expect(bundle?.comparison.divergences.find((d) => d.field === 'features')?.agree).toBe(true);
    delete process.env.OFFERING_UNDERSTANDING_ENABLED;
  });
  it('summarizes a run; flags default OFF', () => {
    const a = offeringFromSeed(seed());
    const u = buildOfferingUnderstanding({ key: a.key, builtAt: ASOF, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
    expect(summarizeOfferingRun([u], [compareToLegacy(u, seed())]).offerings).toBe(1);
    delete process.env.OFFERING_UNDERSTANDING_ENABLED; delete process.env.OFFERING_UNDERSTANDING_AUTHORITATIVE;
    expect(isOfferingUnderstandingEnabled()).toBe(false); expect(isOfferingProjectionAuthoritative()).toBe(false);
  });
});
