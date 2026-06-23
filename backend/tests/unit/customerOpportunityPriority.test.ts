/**
 * Phase 12E — Opportunity Prioritization Engine tests (pure, deterministic).
 */

import {
  computeCompanyPriority,
  prioritizeCustomers,
  PRIORITY_WEIGHTS,
} from '../../services/customerOpportunityPriorityService';
import type { CompanyReadiness } from '../../services/customerReadinessService';
import type { CompanyOpportunities, OpportunitySeverity } from '../../services/customerOpportunityService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const cr = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
  company_id: 'co_1', company_name: 'Acme', plan: 'Pro', user_count: 3, active_user_count_30d: 2,
  created_at: daysAgo(120), last_activity_at: daysAgo(5), tenant_status: 'ACTIVE',
  company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'READY', gsc_ready: 'READY',
  social_ready: 'READY', community_ready: 'UNKNOWN', team_ready: 'READY', billing_ready: 'READY',
  overall_readiness_score: 100, readiness_bucket: 'READY', missing_areas: [],
  ...over,
});

// Build explicit opportunities so score tests don't depend on detection internals.
const opps = (count: number, sev: OpportunitySeverity | null): CompanyOpportunities => ({
  company_id: 'co_1', company_name: 'Acme',
  opportunities: [], opportunity_count: count, highest_severity: sev,
});

describe('computeCompanyPriority — scoring', () => {
  it('0 opportunities → READ_ONLY, score 0', () => {
    const p = computeCompanyPriority(cr(), opps(0, null), NOW);
    expect(p.priority_tier).toBe('READ_ONLY');
    expect(p.priority_score).toBe(0);
  });

  it('paying + ACTIVE + HIGH-sev + PARTIAL + 2 opps → CRITICAL (exact)', () => {
    const p = computeCompanyPriority(cr({ billing_ready: 'READY', tenant_status: 'ACTIVE', readiness_bucket: 'PARTIAL' }), opps(2, 'HIGH'), NOW);
    // 20(pay) + 30(active) + 15(high) + 22(partial) + round(2/6*5)=2 + 0(age) = 89
    expect(p.factors).toEqual({ value: 20, engagement: 30, severity: 15, addressability: 22, opportunity_volume: 2, age_momentum: 0 });
    expect(p.priority_score).toBe(89);
    expect(p.priority_tier).toBe('CRITICAL');
  });

  it('free + DORMANT + HIGH-sev + AT_RISK + 5 opps → LOW, and below the paying case', () => {
    const p = computeCompanyPriority(cr({ billing_ready: 'NOT_READY', tenant_status: 'DORMANT', readiness_bucket: 'AT_RISK' }), opps(5, 'HIGH'), NOW);
    // 3 + 5 + 15 + 5 + round(5/6*5)=4 + 0 = 32
    expect(p.priority_score).toBe(32);
    expect(p.priority_tier).toBe('LOW');
  });

  it('INACTIVE engagement is 0 (churned tenants pulled down)', () => {
    const p = computeCompanyPriority(cr({ billing_ready: 'NOT_READY', tenant_status: 'INACTIVE', readiness_bucket: 'AT_RISK' }), opps(3, 'HIGH'), NOW);
    expect(p.factors.engagement).toBe(0);
  });

  it('PARTIAL addressability beats AT_RISK for an otherwise-identical tenant', () => {
    const partial = computeCompanyPriority(cr({ readiness_bucket: 'PARTIAL' }), opps(2, 'MEDIUM'), NOW);
    const atRisk = computeCompanyPriority(cr({ readiness_bucket: 'AT_RISK' }), opps(2, 'MEDIUM'), NOW);
    expect(partial.priority_score).toBeGreaterThan(atRisk.priority_score);
  });

  it('age momentum: a ≤30-day-old tenant gets the bonus', () => {
    const young = computeCompanyPriority(cr({ created_at: daysAgo(10) }), opps(1, 'LOW'), NOW);
    const old = computeCompanyPriority(cr({ created_at: daysAgo(200) }), opps(1, 'LOW'), NOW);
    expect(young.factors.age_momentum).toBe(PRIORITY_WEIGHTS.ageMomentum);
    expect(old.factors.age_momentum).toBe(0);
  });

  it('score is capped at 100', () => {
    const p = computeCompanyPriority(cr({ billing_ready: 'READY', tenant_status: 'ACTIVE', readiness_bucket: 'PARTIAL', created_at: daysAgo(1) }), opps(10, 'HIGH'), NOW);
    expect(p.priority_score).toBeLessThanOrEqual(100);
  });
});

describe('tier assignment boundaries', () => {
  it('maps representative scores to tiers', () => {
    // 20+30+15+22+1 = 88 → CRITICAL
    expect(computeCompanyPriority(cr({ billing_ready: 'READY', tenant_status: 'ACTIVE', readiness_bucket: 'PARTIAL' }), opps(1, 'HIGH'), NOW).priority_tier).toBe('CRITICAL');
    // 20+30+8+5+1 = 64 → HIGH
    expect(computeCompanyPriority(cr({ billing_ready: 'READY', tenant_status: 'ACTIVE', readiness_bucket: 'AT_RISK' }), opps(1, 'MEDIUM'), NOW).priority_tier).toBe('HIGH');
    // 3+5+8+0+1 = 17 → LOW
    expect(computeCompanyPriority(cr({ billing_ready: 'NOT_READY', tenant_status: 'DORMANT', readiness_bucket: 'READY' }), opps(1, 'MEDIUM'), NOW).priority_tier).toBe('LOW');
  });
});

describe('prioritizeCustomers — sorting, distribution, determinism', () => {
  const list: CompanyReadiness[] = [
    cr({ company_id: 'low', billing_ready: 'NOT_READY', tenant_status: 'INACTIVE', website_ready: 'NOT_READY', readiness_bucket: 'AT_RISK', overall_readiness_score: 20 }),
    cr({ company_id: 'crit', billing_ready: 'READY', tenant_status: 'ACTIVE', website_ready: 'NOT_READY', ga_ready: 'NOT_READY', readiness_bucket: 'PARTIAL', overall_readiness_score: 60 }),
    cr({ company_id: 'readonly' }), // fully ready, no opps
  ];

  it('ranks by priority_score desc', () => {
    const { ranked } = prioritizeCustomers(list, NOW);
    expect(ranked[0].company_id).toBe('crit');
    expect(ranked[ranked.length - 1].priority_tier).toBe('READ_ONLY');
    expect(ranked.map((r) => r.priority_score)).toEqual([...ranked.map((r) => r.priority_score)].sort((a, b) => b - a));
  });

  it('distribution sums to the input size', () => {
    const { ranked, distribution } = prioritizeCustomers(list, NOW);
    const sum = Object.values(distribution).reduce((a, b) => a + b, 0);
    expect(sum).toBe(ranked.length);
    expect(distribution.READ_ONLY).toBe(1);
  });

  it('is deterministic (same input + clock → identical output)', () => {
    expect(prioritizeCustomers(list, NOW)).toEqual(prioritizeCustomers(list, NOW));
  });

  it('ties broken by company_id ascending', () => {
    const ties = [cr({ company_id: 'b' }), cr({ company_id: 'a' })].map((c) => ({ ...c, website_ready: 'NOT_READY' as const, readiness_bucket: 'AT_RISK' as const }));
    const { ranked } = prioritizeCustomers(ties, NOW);
    expect(ranked.map((r) => r.company_id)).toEqual(['a', 'b']);
  });
});
