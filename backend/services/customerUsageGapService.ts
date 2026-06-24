/**
 * customerUsageGapService.ts
 *
 * READ-ONLY analysis (Phase 16C) of why CUSTOMER-class companies do not progress through
 * CUSTOMER → ACTIVE → ADOPTED → EXECUTING → VALUE_REALIZED → REVENUE_GENERATING. CUSTOMER
 * population only (QA/TEST/INTERNAL excluded by the caller). Pure, deterministic, association
 * only — no causality, no recommendations, no actions.
 */

import type { ReadinessState } from './customerReadinessService';

export type Milestone = 'PROFILE' | 'DOMAIN' | 'GA' | 'GSC' | 'SOCIAL' | 'TEAM' | 'ACTIVATION' | 'EXECUTION' | 'VALUE' | 'REVENUE';
export type Segment = 'NEW' | 'ONBOARDING' | 'ADOPTING' | 'EXECUTING' | 'VALUE_REALIZING' | 'REVENUE_GENERATING' | 'STALLED';

export const MILESTONE_ORDER: Milestone[] = ['PROFILE', 'DOMAIN', 'GA', 'GSC', 'SOCIAL', 'TEAM', 'ACTIVATION', 'EXECUTION', 'VALUE', 'REVENUE'];

export interface CustomerJourney {
  company_id: string; company_name: string; created_at: string | null; tenant_status: string; active_30d: number; readiness_score: number;
  profile: ReadinessState; domain: ReadinessState; ga: ReadinessState; gsc: ReadinessState; social: ReadinessState; team: ReadinessState; billing: ReadinessState;
  execution_volume: number; execution_categories: string[]; revenue_count: number;
}

const met = (c: CustomerJourney, m: Milestone): boolean => {
  switch (m) {
    case 'PROFILE': return c.profile === 'READY';
    case 'DOMAIN': return c.domain === 'READY';
    case 'GA': return c.ga === 'READY';
    case 'GSC': return c.gsc === 'READY';
    case 'SOCIAL': return c.social === 'READY';
    case 'TEAM': return c.team === 'READY';
    case 'ACTIVATION': return c.tenant_status === 'ACTIVE';
    case 'EXECUTION': return c.execution_volume > 0;
    case 'VALUE': return c.execution_categories.length >= 1;
    case 'REVENUE': return c.revenue_count > 0;
  }
};

/** Pure: first unmet milestone (in journey order), or null if fully progressed. */
export function firstFailure(c: CustomerJourney): Milestone | null {
  return MILESTONE_ORDER.find((m) => !met(c, m)) ?? null;
}

const olderThanDays = (iso: string | null, days: number, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 86_400_000 > days : false);

/** Pure: deterministic journey segment. */
export function segmentOf(c: CustomerJourney, nowMs: number): Segment {
  if (met(c, 'REVENUE')) return 'REVENUE_GENERATING';
  if (met(c, 'VALUE') && c.tenant_status === 'ACTIVE') return 'VALUE_REALIZING';
  if (met(c, 'EXECUTION')) return 'EXECUTING';
  if (c.tenant_status === 'DORMANT' || c.tenant_status === 'INACTIVE') return 'STALLED';
  if (c.tenant_status === 'ACTIVE') return 'ADOPTING';
  if (!olderThanDays(c.created_at, 14, nowMs)) return 'NEW';
  return 'ONBOARDING';
}

