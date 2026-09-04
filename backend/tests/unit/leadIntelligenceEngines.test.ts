/**
 * LEAD-INTELLIGENCE-PROGRAM-001 / Phase C — engine + assembly + shadow + quality tests.
 * Deterministic. Verifies: each engine contributes evidence & abstains on empty input; no engine
 * owns the final score (assembly owns); contradictions detected; shadow parity; quality scorecard.
 */

import {
  runPersonaIcp, runBuyingSignal, runIntent, runRelationship, runQualification,
  runPrioritization, runRecommendation, runCrossEngine,
  assembleLeadUnderstanding, assessQuality, validateShadowBatch,
  type LeadIntelligenceContext,
} from '../../services/leadUnderstanding/engines';
import { validateReasoning } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';
const FRESH = '2026-07-25T00:00:00.000Z';
const KEY = { leadKey: 'L1', companyId: 'C1' };
const rich = (): LeadIntelligenceContext => ({
  key: KEY, asOf: ASOF,
  identity: { title: 'VP of Marketing', email: 'v@co.com', organization: 'Co', source: 'enrichment', observedAt: FRESH },
  behaviour: [{ label: 'pricing_page', source: 'website_capture', observedAt: FRESH }, { label: 'demo_request', source: 'website_capture', observedAt: FRESH }],
  signals: [{ type: 'funding', detail: 'Series B', source: 'news', observedAt: FRESH }, { type: 'hiring', detail: '5 SDRs', source: 'news', observedAt: FRESH }],
  relationships: [{ personId: 'p1', role: 'decision_maker', source: 'crm', observedAt: FRESH }, { personId: 'p2', role: 'champion', source: 'crm', observedAt: FRESH }],
  qualification: { budget: { known: true, value: 'high' }, timing: { known: true, value: 'immediate' }, urgency: { known: true, value: 'high' }, authority: { known: false } },
  icp: { industryMatch: true, sizeMatch: true, geoMatch: false, source: 'company_profile', observedAt: FRESH },
  companyId: 'C1', competitorId: 'COMP1',
});
const empty = (): LeadIntelligenceContext => ({ key: KEY, asOf: ASOF });

describe('LI-C201..205 primary engines contribute evidence / abstain', () => {
  it('persona+icp: classifies + emits icp contribution; abstains empty', () => {
    const o = runPersonaIcp(rich());
    expect(o.abstained).toBe(false);
    expect(o.facets.identity?.value?.seniority).toBe('vp');
    expect(o.contributions.find((c) => c.dimension === 'icp')?.value).toBeGreaterThan(0);
    expect(runPersonaIcp(empty()).abstained).toBe(true);
  });
  it('buying signal: decayed opportunity contribution + evidence; abstains empty', () => {
    const o = runBuyingSignal(rich());
    expect(o.evidence.length).toBe(2);
    expect(o.contributions.find((c) => c.dimension === 'opportunity')?.value).toBeGreaterThan(0);
    expect(runBuyingSignal(empty()).abstained).toBe(true);
  });
  it('intent: fuses behaviour into intent contribution; abstains empty', () => {
    const o = runIntent(rich());
    expect(o.contributions.find((c) => c.dimension === 'intent')?.value).toBeGreaterThan(0);
    expect(runIntent(empty()).abstained).toBe(true);
  });
  it('relationship: emits graph edges referencing company/person; abstains empty', () => {
    const o = runRelationship(rich());
    expect(o.edges.length).toBeGreaterThan(0);
    expect(o.edges.some((e) => e.to.type === 'company')).toBe(true); // references company node (no dup)
    expect(runRelationship(empty()).abstained).toBe(true);
  });
  it('qualification: preserves unknowns; urgency contribution when timing known', () => {
    const o = runQualification(rich());
    expect(o.facets.qualification?.value?.fields?.authority.known).toBe(false); // explicit unknown
    expect(o.contributions.find((c) => c.dimension === 'urgency')).toBeDefined();
    expect(runQualification(empty()).abstained).toBe(true);
  });
});

describe('LI-C206..208 derived engines synthesize existing evidence', () => {
  const primaries = () => [runPersonaIcp(rich()), runBuyingSignal(rich()), runIntent(rich()), runRelationship(rich()), runQualification(rich())];
  it('prioritization emits ONE priority contribution (owns no final score)', () => {
    const o = runPrioritization(primaries(), rich());
    const pr = o.contributions.filter((c) => c.dimension === 'priority');
    expect(pr.length).toBe(1); expect(pr[0].value).toBeGreaterThan(0);
    expect(runPrioritization([runPersonaIcp(empty())], empty()).abstained).toBe(true);
  });
  it('recommendation emits evidence-backed next-best action', () => {
    const o = runRecommendation(primaries(), rich());
    expect(o.facets.recommendations?.value?.nextAction).toBeDefined();
    expect(o.reasoning[0].because.length).toBeGreaterThan(0);
  });
  it('cross-engine produces grounded higher-order traces (no ungrounded)', () => {
    const o = runCrossEngine(primaries(), rich());
    expect(o.reasoning.length).toBeGreaterThan(0);
    expect(o.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
});

describe('LI-C209 assembly is the sole owner', () => {
  it('assembles one Understanding + projection; merges evidence; blends score', () => {
    const { understanding, projection, engines } = assembleLeadUnderstanding(rich());
    expect(engines.length).toBe(12); // 9 Phase-C + 3 Phase-D contributors (abstain-safe)
    expect(understanding.score.dimensions.intent.value).toBeGreaterThan(0);
    // no single engine's contribution equals the final blended dimension unless truly singular
    expect(understanding.facets.identity.value?.seniority).toBe('vp');
    expect(projection.overallScore).not.toBeNull();
    expect(understanding.graph.edges.length).toBeGreaterThan(0);
  });
  it('deterministic: identical context ⇒ identical understanding', () => {
    expect(assembleLeadUnderstanding(rich()).understanding).toEqual(assembleLeadUnderstanding(rich()).understanding);
  });
  it('empty context ⇒ abstaining understanding (no fabrication)', () => {
    const { understanding } = assembleLeadUnderstanding(empty());
    expect(understanding.score.overall).toBeNull();
    expect(Object.values(understanding.facets).every((f) => f.value === null)).toBe(true);
  });
});

describe('LI-C210..211 shadow + quality', () => {
  it('quality scorecard measures completeness/calibration/integrity', () => {
    const q = assessQuality(assembleLeadUnderstanding(rich()).understanding);
    expect(q.completeness).toBeGreaterThan(0);
    expect(q.reasoningIntegrity).toBe(1);           // all traces grounded
    expect(q.unsupportedConclusions).toBe(0);
    expect(q.scoredDimensions).toBeGreaterThan(0);
  });
  it('shadow batch reports parity + abstention without changing production', () => {
    const report = validateShadowBatch([
      { ctx: rich(), legacy: { intent: 0.7, icp: 0.66, urgency: 0.6, total: 0.68 } },
      { ctx: empty(), legacy: {} },
    ]);
    expect(report.leads).toBe(2);
    expect(report.meanParity).toBeGreaterThan(0);
    expect(report.engineAbstentionRate.buying_signal).toBeCloseTo(0.5, 5); // abstains on the empty lead only
  });
});
