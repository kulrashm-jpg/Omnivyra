/**
 * BETA-ENGINE-009 — Cross-Evidence Intelligence & Correlation Engine.
 *
 * Verifies deterministic cross-evidence relationships (agreement / contradiction / dependency /
 * reinforcement / support / missing), the rule registry metadata, the correlation summary + bounded
 * confidence delta, and that correlations genuinely move decision confidence (reinforcement up,
 * contradiction down) — no AI, no probability. Deterministic; no DB; no network.
 */
import {
  correlateEvidence, correlateForConsumer, summarizeCorrelations, correlationCoverageDelta,
  CORRELATION_RULES, rulesForConsumer, deriveDecisionConfidence, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';

function m(key: string, value: number, unit: string): Evidence {
  return createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });
}
const find = (cs: ReturnType<typeof correlateEvidence>, id: string) => cs.find((c) => c.ruleId === id)!;

describe('BETA-ENGINE-009 — rule registry (Phase 3)', () => {
  it('every rule declares full metadata', () => {
    for (const r of CORRELATION_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.participatingMeasurements.length).toBeGreaterThan(0);
      expect(r.requiredMeasurements.length).toBeGreaterThan(0);
      expect(r.decisionConsumers.length).toBeGreaterThan(0);
      expect(r.rationale.why).toBeTruthy();
      expect(r.rationale.prevents).toBeTruthy();
    }
    expect(CORRELATION_RULES.length).toBe(6);
    expect(rulesForConsumer('authority').length).toBeGreaterThan(0);
    expect(rulesForConsumer('trust').length).toBeGreaterThan(0);
  });
});

describe('BETA-ENGINE-009 — deterministic relationships (Phase 2)', () => {
  it('CONTRADICTION: high impressions + low CTR', () => {
    const cs = correlateEvidence([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')]);
    const c = find(cs, 'search_visibility_ctr_contradiction');
    expect(c.relationshipType).toBe('contradiction');
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.contradictions).toContain('ctr');
  });

  it('DEPENDENCY: weak authority gates weak rankings', () => {
    const cs = correlateEvidence([m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')]);
    const c = find(cs, 'authority_ranking_dependency');
    expect(c.relationshipType).toBe('dependency');
    expect(c.dependencies).toContain('domain_authority');
  });

  it('REINFORCEMENT: entity present + AI answers cite it', () => {
    const cs = correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.8, 'ratio')]);
    const c = find(cs, 'entity_ai_reinforcement');
    expect(c.relationshipType).toBe('reinforcement');
    expect(c.confidence).toBeGreaterThan(0);
  });

  it('CONTRADICTION: entity present but AI does not retrieve (AEO gap)', () => {
    const cs = correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.05, 'ratio')]);
    const c = find(cs, 'entity_present_ai_gap');
    expect(c.relationshipType).toBe('contradiction');
    expect(c.contradictions).toContain('ai_answer_presence');
  });

  it('STRONG vs WEAK support: reviews base', () => {
    const strong = find(correlateEvidence([m('review_count', 300, 'count'), m('avg_rating', 4.6, 'rating_0_5')]), 'reviews_brand_support');
    expect(strong.relationshipType).toBe('strong_support');
    const weak = find(correlateEvidence([m('review_count', 4, 'count'), m('avg_rating', 4.9, 'rating_0_5')]), 'reviews_brand_support');
    expect(weak.relationshipType).toBe('weak_support');
    expect(weak.contradictions).toContain('review_count');
  });

  it('REINFORCEMENT: strong backlinks + strong impressions', () => {
    const c = find(correlateEvidence([m('referring_domains', 120, 'count'), m('impressions', 8000, 'count')]), 'backlinks_search_reinforcement');
    expect(c.relationshipType).toBe('reinforcement');
  });

  it('MISSING_SUPPORTING_EVIDENCE: required measurement absent → never fabricated', () => {
    const cs = correlateEvidence([m('impressions', 5000, 'count')]); // no ctr
    const c = find(cs, 'search_visibility_ctr_contradiction');
    expect(c.relationshipType).toBe('missing_supporting_evidence');
    expect(c.missingMeasurements).toContain('ctr');
    expect(c.confidence).toBe(0);
  });

  it('resolves provider-agnostic aliases (Bing search keys)', () => {
    const cs = correlateEvidence([m('bing_impressions', 5000, 'count'), m('bing_ctr', 0.005, 'ratio')]);
    const c = find(cs, 'search_visibility_ctr_contradiction');
    expect(c.relationshipType).toBe('contradiction'); // bing_* mapped to logical impressions/ctr
  });

  it('is deterministic', () => {
    const input = [m('review_count', 300, 'count'), m('avg_rating', 4.6, 'rating_0_5')];
    expect(correlateEvidence(input)).toEqual(correlateEvidence(input));
  });
});

describe('BETA-ENGINE-009 — summary + bounded delta (Phase 5)', () => {
  it('summarizes reinforcements / contradictions / missing and bounds the delta', () => {
    const cs = correlateEvidence([
      m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.8, 'ratio'), // reinforcement
      m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), // contradiction
    ]);
    const s = summarizeCorrelations(cs);
    expect(s.reinforcements).toBeGreaterThanOrEqual(1);
    expect(s.contradictions).toBeGreaterThanOrEqual(1);
    const d = correlationCoverageDelta(s);
    expect(d).toBeGreaterThanOrEqual(-0.15);
    expect(d).toBeLessThanOrEqual(0.15);
  });

  it('reinforcement-only → positive delta; contradiction-only → negative delta', () => {
    const reinforce = summarizeCorrelations(correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio')]));
    expect(correlationCoverageDelta(reinforce)).toBeGreaterThan(0);
    const contradict = summarizeCorrelations(correlateEvidence([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.02, 'ratio')]));
    expect(correlationCoverageDelta(contradict)).toBeLessThan(0);
  });
});

describe('BETA-ENGINE-009 — decision adoption: correlations move confidence (Phase 5)', () => {
  // Mirror the engine's evidence-aware coverage adjustment.
  function trustConfWith(correlations: Evidence[]) {
    const summary = summarizeCorrelations(correlateForConsumer('trust', correlations));
    const delta = correlationCoverageDelta(summary);
    return deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 200, coverage: Math.max(0, Math.min(1, 0.5 + delta)), providerReliability: 0.85, dataPresent: true });
  }
  it('a reinforcing correlation yields higher confidence than a contradicting one', () => {
    const reinforced = trustConfWith([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.9, 'ratio'), m('review_count', 300, 'count'), m('avg_rating', 4.6, 'rating_0_5')]);
    const contradicted = trustConfWith([m('knowledge_graph_presence', 1, 'boolean'), m('ai_answer_presence', 0.02, 'ratio')]);
    expect(reinforced.confidenceScore).toBeGreaterThan(contradicted.confidenceScore);
  });
});