export interface UsageGapResult {
  baseline: { customer_count: number; active_count: number; adopted_count: number; executing_count: number; value_count: number; revenue_count: number };
  journeys: Array<CustomerJourney & { first_failure: Milestone | null; segment: Segment }>;
  first_failure_frequency: Array<{ milestone: Milestone; count: number }>;
  earliest_failure: Milestone | null;
  segments: Record<Segment, string[]>;
  milestone_completion: Array<{ milestone: Milestone; met: number; missing: number; missing_pct: number | null }>;
  execution_gap: Array<{ category: string; have: number; missing: number }>;
  value_gap: Array<{ dimension: string; value_rate: number | null; no_value_rate: number | null; delta: number | null }>;
  revenue_gap: { value_without_revenue: number; execution_without_revenue: number; activation_without_revenue: number; what_exists_before_revenue: string };
  bottleneck_hierarchy: Array<{ milestone: Milestone; affected_customers: number; journey_position: number; rank_reason: string }>;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const EXEC_CATEGORIES = ['CONTENT', 'CAMPAIGN', 'PUBLISHING', 'MARKET_PULSE', 'REPORTS'];

/** Pure: full customer usage-gap analysis (CUSTOMER population only). */
export function analyzeCustomerUsageGap(customers: CustomerJourney[], nowMs: number): UsageGapResult {
  const j = customers.map((c) => ({ ...c, first_failure: firstFailure(c), segment: segmentOf(c, nowMs) }));
  const n = customers.length;

  const ffFreq = new Map<Milestone, number>();
  for (const c of j) if (c.first_failure) ffFreq.set(c.first_failure, (ffFreq.get(c.first_failure) ?? 0) + 1);
  const first_failure_frequency = Array.from(ffFreq.entries()).map(([milestone, count]) => ({ milestone, count })).sort((a, b) => b.count - a.count || MILESTONE_ORDER.indexOf(a.milestone) - MILESTONE_ORDER.indexOf(b.milestone));
  const earliest_failure = j.map((c) => c.first_failure).filter((m): m is Milestone => m != null).sort((a, b) => MILESTONE_ORDER.indexOf(a) - MILESTONE_ORDER.indexOf(b))[0] ?? null;

  const SEGS: Segment[] = ['NEW', 'ONBOARDING', 'ADOPTING', 'EXECUTING', 'VALUE_REALIZING', 'REVENUE_GENERATING', 'STALLED'];
  const segments = Object.fromEntries(SEGS.map((s) => [s, j.filter((c) => c.segment === s).map((c) => c.company_name)])) as Record<Segment, string[]>;

  const milestone_completion = MILESTONE_ORDER.map((m) => { const metN = j.filter((c) => met(c, m)).length; return { milestone: m, met: metN, missing: n - metN, missing_pct: pct(n - metN, n) }; });

  const execution_gap = EXEC_CATEGORIES.map((category) => { const have = j.filter((c) => c.execution_categories.includes(category)).length; return { category, have, missing: n - have }; }).sort((a, b) => b.missing - a.missing || a.category.localeCompare(b.category));

  // Value gap: customers with value vs without, presence rate per dimension (association only).
  const withV = j.filter((c) => met(c, 'VALUE'));
  const withoutV = j.filter((c) => !met(c, 'VALUE'));
  const DIMS: Array<[string, (c: CustomerJourney) => boolean]> = [['profile', (c) => c.profile === 'READY'], ['domain', (c) => c.domain === 'READY'], ['social', (c) => c.social === 'READY'], ['team', (c) => c.team === 'READY'], ['activation', (c) => c.tenant_status === 'ACTIVE'], ['execution', (c) => c.execution_volume > 0]];
  const value_gap = DIMS.map(([dimension, pred]) => { const vr = pct(withV.filter(pred).length, withV.length), nr = pct(withoutV.filter(pred).length, withoutV.length); return { dimension, value_rate: vr, no_value_rate: nr, delta: vr != null && nr != null ? Math.round((vr - nr) * 10) / 10 : null }; }).sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));

  const revenue_gap = {
    value_without_revenue: j.filter((c) => met(c, 'VALUE') && !met(c, 'REVENUE')).length,
    execution_without_revenue: j.filter((c) => met(c, 'EXECUTION') && !met(c, 'REVENUE')).length,
    activation_without_revenue: j.filter((c) => met(c, 'ACTIVATION') && !met(c, 'REVENUE')).length,
    what_exists_before_revenue: 'billing, activation, profile, execution and value all occur in customers with no recorded revenue — the value→revenue link is unobserved across the customer base',
  };

  const bottleneck_hierarchy = MILESTONE_ORDER.map((m, idx) => ({ milestone: m, affected_customers: n - j.filter((c) => met(c, m)).length, journey_position: idx, rank_reason: 'ranked by affected customers, then earliest journey position' }))
    .filter((b) => b.affected_customers > 0)
    .sort((a, b) => b.affected_customers - a.affected_customers || a.journey_position - b.journey_position);

  return {
    baseline: {
      customer_count: n,
      active_count: j.filter((c) => c.tenant_status === 'ACTIVE').length,
      adopted_count: j.filter((c) => MILESTONE_ORDER.slice(0, 6).some((m) => met(c, m))).length,
      executing_count: j.filter((c) => met(c, 'EXECUTION')).length,
      value_count: withV.length,
      revenue_count: j.filter((c) => met(c, 'REVENUE')).length,
    },
    journeys: j, first_failure_frequency, earliest_failure, segments, milestone_completion, execution_gap, value_gap, revenue_gap, bottleneck_hierarchy,
  };
}
