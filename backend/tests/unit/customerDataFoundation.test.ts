/**
 * Phase 15E — Customer Data Foundation tests (pure, deterministic). Evidence-only.
 */

import {
  computeFoundationScores,
  computeFoundationScore,
  computeMaturity,
  computeTelemetryReadiness,
  computeRecommendationReadiness,
  computeAutomationReadiness,
  calculateDataFoundation,
  type FoundationInput,
} from '../../services/customerDataFoundationService';

const fi = (over: Partial<FoundationInput> = {}): FoundationInput => ({
  population: { total: 38, customer: 5, qa: 24, test: 8, internal: 1, unknown: 0 },
  telemetry_coverage_pct: 70,
  confidence: { high: 60, medium: 146, low: 60, unknown: 38 },
  revenue: { coverage_pct: 2.6, customer_revenue_count: 0, mrr_known: false },
  value_coverage_pct: 10.5,
  joinability: { joinable: 7, total: 11 },
  ...over,
});

describe('computeFoundationScores', () => {
  it('derives the five scores deterministically', () => {
    const s = computeFoundationScores(fi());
    expect(s.customer_integrity_score).toBe(13.2); // 5/38
    expect(s.telemetry_score).toBe(70);
    expect(s.joinability_score).toBe(63.6);        // 7/11
    expect(s.coverage_score).toBe(6.6);            // (2.6 + 10.5)/2
    expect(s.confidence_score).toBeGreaterThan(0);
  });
});

describe('maturity', () => {
  it('low foundation + low integrity → capped at LEVEL_1 (visibility only)', () => {
    const s = computeFoundationScores(fi());
    const f = computeFoundationScore(s);
    expect(computeMaturity(f, s)).toBe('LEVEL_1'); // integrity 13.2 caps it
  });
  it('high scores → LEVEL_4', () => {
    const s = { customer_integrity_score: 90, telemetry_score: 90, confidence_score: 90, joinability_score: 90, coverage_score: 90 };
    expect(computeMaturity(computeFoundationScore(s), s)).toBe('LEVEL_4');
  });
  it('LEVEL_0 when foundation < 20', () => {
    const s = { customer_integrity_score: 5, telemetry_score: 5, confidence_score: 5, joinability_score: 5, coverage_score: 5 };
    expect(computeMaturity(computeFoundationScore(s), s)).toBe('LEVEL_0');
  });
  it('integrity cap: high foundation but integrity < 20 → LEVEL_1', () => {
    const s = { customer_integrity_score: 15, telemetry_score: 95, confidence_score: 95, joinability_score: 95, coverage_score: 95 };
    expect(computeMaturity(computeFoundationScore(s), s)).toBe('LEVEL_1');
  });
});

describe('telemetry readiness', () => {
  it('UNOBSERVABLE excluded; UNKNOWN counts 0', () => {
    const t = computeTelemetryReadiness();
    expect(t.journeys.length).toBe(8);
    expect(t.telemetry_readiness_score).toBeGreaterThan(0);
    expect(t.telemetry_readiness_score).toBeLessThan(100);
  });
});

describe('readiness gating', () => {
  it('recommendation: low integrity/confidence → NOT_READY; monetization NOT_READY when revenue UNKNOWN', () => {
    const s = computeFoundationScores(fi());
    const r = computeRecommendationReadiness(s, false);
    expect(r.find((x) => x.category === 'customer_recommendations')!.readiness).toBe('NOT_READY');
    const mon = r.find((x) => x.category === 'monetization_actions')!;
    expect(mon.readiness).toBe('NOT_READY');
    expect(mon.limiting_factor).toMatch(/revenue UNKNOWN/);
  });
  it('automation: integrity < 50 → all NOT_READY (hard bar)', () => {
    const s = computeFoundationScores(fi());
    const a = computeAutomationReadiness(s, 50);
    expect(a.every((x) => x.readiness === 'NOT_READY')).toBe(true);
    expect(a[0].limiting_factor).toMatch(/integrity < 50/);
  });
  it('automation: high integrity + scores → READY', () => {
    const s = { customer_integrity_score: 80, telemetry_score: 80, confidence_score: 80, joinability_score: 80, coverage_score: 80 };
    expect(computeAutomationReadiness(s, 85).every((x) => x.readiness === 'READY')).toBe(true);
  });
});

describe('calculateDataFoundation — answers', () => {
  const r = calculateDataFoundation(fi());
  it('answers the four executive questions from evidence', () => {
    expect(r.answers.dataset_trustworthy).toMatch(/^NO/);
    expect(r.answers.recommendation_safe).toMatch(/^NO/);
    expect(r.answers.automation_safe).toMatch(/^NO/);
    expect(r.answers.maturity).toMatch(/LEVEL_1/);
    expect(r.population.contamination_pct).toBe(86.8);
  });
  it('deterministic', () => {
    expect(JSON.stringify(calculateDataFoundation(fi()))).toBe(JSON.stringify(r));
  });
});
