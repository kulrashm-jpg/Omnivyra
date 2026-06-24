/**
 * Phase 15A — Customer Intervention Governance tests (pure, deterministic). Governance only.
 */

import {
  calculateCustomerState,
  calculateInterventionEligibility,
  simulateInterventionPortfolio,
  INTERVENTION_CATALOG,
  type GovCompany,
} from '../../services/customerInterventionGovernanceService';
import type { ReadinessArea, ReadinessState } from '../../services/customerReadinessService';
import type { ConfidenceLevel } from '../../services/customerSignalConfidenceService';

const NOW = Date.parse('2026-06-24T00:00:00Z');
const AREAS: ReadinessArea[] = ['COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE', 'SOCIAL_INTEGRATIONS', 'COMMUNITY', 'TEAM_MEMBERS', 'BILLING'];
const rec = <T>(v: T) => Object.fromEntries(AREAS.map((a) => [a, v])) as Record<ReadinessArea, T>;

const gc = (over: Partial<GovCompany> & { areas?: Partial<Record<ReadinessArea, ReadinessState>>; signal_confidence?: Partial<Record<ReadinessArea, ConfidenceLevel>> } = {}): GovCompany => ({
  company_id: 'c1', company_name: 'Acme', tenant_class: 'CUSTOMER',
  areas: { ...rec<ReadinessState>('NOT_READY'), ...(over.areas ?? {}) },
  signal_confidence: { ...rec<ConfidenceLevel>('HIGH'), ...(over.signal_confidence ?? {}) },
  overall_confidence: over.overall_confidence ?? 'HIGH',
  is_active: false, is_paying: true, has_value: false, value_category_count: 0, adoption_score: 0, execution_volume: 0,
  trajectory: 'UNKNOWN', readiness_bucket: 'AT_RISK', created_at: '2026-05-01T00:00:00Z', active_30d: 0, ...over,
});

describe('calculateCustomerState — exactly one state, deterministic', () => {
  it('EXPANDING: active + ≥2 value', () => expect(calculateCustomerState(gc({ is_active: true, has_value: true, value_category_count: 3 }), NOW).customer_state).toBe('EXPANDING'));
  it('VALUE_REALIZING: active + value', () => expect(calculateCustomerState(gc({ is_active: true, has_value: true, value_category_count: 1 }), NOW).customer_state).toBe('VALUE_REALIZING'));
  it('ADOPTING: active, no value', () => expect(calculateCustomerState(gc({ is_active: true }), NOW).customer_state).toBe('ADOPTING'));
  it('AT_RISK: paying inactive no-value stale', () => expect(calculateCustomerState(gc({ is_paying: true, is_active: false, has_value: false, created_at: '2026-01-01T00:00:00Z' }), NOW).customer_state).toBe('AT_RISK'));
  it('AT_RISK: declining trajectory', () => expect(calculateCustomerState(gc({ trajectory: 'DECLINING', is_paying: false }), NOW).customer_state).toBe('AT_RISK'));
  it('ACTIVATING: progress (profile ready), not active', () => expect(calculateCustomerState(gc({ is_paying: false, areas: { COMPANY_PROFILE: 'READY' } }), NOW).customer_state).toBe('ACTIVATING'));
  it('ONBOARDING: recent, no progress', () => expect(calculateCustomerState(gc({ is_paying: false, created_at: '2026-06-20T00:00:00Z' }), NOW).customer_state).toBe('ONBOARDING'));
  it('CHURNED: stale, no progress, no activity', () => expect(calculateCustomerState(gc({ is_paying: false, created_at: '2026-01-01T00:00:00Z', active_30d: 0 }), NOW).customer_state).toBe('CHURNED'));
});

