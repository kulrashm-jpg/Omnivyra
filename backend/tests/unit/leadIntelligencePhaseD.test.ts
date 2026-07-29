/**
 * LEAD-INTELLIGENCE-PROGRAM-001 / Phase D — enrichment, fusion, behavioral, predictive, strategic,
 * explainability, convergence, authoritative readiness. Deterministic. Confirms the new contributors
 * abstain-safely (Phase C preserved) and the frameworks are evidence-first + explainable.
 */

import {
  runEnrichment, runBehavioral, runStrategic,
  assembleLeadUnderstanding, predict, explain, fuseEvidence, toLegacyView, validateConvergence,
  assessAuthoritativeReadiness, type LeadIntelligenceContext,
} from '../../services/leadUnderstanding/engines';
import { validateReasoning, evidenceRef } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';
const FRESH = '2026-07-25T00:00:00.000Z';
const KEY = { leadKey: 'L1', companyId: 'C1' };
const full = (): LeadIntelligenceContext => ({
  key: KEY, asOf: ASOF,
  identity: { title: 'VP of Marketing', email: 'v@co.com', source: 'enrichment', observedAt: FRESH },
  behaviour: [{ label: 'pricing_page', source: 'website_capture', observedAt: FRESH }],
  signals: [{ type: 'funding', detail: 'Series B', source: 'news', observedAt: FRESH }, { type: 'hiring', source: 'news', observedAt: FRESH }],
  relationships: [{ personId: 'p1', role: 'decision_maker', source: 'crm', observedAt: FRESH }],
  qualification: { budget: { known: true, value: 'high' }, timing: { known: true, value: 'immediate' }, urgency: { known: true, value: 'high' }, authority: { known: false } },
  icp: { industryMatch: true, sizeMatch: true, geoMatch: true, source: 'company_profile', observedAt: FRESH },
  companyId: 'C1', competitorId: 'COMP1',
  enrichment: { executiveProfile: 'Marketing exec', certifications: ['PMP'], skills: ['demand gen'], careerProgression: ['a', 'b'], organizationHistory: ['Co'], verifiedContact: true, source: 'clearbit', observedAt: FRESH },
  behaviouralHistory: [
    { label: 'blog', stage: 'awareness', source: 'website_capture', observedAt: '2026-06-01T00:00:00.000Z' },
    { label: 'pricing', stage: 'evaluation', source: 'website_capture', observedAt: FRESH },
  ],
  strategicInputs: { initiatives: ['modernize stack'], transformation: ['cloud migration'], growthStrategy: ['expand APAC'], source: 'analyst', observedAt: FRESH },
});
const base = (): LeadIntelligenceContext => ({ key: KEY, asOf: ASOF, behaviour: [{ label: 'pricing_page', source: 'website_capture', observedAt: FRESH }] });

describe('LI-D301/303/305 new contributors abstain-safe', () => {
  it('enrichment emits professional facet + abstains without enrichment', () => {
    expect(runEnrichment(full()).facets.professional).toBeDefined();
    expect(runEnrichment(base()).abstained).toBe(true);
  });
  it('behavioral emits engagement facet + intent momentum; abstains without history', () => {
    const o = runBehavioral(full());
    expect(o.facets.engagement?.value?.responsiveness).toBeDefined();
    expect(o.contributions.find((c) => c.dimension === 'intent')).toBeDefined();
    expect(runBehavioral(base()).abstained).toBe(true);
  });
  it('strategic emits buying facet + traces; abstains with neither inputs nor signals', () => {
    expect(runStrategic(full()).reasoning.length).toBeGreaterThan(0);
    expect(runStrategic({ key: KEY, asOf: ASOF }).abstained).toBe(true);
  });
});

describe('Phase C preserved: base context assembles identically with new engines present', () => {
  it('new engines contribute nothing when their inputs are absent', () => {
    const { understanding, engines } = assembleLeadUnderstanding(base());
    expect(engines.length).toBe(11); // 8 (C) + 3 (D) all run; D ones abstain
    expect(engines.filter((e) => ['enrichment', 'behavioral', 'strategic'].includes(e.engine)).every((e) => e.abstained)).toBe(true);
    expect(understanding.score.dimensions.intent.value).toBeGreaterThan(0); // intent still from Phase C intent engine
  });
});

describe('LI-D304 predictive', () => {
  it('exposes probability/confidence/evidence/assumptions/uncertainty; abstains when drivers abstain', () => {
    const { understanding } = assembleLeadUnderstanding(full());
    const p = predict(understanding);
    expect(p.predictions.buying.probability).not.toBeNull();
    expect(p.predictions.buying.uncertainty).toBeCloseTo(1 - p.predictions.buying.confidence, 5);
    expect(p.predictions.buying.assumptions.length).toBeGreaterThan(0);
    const empty = predict(assembleLeadUnderstanding({ key: KEY, asOf: ASOF }).understanding);
    expect(empty.predictions.buying.probability).toBeNull(); // no drivers ⇒ abstain
  });
});

describe('LI-D306 explainability', () => {
  it('answers why/why-now/evidence/assumptions/contradictions/what-changed', () => {
    const a = assembleLeadUnderstanding(full()).understanding;
    const ex = explain(a, 'next_best_action');
    expect(ex.evidence.length).toBeGreaterThan(0);
    expect(ex.signals.length).toBeGreaterThan(0);
    expect(ex.uncertainty).toBeCloseTo(1 - ex.confidence, 5);
    const prior = assembleLeadUnderstanding(base()).understanding;
    expect(explain(a, 'next_best_action', prior).whatChanged.length).toBeGreaterThan(0);
  });
});

describe('LI-D302 fusion', () => {
  it('dedupes, weights by source, resolves conflicts (never drops silently)', () => {
    const e = (id: string, label: string, value: string, system: string, at: string) => evidenceRef({ id, kind: 'observed', label, value, source: { system }, observedAt: at, recordedAt: at });
    const r = fuseEvidence([
      e('1', 'title', 'VP', 'crm', FRESH), e('1b', 'title', 'VP', 'crm', FRESH), // dup content, same source
      e('2', 'title', 'Director', 'social', '2026-05-01T00:00:00.000Z'),          // conflicting, different source
    ]);
    expect(r.fused.length).toBe(2);                       // content dup collapsed
    expect(r.contradictions.length).toBeGreaterThan(0);   // conflict surfaced, not dropped
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe('LI-D307 convergence + LI-D308 readiness', () => {
  it('legacy view adapter + convergence parity', () => {
    const u = assembleLeadUnderstanding(full()).understanding;
    const v = toLegacyView(u);
    expect(v.company_id).toBe('C1'); expect(v.scores.intent).toBe(u.score.dimensions.intent.value);
    expect(validateConvergence(u, { intent: v.scores.intent, icp: v.scores.icp, urgency: v.scores.urgency, total: v.scores.total }).matches).toBe(true);
  });
  it('authoritative readiness: stable, tenant-isolated, observable, gated', () => {
    const r = assessAuthoritativeReadiness([{ ctx: full(), legacy: { intent: 0.6, icp: 1, urgency: 0.7, total: 0.7 } }], { parityGate: 0.5 });
    expect(r.stable).toBe(true); expect(r.tenantIsolated).toBe(true); expect(r.observable).toBe(true);
    expect(r.gates.stability).toBe(true); expect(typeof r.ready).toBe('boolean');
  });
});

describe('grounding: every strategic/behavioral trace is valid', () => {
  it('no ungrounded conclusions', () => {
    const u = assembleLeadUnderstanding(full()).understanding;
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
});
