/**
 * BETA-ENGINE-011 — Recommendation Intelligence & Execution Planning.
 *
 * Verifies that validated Root Causes become deterministic, prioritized, executable ExecutionPlans:
 * every plan has steps + validation + success criteria; priority is derived (never hardcoded); each root
 * cause maps to the right action type; recommendations originate ONLY from root causes; end-to-end
 * evidence → correlation → root cause → execution plan. Deterministic; no DB; no network; no AI.
 */
import {
  correlateEvidence, diagnoseRootCauses, diagnoseForConsumer,
  generateRecommendations, generateRecommendationsForConsumer, computePriority, summarizeRecommendations,
  RECOMMENDATION_RULES, recommendationRulesForRootCause, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });
const plansFor = (evidence: Evidence[]) => generateRecommendations(diagnoseRootCauses(correlateEvidence(evidence)));

describe('BETA-ENGINE-011 — recommendation registry (Phase 3)', () => {
  it('every rule declares full metadata (steps, validation, outcome, rationale)', () => {
    for (const r of RECOMMENDATION_RULES) {
      expect(r.supportedRootCauses.length).toBeGreaterThan(0);
      expect(r.requiredEvidence.length).toBeGreaterThan(0);
      expect(r.executionSteps.length).toBeGreaterThan(0);
      expect(r.validationSteps.length).toBeGreaterThan(0);
      expect(r.successCriteria.length).toBeGreaterThan(0);
      expect(r.rationale.rootCause).toBeTruthy();
      expect(r.rationale.replaces).toBeTruthy();
    }
    expect(RECOMMENDATION_RULES.length).toBe(6);
    // all 6 action types are represented
    const types = new Set(RECOMMENDATION_RULES.map((r) => r.actionType));
    expect(types).toEqual(new Set(['corrective', 'preventive', 'optimization', 'monitoring', 'dependency', 'validation']));
  });
});

describe('BETA-ENGINE-011 — execution plans from root causes (Phase 2/4)', () => {
  it('Authority Deficit → dependency plan with steps, validation, success criteria, provenance', () => {
    const plan = plansFor([m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')])
      .find((p) => p.ruleId === 'rec_close_authority_gap')!;
    expect(plan).toBeDefined();
    expect(plan.actionType).toBe('dependency');
    expect(plan.executionSteps.length).toBeGreaterThan(0);
    expect(plan.validationSteps.length).toBeGreaterThan(0);
    expect(plan.successCriteria.length).toBeGreaterThan(0);
    expect(plan.supportingRootCauses).toContain('authority_deficit');
    expect(plan.supportingEvidence).toContain('domain_authority');
    expect(plan.replaces).toMatch(/Improve SEO/i);
    expect(plan.confidence).toBeGreaterThan(0);
  });

  it('Snippet Quality → optimization; AI gap → corrective; thin reviews → preventive', () => {
    expect(plansFor([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')]).find((p) => p.ruleId === 'rec_fix_search_snippet')!.actionType).toBe('optimization');
    expect(plansFor([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')]).find((p) => p.ruleId === 'rec_close_ai_gap')!.actionType).toBe('corrective');
    expect(plansFor([m('review_count', 4, 'count'), m('avg_rating', 4.9, 'rating_0_5')]).find((p) => p.ruleId === 'rec_grow_review_base')!.actionType).toBe('preventive');
  });

  it('recommendations originate ONLY from root causes — no causes → no plans', () => {
    expect(generateRecommendations([])).toEqual([]);
    expect(plansFor([m('domain_authority', 15, 'score_0_100')])).toEqual([]); // missing avg_position → no diagnosis → no plan
  });
});

describe('BETA-ENGINE-011 — deterministic prioritization (Phase 5)', () => {
  it('priority is derived (blocking + high severity + high impact ranks above low-impact monitoring)', () => {
    const rule = RECOMMENDATION_RULES.find((r) => r.id === 'rec_close_authority_gap')!;
    const highSev = computePriority(rule, { causeId: 'authority_deficit', severity: 90, confidence: 0.9 } as any);
    const lowSev = computePriority(rule, { causeId: 'authority_deficit', severity: 20, confidence: 0.3 } as any);
    expect(highSev).toBeGreaterThan(lowSev);

    const monitorRule = RECOMMENDATION_RULES.find((r) => r.id === 'rec_monitor_entity_strength')!;
    const monitorP = computePriority(monitorRule, { causeId: 'entity_authority_strength', severity: 0, confidence: 0.8 } as any);
    expect(highSev).toBeGreaterThan(monitorP); // blocking high-severity outranks low-impact monitoring
  });

  it('plans are sorted by priority (desc) and deterministic', () => {
    const evidence = [
      m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'), // authority deficit (blocking, high)
      m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio'), // strength (monitoring, low)
    ];
    const plans = plansFor(evidence);
    for (let i = 1; i < plans.length; i++) expect(plans[i - 1].priority).toBeGreaterThanOrEqual(plans[i].priority);
    expect(plansFor(evidence)).toEqual(plans); // deterministic
  });
});

describe('BETA-ENGINE-011 — consumer scoping + end-to-end (Phase 6)', () => {
  it('end-to-end: evidence → correlation → root cause → execution plan (trust)', () => {
    const evidence = [m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')];
    const causes = diagnoseForConsumer('trust', correlateEvidence(evidence));
    const plans = generateRecommendationsForConsumer('trust', causes);
    const aiPlan = plans.find((p) => p.ruleId === 'rec_close_ai_gap')!;
    expect(aiPlan).toBeDefined();
    expect(aiPlan.decisionConsumers).toContain('trust');
    const summary = summarizeRecommendations(plans);
    expect(summary.count).toBe(plans.length);
    expect(summary.plans[0]).toHaveProperty('priority');
  });
});
