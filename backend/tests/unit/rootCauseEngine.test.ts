/**
 * BETA-ENGINE-010 — Executive Decision Intelligence & Root Cause Engine.
 *
 * Verifies deterministic root-cause diagnosis over correlated evidence: symptom-clusters become named
 * causes (Authority Deficit, Search Snippet Quality, AI Optimization Gap, Thin Trust Base), positive
 * findings become resolved causes, contradictory correlations become conflicting causes, and absent
 * evidence becomes a missing cause (never a fabricated diagnosis). End-to-end: evidence → correlation →
 * root cause. Deterministic; no DB; no network; no AI.
 */
import {
  correlateEvidence, diagnoseRootCauses, diagnoseForConsumer, summarizeRootCauses,
  ROOT_CAUSE_RULES, rootCauseRulesForConsumer, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });
const diagnose = (evidence: Evidence[]) => diagnoseRootCauses(correlateEvidence(evidence));
const findCause = (evidence: Evidence[], id: string) => diagnose(evidence).find((c) => c.causeId === id);

describe('BETA-ENGINE-010 — root cause registry (Phase 3)', () => {
  it('every rule declares full metadata', () => {
    for (const r of ROOT_CAUSE_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.requiredCorrelations.length).toBeGreaterThan(0);
      expect(r.decisionConsumers.length).toBeGreaterThan(0);
      expect(r.rationale.why).toBeTruthy();
      expect(r.rationale.prevents).toBeTruthy();
    }
    expect(ROOT_CAUSE_RULES.length).toBe(6);
    expect(rootCauseRulesForConsumer('authority').length).toBeGreaterThan(0);
    expect(rootCauseRulesForConsumer('trust').length).toBeGreaterThan(0);
  });
});

describe('BETA-ENGINE-010 — deterministic diagnoses (Phase 2)', () => {
  it('Authority Deficit (blocking) from weak authority + weak rankings', () => {
    const c = findCause([m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')], 'authority_deficit');
    expect(c).toBeDefined();
    expect(c!.causeType).toBe('blocking_cause');
    expect(c!.title).toBe('Authority Deficit');
    expect(c!.severity).toBeGreaterThan(0);
    expect(c!.blockingDependencies).toContain('domain_authority');
    expect(c!.confidence).toBeGreaterThan(0);
  });

  it('Search Snippet Quality (primary) from high impressions + low CTR', () => {
    const c = findCause([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')], 'search_snippet_quality');
    expect(c!.causeType).toBe('primary_cause');
    expect(c!.title).toBe('Search Snippet Quality');
    expect(c!.reasonCodes).toContain('RC_SNIPPET_QUALITY');
  });

  it('AI Optimization Gap (primary) from entity present + weak AI retrieval', () => {
    const c = findCause([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')], 'ai_optimization_gap');
    expect(c!.causeType).toBe('primary_cause');
    expect(c!.title).toBe('AI Optimization Gap');
  });

  it('Thin Trust Base (contributing) from high rating on few reviews', () => {
    const c = findCause([m('review_count', 4, 'count'), m('avg_rating', 4.9, 'rating_0_5')], 'thin_trust_base');
    expect(c!.causeType).toBe('contributing_cause');
    expect(c!.title).toBe('Thin Trust Base');
  });

  it('Entity/AI strength → resolved cause (not a gap to fix)', () => {
    const c = findCause([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio')], 'entity_authority_strength');
    expect(c!.causeType).toBe('resolved_cause');
    expect(c!.severity).toBe(0);
  });

  it('never fabricates: absent evidence → a missing cause, not a diagnosis', () => {
    const causes = diagnose([m('domain_authority', 15, 'score_0_100')]); // avg_position missing → dependency cannot assert
    expect(causes.some((c) => c.causeType === 'blocking_cause')).toBe(false);
    expect(causes.some((c) => c.causeType === 'missing_cause')).toBe(true);
    const missing = causes.find((c) => c.causeType === 'missing_cause')!;
    expect(missing.reasonCodes).toContain('RC_MISSING_DIAGNOSTIC_EVIDENCE');
  });

  it('conflicting correlations → conflicting cause (no false-confidence diagnosis)', () => {
    // Construct evidence that asserts BOTH entity_ai_reinforcement and entity_present_ai_gap is impossible
    // from one ai_answer_presence value; instead feed both correlations directly to the engine.
    const reinforcement = correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio')]).find((c) => c.ruleId === 'entity_ai_reinforcement')!;
    const gap = correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')]).find((c) => c.ruleId === 'entity_present_ai_gap')!;
    const causes = diagnoseRootCauses([reinforcement, gap]);
    expect(causes.some((c) => c.causeType === 'conflicting_cause')).toBe(true);
  });

  it('orders blocking/primary before resolved; is deterministic', () => {
    const evidence = [
      m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'), // authority deficit (blocking)
      m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio'), // strength (resolved)
    ];
    const causes = diagnose(evidence);
    expect(causes[0].causeType).toBe('blocking_cause'); // blocking first
    expect(diagnose(evidence)).toEqual(causes); // deterministic
  });
});

describe('BETA-ENGINE-010 — consumer scoping + summary (Phase 5)', () => {
  it('diagnoses per consumer and summarizes actionable causes', () => {
    const correlations = correlateEvidence([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')]);
    const trustCauses = diagnoseForConsumer('trust', correlations);
    expect(trustCauses.some((c) => c.causeId === 'ai_optimization_gap')).toBe(true);
    const summary = summarizeRootCauses(trustCauses);
    expect(summary.primary).toBeGreaterThanOrEqual(1);
    expect(summary.diagnoses.some((d) => d.title === 'AI Optimization Gap')).toBe(true);
    expect(summary.reasonCodes).toContain('RC_AI_OPTIMIZATION_GAP');
  });

  it('no correlations at all → empty diagnosis (backward compatible)', () => {
    expect(diagnoseRootCauses([])).toEqual([]);
    expect(summarizeRootCauses([]).diagnoses).toEqual([]);
  });
});
