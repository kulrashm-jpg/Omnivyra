/**
 * Phase 16C — Customer Usage Gap tests (pure, deterministic). CUSTOMER population only.
 */

import {
  firstFailure,
  segmentOf,
  analyzeCustomerUsageGap,
  MILESTONE_ORDER,
  type CustomerJourney,
} from '../../services/customerUsageGapService';
import type { ReadinessState } from '../../services/customerReadinessService';

const NOW = Date.parse('2026-06-24T00:00:00Z');
const cj = (over: Partial<CustomerJourney> = {}): CustomerJourney => ({
  company_id: 'c1', company_name: 'Acme', created_at: '2026-05-01T00:00:00Z', tenant_status: 'ACTIVE', active_30d: 1, readiness_score: 14,
  profile: 'NOT_READY' as ReadinessState, domain: 'NOT_READY', ga: 'NOT_READY', gsc: 'NOT_READY', social: 'NOT_READY', team: 'NOT_READY', billing: 'READY',
  execution_volume: 0, execution_categories: [], revenue_count: 0, ...over,
});

describe('firstFailure', () => {
  it('PROFILE when profile not ready (earliest milestone)', () => {
    expect(firstFailure(cj())).toBe('PROFILE');
  });
  it('DOMAIN when profile ready but domain not', () => {
    expect(firstFailure(cj({ profile: 'READY' }))).toBe('DOMAIN');
  });
  it('REVENUE when everything else met', () => {
    expect(firstFailure(cj({ profile: 'READY', domain: 'READY', ga: 'READY', gsc: 'READY', social: 'READY', team: 'READY', execution_volume: 5, execution_categories: ['CONTENT'] }))).toBe('REVENUE');
  });
  it('null when fully progressed', () => {
    expect(firstFailure(cj({ profile: 'READY', domain: 'READY', ga: 'READY', gsc: 'READY', social: 'READY', team: 'READY', execution_volume: 5, execution_categories: ['CONTENT'], revenue_count: 1 }))).toBeNull();
  });
});

describe('segmentOf', () => {
  it('VALUE_REALIZING: active with value', () => {
    expect(segmentOf(cj({ execution_volume: 17, execution_categories: ['CONTENT', 'CAMPAIGN'] }), NOW)).toBe('VALUE_REALIZING');
  });
  it('ADOPTING: active, no execution', () => {
    expect(segmentOf(cj(), NOW)).toBe('ADOPTING');
  });
  it('STALLED: dormant', () => {
    expect(segmentOf(cj({ tenant_status: 'DORMANT' }), NOW)).toBe('STALLED');
  });
});

describe('analyzeCustomerUsageGap — the live 5-customer shape', () => {
  const customers: CustomerJourney[] = [
    cj({ company_id: 'infitoo', company_name: 'Infitoo', tenant_status: 'ACTIVE' }),
    cj({ company_id: 'afrost', company_name: 'Afrost', tenant_status: 'ACTIVE' }),
    cj({ company_id: 'embro', company_name: 'Embrosales', tenant_status: 'DORMANT' }),
    cj({ company_id: 'unf', company_name: 'Unfinished', tenant_status: 'ACTIVE', profile: 'READY', social: 'READY', execution_volume: 17, execution_categories: ['CONTENT', 'CAMPAIGN', 'REPORTS'] }),
    cj({ company_id: 'drishiq', company_name: 'Drishiq', tenant_status: 'DORMANT', profile: 'READY' }),
  ];
  const r = analyzeCustomerUsageGap(customers, NOW);

  it('baseline: 5 customers, 1 value, 0 revenue', () => {
    expect(r.baseline.customer_count).toBe(5);
    expect(r.baseline.value_count).toBe(1);   // Unfinished
    expect(r.baseline.revenue_count).toBe(0);
    expect(r.baseline.executing_count).toBe(1);
  });
  it('first failure: PROFILE for 3, DOMAIN for 2; earliest = PROFILE', () => {
    const ff = Object.fromEntries(r.first_failure_frequency.map((x) => [x.milestone, x.count]));
    expect(ff.PROFILE).toBe(3);
    expect(ff.DOMAIN).toBe(2);
    expect(r.earliest_failure).toBe('PROFILE');
  });
  it('milestone completion: DOMAIN/GA/GSC/TEAM all 0/5 (100% missing)', () => {
    const by = Object.fromEntries(r.milestone_completion.map((m) => [m.milestone, m.missing_pct]));
    expect(by.DOMAIN).toBe(100);
    expect(by.GA).toBe(100);
    expect(by.GSC).toBe(100);
    expect(by.TEAM).toBe(100);
    expect(by.PROFILE).toBe(60); // 3/5 missing
  });
  it('segments', () => {
    expect(r.segments.VALUE_REALIZING).toEqual(['Unfinished']);
    expect([...r.segments.ADOPTING].sort()).toEqual(['Afrost', 'Infitoo']); // copy — don't mutate shared r
    expect([...r.segments.STALLED].sort()).toEqual(['Drishiq', 'Embrosales']);
    expect(r.segments.REVENUE_GENERATING).toEqual([]);
  });
  it('execution gap: all categories missing for ≥4 customers', () => {
    expect(r.execution_gap.every((g) => g.missing >= 4)).toBe(true);
    expect(r.execution_gap.find((g) => g.category === 'PUBLISHING')!.missing).toBe(5);
  });
  it('revenue gap: value/execution/activation all exist without revenue', () => {
    expect(r.revenue_gap.value_without_revenue).toBe(1);
    expect(r.revenue_gap.execution_without_revenue).toBe(1);
    expect(r.revenue_gap.activation_without_revenue).toBe(3); // 3 active
  });
  it('bottleneck hierarchy: most-affected first', () => {
    expect(r.bottleneck_hierarchy[0].affected_customers).toBe(5); // DOMAIN/GA/GSC/TEAM/etc tie at 5
    expect(r.bottleneck_hierarchy[0].journey_position).toBeLessThan(r.bottleneck_hierarchy[r.bottleneck_hierarchy.length - 1].journey_position + 100);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeCustomerUsageGap(customers, NOW))).toBe(JSON.stringify(r));
  });
});
