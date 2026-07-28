/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase C — engines + assembly + shadow tests.
 * Deterministic. Verifies each engine contributes evidence & abstains on empty input; no engine owns
 * Company Understanding (assembly owns); grounded reasoning; shadow parity.
 */

import {
  runTechnology, runProduct, runGrowth, runExecutive, runCustomerPartner, runFinancial, runCompetitive, runRisk,
  runCrossEngine, assembleCompanyUnderstanding, validateCompanyShadowBatch, type CompanyIntelligenceContext,
} from '../../services/companyIntelligence/engines';
import { validateReasoning } from '../../services/intelligence/canonical';

const ASOF = '2026-07-28T00:00:00.000Z';
const FRESH = '2026-07-25T00:00:00.000Z';
const KEY = { companyId: 'C1' };
const rich = (): CompanyIntelligenceContext => ({
  key: KEY, asOf: ASOF,
  profile: { companyId: 'C1', asOf: ASOF, name: 'Acme', domain: 'acme.com', category: 'SaaS', businessModel: 'subscription', products: ['Widget'], competitors: ['RivalCo'] },
  technology: { stack: ['React', 'Node'], cloud: ['AWS'], ai: ['LLM'], migrations: ['on-prem→cloud'], source: 'bd', observedAt: FRESH },
  product: { products: ['Widget', 'Gadget'], positioning: 'best-in-class', differentiators: ['speed', 'price'], roadmapSignals: ['v2'], source: 'bd', observedAt: FRESH },
  signals: [{ type: 'funding', detail: 'Series B', source: 'news', observedAt: FRESH }, { type: 'hiring', source: 'news', observedAt: FRESH }, { type: 'expansion', source: 'news', observedAt: FRESH }],
  executives: [{ name: 'Jane', role: 'CEO', change: 'joined', influence: 'high', source: 'news', observedAt: FRESH }],
  customers: [{ name: 'BigCo', strategic: true, source: 'crm', observedAt: FRESH }],
  partners: [{ name: 'PartnerCo', type: 'technology', source: 'crm', observedAt: FRESH }],
  financial: { fundingStage: 'Series B', revenueBand: 'high', profitability: 'break-even', runway: 'strong', source: 'pitchbook', observedAt: FRESH },
  competitors: [{ name: 'RivalCo', source: 'serp', observedAt: FRESH }],
  risks: [{ type: 'compliance', impact: 'medium', source: 'analysis', observedAt: FRESH }],
});
const empty = (): CompanyIntelligenceContext => ({ key: KEY, asOf: ASOF });

describe('CI-C301..308 engines contribute evidence / abstain', () => {
  it('technology: maturity contribution; abstains empty', () => { expect(runTechnology(rich()).contributions.find((c) => c.dimension === 'maturity')?.value).toBeGreaterThan(0); expect(runTechnology(empty()).abstained).toBe(true); });
  it('product: market_authority + offerings facet; abstains empty', () => { const o = runProduct(rich()); expect(o.facets.offerings?.value?.products).toContain('Widget'); expect(runProduct(empty()).abstained).toBe(true); });
  it('growth: momentum from decayed signals; abstains empty', () => { expect(runGrowth(rich()).contributions.find((c) => c.dimension === 'momentum')?.value).toBeGreaterThan(0); expect(runGrowth(empty()).abstained).toBe(true); });
  it('executive: leadership facet + member_of edges; abstains empty', () => { const o = runExecutive(rich()); expect(o.edges.some((e) => e.from.type === 'executive')).toBe(true); expect(runExecutive(empty()).abstained).toBe(true); });
  it('customer/partner: fit + edges (references); abstains empty', () => { const o = runCustomerPartner(rich()); expect(o.edges.some((e) => e.to.type === 'customer')).toBe(true); expect(runCustomerPartner(empty()).abstained).toBe(true); });
  it('financial: maturity + inverse-risk; assumptions/uncertainty; abstains empty', () => { const o = runFinancial(rich()); expect(o.contributions.map((c) => c.dimension)).toEqual(expect.arrayContaining(['maturity', 'risk'])); expect(o.reasoning[0].assumptions.length).toBeGreaterThan(0); expect(runFinancial(empty()).abstained).toBe(true); });
  it('competitive: references competitor node (no re-ownership); abstains empty', () => { const o = runCompetitive(rich()); expect(o.edges[0].to.type).toBe('competitor'); expect(o.edges[0].type).toBe('competes_with'); expect(runCompetitive(empty()).abstained).toBe(true); });
  it('risk: risk contribution with impact; abstains empty', () => { expect(runRisk(rich()).contributions.find((c) => c.dimension === 'risk')?.value).toBeGreaterThan(0); expect(runRisk(empty()).abstained).toBe(true); });
});

describe('CI-C309 cross-engine synthesis (grounded, owns nothing)', () => {
  it('produces grounded higher-order traces from existing evidence', () => {
    const primaries = [runTechnology(rich()), runGrowth(rich()), runExecutive(rich())];
    const o = runCrossEngine(primaries, rich());
    expect(o.reasoning.length).toBeGreaterThan(0);
    expect(o.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(o.facets).toEqual({}); // synthesis owns no facet
  });
});

describe('CI-C310 assembly is the sole owner', () => {
  it('assembles one Understanding + projection; merges evidence; blends score', () => {
    const { understanding, projection, engines } = assembleCompanyUnderstanding(rich());
    expect(engines.length).toBe(9); // 8 primary + cross-engine
    expect(understanding.facets.identity.value?.name).toBe('Acme'); // from profile baseline
    expect(understanding.facets.technology.value).not.toBeNull();    // from tech engine
    expect(understanding.score.dimensions.momentum.value).toBeGreaterThan(0);
    expect(understanding.graph.edges.length).toBeGreaterThan(0);
    expect(projection.overallScore).not.toBeNull();
    expect(understanding.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
  it('deterministic; empty context ⇒ abstaining understanding', () => {
    expect(assembleCompanyUnderstanding(rich()).understanding).toEqual(assembleCompanyUnderstanding(rich()).understanding);
    const { understanding } = assembleCompanyUnderstanding(empty());
    expect(understanding.score.overall).toBeNull();
    expect(Object.values(understanding.facets).every((f) => f.value === null)).toBe(true);
  });
});

describe('CI-C311 shadow validation (no production change)', () => {
  it('reports parity + completeness + engine abstention', () => {
    const report = validateCompanyShadowBatch([
      { ctx: rich(), legacy: rich().profile! },
      { ctx: empty(), legacy: { companyId: 'C1', asOf: ASOF } },
    ]);
    expect(report.companies).toBe(2);
    expect(report.meanCompleteness).toBeGreaterThan(0);
    expect(report.engineAbstentionRate.technology).toBeCloseTo(0.5, 5); // abstains on the empty company only
    expect(report.totalUnsupportedConclusions).toBe(0);
  });
});
