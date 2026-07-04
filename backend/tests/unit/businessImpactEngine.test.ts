/**
 * BETA-ENGINE-012 — Business Impact, Opportunity & ROI Intelligence.
 *
 * Verifies that execution plans become deterministic, business-prioritized initiatives; opportunity is
 * quantified in NATIVE units only where a deterministic formula exists; ROI is classified honestly
 * (measured / estimated / not_determinable) and NEVER a fabricated revenue figure; executive priority is
 * derived (not hardcoded); end-to-end evidence → … → business impact. Deterministic; no DB; no AI.
 */
import {
  correlateEvidence, diagnoseRootCauses, diagnoseForConsumer, generateRecommendations, generateRecommendationsForConsumer,
  assessBusinessImpact, assessBusinessImpactForConsumer, computeBusinessPriority, summarizeBusinessImpact,
  BUSINESS_RULES, ACHIEVABLE_CTR_BENCHMARK, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });

function impactsFor(evidence: Evidence[]) {
  const correlations = correlateEvidence(evidence);
  const causes = diagnoseRootCauses(correlations);
  const plans = generateRecommendations(causes);
  return assessBusinessImpact(plans, causes, evidence);
}
const findImpact = (evidence: Evidence[], ruleId: string) => impactsFor(evidence).find((i) => i.ruleId === ruleId);

describe('BETA-ENGINE-012 — business rule registry (Phase 3)', () => {
  it('every rule declares full metadata + honest ROI rationale', () => {
    for (const r of BUSINESS_RULES) {
      expect(r.supportedRootCauses.length).toBeGreaterThan(0);
      expect(r.supportedPlans.length).toBeGreaterThan(0);
      expect(r.requiredEvidence.length).toBeGreaterThan(0);
      expect(r.rationale.roi).toBeTruthy();
      expect(r.rationale.prevents).toBeTruthy();
    }
    expect(BUSINESS_RULES.length).toBe(6);
  });
});

describe('BETA-ENGINE-012 — honest ROI (never fabricated revenue) (Phase 4)', () => {
  it('Snippet opportunity is ESTIMATED in additional CLICKS (never dollars)', () => {
    const i = findImpact([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')], 'biz_search_snippet')!;
    expect(i.roi.status).toBe('estimated');
    expect(i.roi.quantified).not.toBeNull();
    expect(i.roi.quantified!.unit).toBe('additional_clicks_per_period');
    // additional clicks = 5000 × (0.05 − 0.005) = 225 — deterministic, in clicks, not revenue
    expect(i.roi.quantified!.value).toBe(Math.round(5000 * (ACHIEVABLE_CTR_BENCHMARK - 0.005)));
    // no fabricated currency figure (unit is clicks; no $ / dollar amounts)
    expect(i.roi.quantified!.unit).not.toMatch(/usd|dollar|currency|\$/i);
    expect(JSON.stringify(i.roi)).not.toMatch(/\$\d|\d+\s*(usd|dollars)/i);
  });

  it('Thin-trust opportunity is ESTIMATED in additional REVIEWS (not revenue)', () => {
    const i = findImpact([m('review_count', 4, 'count'), m('avg_rating', 4.9, 'rating_0_5')], 'biz_thin_trust')!;
    expect(i.roi.status).toBe('estimated');
    expect(i.roi.quantified!.unit).toBe('additional_reviews_to_robust_base');
    expect(i.roi.quantified!.value).toBe(46); // 50 - 4
  });

  it('Authority + AI-gap ROI is NOT_DETERMINABLE (no revenue-per-position/citation evidence)', () => {
    const auth = findImpact([m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')], 'biz_authority_deficit')!;
    expect(auth.roi.status).toBe('not_determinable');
    expect(auth.roi.quantified).toBeNull();
    const ai = findImpact([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')], 'biz_ai_gap')!;
    expect(ai.roi.status).toBe('not_determinable');
  });

  it('no business rule ever returns status "measured" (no revenue evidence exists in the platform)', () => {
    const all = impactsFor([
      m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'),
      m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'),
      m('review_count', 4, 'count'), m('avg_rating', 4.9, 'rating_0_5'),
      m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio'),
    ]);
    expect(all.every((i) => i.roi.status !== 'measured')).toBe(true);
  });
});

describe('BETA-ENGINE-012 — deterministic executive prioritization (Phase 5)', () => {
  it('priority is derived (high value + opportunity + dependency outranks low-value monitoring)', () => {
    const high = computeBusinessPriority({ businessImpact: 85, opportunitySize: 80, dependencyUnlock: 90, confidence: 0.9, riskReduction: 40, timeSensitivity: 60, executionCost: 70, executionComplexity: 70 });
    const low = computeBusinessPriority({ businessImpact: 15, opportunitySize: 5, dependencyUnlock: 5, confidence: 0.8, riskReduction: 10, timeSensitivity: 15, executionCost: 10, executionComplexity: 10 });
    expect(high).toBeGreaterThan(low);
  });

  it('initiatives are business-ordered (desc) and deterministic', () => {
    const evidence = [
      m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'), // authority (high biz value)
      m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio'), // strength (low value monitoring)
    ];
    const impacts = impactsFor(evidence);
    for (let k = 1; k < impacts.length; k++) expect(impacts[k - 1].businessPriority).toBeGreaterThanOrEqual(impacts[k].businessPriority);
    expect(impactsFor(evidence)).toEqual(impacts); // deterministic
  });
});

describe('BETA-ENGINE-012 — adoption + end-to-end (Phase 6)', () => {
  it('originates only from execution plans (no plans → no initiatives)', () => {
    expect(assessBusinessImpact([], [], [])).toEqual([]);
    expect(impactsFor([m('domain_authority', 15, 'score_0_100')])).toEqual([]); // missing avg_position → no cause → no plan → no impact
  });

  it('end-to-end: evidence → correlation → root cause → plan → business impact (seo/authority)', () => {
    const evidence = [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')];
    const causes = diagnoseForConsumer('seo', correlateEvidence(evidence));
    const plans = generateRecommendationsForConsumer('seo', causes);
    const impacts = assessBusinessImpactForConsumer('seo', plans, causes, evidence);
    const snippet = impacts.find((i) => i.ruleId === 'biz_search_snippet')!;
    expect(snippet).toBeDefined();
    expect(snippet.supportingExecutionPlans.length).toBeGreaterThan(0);
    const summary = summarizeBusinessImpact(impacts);
    expect(summary.roiEstimated).toBeGreaterThanOrEqual(1);
    expect(summary.initiatives[0]).toHaveProperty('businessPriority');
  });
});
