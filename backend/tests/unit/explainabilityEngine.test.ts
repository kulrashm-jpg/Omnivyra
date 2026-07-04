/**
 * BETA-ENGINE-013 — Executive Intelligence & Explainability Engine.
 *
 * Verifies that the full deterministic reasoning chain (Evidence → Validation → Correlation → Root Cause →
 * Recommendation → Business Impact → Commercial ROI → Confidence → Decision) is composed into ONE auditable
 * Explanation, that every stage is traceable/reproducible, and that nothing terminates in a black box.
 * End-to-end from real evidence. Deterministic; no DB; no network; no narrative generation.
 */
import {
  buildExplanation, traceExplanation, traceReference, summarizeExplanation,
  correlateEvidence, diagnoseRootCauses, generateRecommendations, assessBusinessImpact,
  deriveDecisionConfidence, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });

// A full chain from measured evidence.
function fullChain(evidence: Evidence[]) {
  const correlations = correlateEvidence(evidence);
  const rootCauses = diagnoseRootCauses(correlations);
  const recommendations = generateRecommendations(rootCauses);
  const businessImpact = assessBusinessImpact(recommendations, rootCauses, evidence);
  const confidence = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
  return buildExplanation({ decisionId: 'authority:c1', evidence, correlations, rootCauses, recommendations, businessImpact, confidence, rejectedEvidenceKeys: ['bad_ctr'] });
}

const snippetEvidence = [
  m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'),
  m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount'),
];

describe('BETA-ENGINE-013 — explanation composition (Phase 2/3)', () => {
  it('composes the full chain into one auditable artifact', () => {
    const ex = fullChain(snippetEvidence);
    expect(ex.explanationId).toBe('explain:authority:c1');
    expect(ex.evidenceUsed).toContain('impressions');
    expect(ex.correlationRules.length).toBeGreaterThan(0);
    expect(ex.rootCauses.length).toBeGreaterThan(0);
    expect(ex.recommendationRules.length).toBeGreaterThan(0);
    expect(ex.businessRules.length).toBeGreaterThan(0);
    expect(ex.reasonCodes.length).toBeGreaterThan(0);
    expect(ex.providerProvenance).toContain('provider:x');
  });

  it('records evidence IGNORED (validation-rejected rows never influenced the decision)', () => {
    const ex = fullChain(snippetEvidence);
    expect(ex.evidenceIgnored).toContain('bad_ctr');
  });

  it('surfaces commercial evidence + measured ROI in the chain', () => {
    const ex = fullChain(snippetEvidence);
    expect(ex.commercialEvidence).toEqual(expect.arrayContaining(['conversion_rate', 'revenue_per_conversion']));
    expect(ex.roiStatuses).toContain('measured'); // snippet ROI upgraded via commercial evidence
  });

  it('is deterministic', () => {
    expect(fullChain(snippetEvidence)).toEqual(fullChain(snippetEvidence));
  });
});

describe('BETA-ENGINE-013 — traceability (Phase 4)', () => {
  it('exposes the ordered decision path, all core stages present', () => {
    const path = traceExplanation(fullChain(snippetEvidence));
    expect(path.map((s) => s.stage)).toEqual([
      'evidence', 'validation', 'correlation', 'root_cause', 'recommendation', 'business_impact', 'commercial_roi', 'confidence', 'decision',
    ]);
    for (const st of ['evidence', 'correlation', 'root_cause', 'recommendation', 'business_impact']) {
      expect(path.find((s) => s.stage === st)!.present).toBe(true);
    }
  });

  it('every conclusion is traceable to a stage (no black box) + reproducible', () => {
    const ex = fullChain(snippetEvidence);
    const s = summarizeExplanation(ex);
    expect(s.fullyTraceable).toBe(true);
    // a correlation reason code traces back to the correlation stage
    const corrCode = ex.correlationRules[0];
    expect(traceReference(ex, corrCode)!.stage).toBe('correlation');
    // the decision id traces to the decision stage
    expect(traceReference(ex, 'authority:c1')!.stage).toBe('decision');
  });

  it('calculation provenance lists the stages that performed a calculation', () => {
    const ex = fullChain(snippetEvidence);
    expect(ex.calculationProvenance).toEqual(expect.arrayContaining(['correlation', 'root_cause', 'business_impact']));
  });
});

describe('BETA-ENGINE-013 — honest empties (backward compatible)', () => {
  it('no evidence → an honest, non-black-box explanation (stages present=false, not fabricated)', () => {
    const ex = buildExplanation({ decisionId: 'authority:c1' });
    expect(ex.evidenceUsed).toEqual([]);
    expect(ex.decisionPath.find((s) => s.stage === 'evidence')!.present).toBe(false);
    expect(ex.decisionPath.find((s) => s.stage === 'decision')!.present).toBe(true); // the decision still exists
    expect(summarizeExplanation(ex).fullyTraceable).toBe(false); // honest: no chain without evidence
  });
});
