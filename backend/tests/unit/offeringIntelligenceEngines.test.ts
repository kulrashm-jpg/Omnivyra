/**
 * OFFERING-INTELLIGENCE-PROGRAM-003 / Phase C — engines + assembly + shadow tests.
 * Deterministic. Verifies each engine contributes evidence & abstains; no engine owns Offering
 * Understanding (assembly owns); grounded reasoning; references-only graph; shadow parity.
 */

import {
  runFeature, runPricing, runPackaging, runPositioning, runIntegration, runCompliance, runCategoryCapability,
  runMarketFit, runPersona, runAdoption, runLifecycle, runCompetitive, runCrossEngine,
  assembleOfferingUnderstanding, validateOfferingShadowBatch, type OfferingIntelligenceContext,
} from '../../services/offeringIntelligence/engines';
import { validateReasoning } from '../../services/intelligence/canonical';
import type { OfferingSeedInput } from '../../services/offeringIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';
const KEY = { companyId: 'C1', offeringId: 'widget-pro' };
const seed = (): OfferingSeedInput => ({ companyId: 'C1', asOf: ASOF, name: 'Widget Pro', offeringType: 'product', category: 'analytics' });
const rich = (): OfferingIntelligenceContext => ({
  key: KEY, asOf: ASOF, seed: seed(),
  features: { features: ['dashboards', 'alerts'], modules: ['api'], editions: ['pro'], source: 'bd', observedAt: ASOF },
  pricing: { model: 'subscription', plans: ['pro', 'ent'], enterprise: true, freemium: true, trials: true, source: 'bd', observedAt: ASOF },
  packaging: { plans: ['pro', 'ent'], bundles: ['suite'], upgradePaths: ['pro→ent'], featureGating: ['sso'], source: 'bd', observedAt: ASOF },
  positioning: { statement: 'fastest analytics', valueProposition: 'insight in minutes', category: 'analytics', differentiation: ['speed'], source: 'bd', observedAt: ASOF },
  integrations: { apis: ['rest'], integrations: ['slack', 'salesforce'], marketplaces: ['aws'], source: 'bd', observedAt: ASOF },
  compliance: { certifications: ['SOC2'], standards: ['ISO27001'], security: 'strong', source: 'bd', observedAt: ASOF },
  categoryCapability: { primaryCategory: 'analytics', capabilities: ['reporting', 'alerting'], source: 'bd', observedAt: ASOF },
  marketFit: { icpFit: 'high', sizeFit: 'mid-market', industryFit: ['saas'], useCaseFit: ['bi'], source: 'bd', observedAt: ASOF },
  personas: [{ name: 'Analyst', role: 'user', source: 'crm', observedAt: ASOF }, { name: 'VP Data', role: 'decision_maker', source: 'crm', observedAt: ASOF }],
  adoption: { traction: 'growing', retention: 'high', usageMomentum: 'strong', source: 'bd', observedAt: ASOF },
  lifecycle: { stage: 'growth', roadmap: ['v2'], releaseCadence: 'monthly', source: 'bd', observedAt: ASOF },
  competitors: [{ name: 'RivalViz', overlap: ['dashboards'], source: 'serp', observedAt: ASOF }],
});
const empty = (): OfferingIntelligenceContext => ({ key: KEY, asOf: ASOF });