describe('calculateInterventionEligibility', () => {
  it('non-CUSTOMER tenant → all interventions SUPPRESSED (POPULATION_INTEGRITY)', () => {
    const g = calculateInterventionEligibility(gc({ tenant_class: 'QA', areas: { COMPANY_PROFILE: 'NOT_READY' } }), NOW);
    expect(g.globally_suppressed).toBe(true);
    expect(g.eligible_interventions).toHaveLength(0);
    expect(g.ineligible_interventions.every((i) => i.status === 'SUPPRESSED' && i.reason.includes('POPULATION_INTEGRITY'))).toBe(true);
  });
  it('CUSTOMER with profile gap + HIGH confidence + eligible state → PROFILE_COMPLETION ELIGIBLE', () => {
    const g = calculateInterventionEligibility(gc({ tenant_class: 'CUSTOMER', is_paying: false, areas: { COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'READY' }, created_at: '2026-06-20T00:00:00Z' }), NOW);
    expect(g.customer_state).toBe('ACTIVATING'); // website ready = progress
    expect(g.eligible_interventions).toContain('PROFILE_COMPLETION');
  });
  it('BLOCKED when no gap (area already READY)', () => {
    const g = calculateInterventionEligibility(gc({ areas: { COMPANY_PROFILE: 'READY' }, is_paying: false, created_at: '2026-06-20T00:00:00Z' }), NOW);
    expect(g.ineligible_interventions.find((i) => i.id === 'PROFILE_COMPLETION')!.status).toBe('BLOCKED');
  });
  it('UNKNOWN when area state UNKNOWN', () => {
    const g = calculateInterventionEligibility(gc({ areas: { GOOGLE_ANALYTICS: 'UNKNOWN' }, is_active: true }), NOW);
    expect(g.ineligible_interventions.find((i) => i.id === 'GA_CONNECTION')!.status).toBe('UNKNOWN');
  });
  it('SUPPRESSED by LOW confidence', () => {
    const g = calculateInterventionEligibility(gc({ is_paying: false, areas: { COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'READY' }, signal_confidence: { COMPANY_PROFILE: 'LOW' }, created_at: '2026-06-20T00:00:00Z' }), NOW);
    expect(g.ineligible_interventions.find((i) => i.id === 'PROFILE_COMPLETION')!.reason).toMatch(/LOW_CONFIDENCE/);
  });
  it('SUPPRESSED by customer-state mismatch', () => {
    // CHURNED company: PROFILE_COMPLETION not eligible for CHURNED state
    const g = calculateInterventionEligibility(gc({ tenant_class: 'CUSTOMER', is_paying: false, created_at: '2026-01-01T00:00:00Z', active_30d: 0, areas: { COMPANY_PROFILE: 'NOT_READY' } }), NOW);
    expect(g.customer_state).toBe('CHURNED');
    expect(g.ineligible_interventions.find((i) => i.id === 'PROFILE_COMPLETION')!.reason).toMatch(/CUSTOMER_STATE/);
  });
});

describe('simulateInterventionPortfolio', () => {
  const companies = [
    gc({ company_id: 'cust', tenant_class: 'CUSTOMER', is_paying: false, areas: { COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'READY' }, created_at: '2026-06-20T00:00:00Z' }),
    gc({ company_id: 'qa', tenant_class: 'QA', areas: { COMPANY_PROFILE: 'NOT_READY' } }),
    gc({ company_id: 'test', tenant_class: 'TEST', areas: { COMPANY_PROFILE: 'NOT_READY' } }),
  ];
  const r = simulateInterventionPortfolio(companies, NOW);

  it('counts eligible/suppressed/blocked/unknown per intervention', () => {
    expect(r.total_companies).toBe(3);
    expect(r.companies_globally_suppressed).toBe(2); // qa + test
    const prof = r.by_intervention.find((b) => b.id === 'PROFILE_COMPLETION')!;
    expect(prof.eligible).toBe(1);    // only the customer
    expect(prof.suppressed).toBe(2);  // qa + test (population)
  });
  it('per-intervention counts sum to total companies', () => {
    for (const b of r.by_intervention) expect(b.eligible + b.suppressed + b.blocked + b.unknown).toBe(3);
  });
  it('totals = sum over interventions × companies', () => {
    const n = INTERVENTION_CATALOG.length;
    expect(r.totals.eligible + r.totals.suppressed + r.totals.blocked + r.totals.unknown).toBe(3 * n);
  });
  it('only the customer has any eligible intervention', () => {
    expect(r.companies_with_any_eligible).toBe(1);
  });
  it('deterministic', () => {
    expect(JSON.stringify(simulateInterventionPortfolio(companies, NOW))).toBe(JSON.stringify(r));
  });
});