describe('OI-C301..312 engines contribute evidence / abstain', () => {
  it('feature: differentiation+maturity; abstains empty', () => { expect(runFeature(rich()).contributions.length).toBe(2); expect(runFeature(empty()).abstained).toBe(true); });
  it('pricing: maturity from monetization modes; abstains empty', () => { expect(runPricing(rich()).contributions.find((c) => c.dimension === 'maturity')?.value).toBeGreaterThan(0); expect(runPricing(empty()).abstained).toBe(true); });
  it('packaging: maturity + facet; abstains empty', () => { expect(runPackaging(rich()).facets.packaging?.value?.packages?.length).toBeGreaterThan(0); expect(runPackaging(empty()).abstained).toBe(true); });
  it('positioning: differentiation + facets; abstains empty', () => { const o = runPositioning(rich()); expect(o.facets.valueProposition?.value?.statement).toBeDefined(); expect(runPositioning(empty()).abstained).toBe(true); });
  it('integration: differentiation+maturity; abstains empty', () => { expect(runIntegration(rich()).contributions.length).toBe(2); expect(runIntegration(empty()).abstained).toBe(true); });
  it('compliance: maturity; abstains empty', () => { expect(runCompliance(rich()).contributions.find((c) => c.dimension === 'maturity')?.value).toBeGreaterThan(0); expect(runCompliance(empty()).abstained).toBe(true); });
  it('category/capability: differentiation + category facet; abstains empty', () => { expect(runCategoryCapability(rich()).facets.category?.value?.category).toBe('analytics'); expect(runCategoryCapability(empty()).abstained).toBe(true); });
  it('market_fit: market_fit contribution; abstains empty', () => { expect(runMarketFit(rich()).contributions.find((c) => c.dimension === 'market_fit')?.value).toBeGreaterThan(0); expect(runMarketFit(empty()).abstained).toBe(true); });
  it('persona: serves_persona edges (references); abstains empty', () => { const o = runPersona(rich()); expect(o.edges.some((e) => e.type === 'serves_persona' && e.to.type === 'persona')).toBe(true); expect(runPersona(empty()).abstained).toBe(true); });
  it('adoption: adoption contribution; abstains empty', () => { expect(runAdoption(rich()).contributions.find((c) => c.dimension === 'adoption')?.value).toBeGreaterThan(0); expect(runAdoption(empty()).abstained).toBe(true); });
  it('lifecycle: maturity from stage; abstains empty', () => { expect(runLifecycle(rich()).facets.lifecycle?.value?.stage).toBe('growth'); expect(runLifecycle(empty()).abstained).toBe(true); });
  it('competitive: competes_with edges (references, no re-ownership); abstains empty', () => { const o = runCompetitive(rich()); expect(o.edges[0].type).toBe('competes_with'); expect(o.edges[0].to.type).toBe('offering'); expect(runCompetitive(empty()).abstained).toBe(true); });
});

describe('OI-C313 cross-engine synthesis (grounded, owns nothing)', () => {
  it('grounded higher-order traces from existing evidence', () => {
    const primaries = [runFeature(rich()), runPricing(rich()), runMarketFit(rich()), runIntegration(rich()), runCompliance(rich()), runPackaging(rich()), runLifecycle(rich()), runAdoption(rich())];
    const o = runCrossEngine(primaries, rich());
    expect(o.reasoning.length).toBeGreaterThan(0);
    expect(o.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(o.facets).toEqual({});
  });
});

describe('OI-C314 assembly is the sole owner', () => {
  it('assembles one Understanding + projection; merges evidence; blends score', () => {
    const { understanding, projection, engines } = assembleOfferingUnderstanding(rich());
    expect(engines.length).toBe(14); // 12 Phase-C primary + Phase-D enrichment + cross-engine (abstain-safe)
    expect(understanding.facets.identity.value?.name).toBe('Widget Pro'); // from seed baseline
    expect(understanding.score.dimensions.market_fit.value).toBeGreaterThan(0);
    expect(understanding.score.dimensions.differentiation.value).toBeGreaterThan(0);
    expect(understanding.graph.edges.length).toBeGreaterThan(0);
    expect(projection.overallScore).not.toBeNull();
    expect(understanding.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
  it('deterministic; empty context ⇒ abstaining understanding', () => {
    expect(assembleOfferingUnderstanding(rich()).understanding).toEqual(assembleOfferingUnderstanding(rich()).understanding);
    const { understanding } = assembleOfferingUnderstanding(empty());
    expect(understanding.score.overall).toBeNull();
    expect(Object.values(understanding.facets).every((f) => f.value === null)).toBe(true);
  });
});

describe('OI-C315 shadow validation (no production change)', () => {
  it('reports parity + completeness + engine abstention', () => {
    const report = validateOfferingShadowBatch([{ ctx: rich(), legacy: seed() }, { ctx: empty(), legacy: { companyId: 'C1', asOf: ASOF, name: 'x' } }]);
    expect(report.offerings).toBe(2);
    expect(report.meanCompleteness).toBeGreaterThan(0);
    expect(report.engineAbstentionRate.feature).toBeCloseTo(0.5, 5);
    expect(report.totalUnsupportedConclusions).toBe(0);
  });
});
