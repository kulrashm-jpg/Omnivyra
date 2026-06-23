/**
 * Phase 12D — Opportunity Detection Engine tests (pure, hermetic).
 */

import {
  detectOpportunities,
  companyOpportunities,
  detectCustomerOpportunities,
  type OpportunityType,
} from '../../services/customerOpportunityService';
import type { CompanyReadiness } from '../../services/customerReadinessService';

const cr = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
  company_id: 'co_1', company_name: 'Acme', plan: 'Pro', user_count: 3, active_user_count_30d: 2,
  created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-06-20T00:00:00Z', tenant_status: 'ACTIVE',
  company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'READY', gsc_ready: 'READY',
  social_ready: 'READY', community_ready: 'UNKNOWN', team_ready: 'READY', billing_ready: 'READY',
  overall_readiness_score: 100, readiness_bucket: 'READY', missing_areas: [],
  ...over,
});

const types = (c: CompanyReadiness): OpportunityType[] => detectOpportunities(c).map((o) => o.type);
const sevOf = (c: CompanyReadiness, t: OpportunityType) => detectOpportunities(c).find((o) => o.type === t)?.severity;

describe('detectOpportunities — eligibility & severity', () => {
  it('a fully-ready ACTIVE tenant has no opportunities (UNKNOWN community ignored)', () => {
    expect(detectOpportunities(cr())).toEqual([]);
  });

  it('WEBSITE_UNVERIFIED (HIGH) on website NOT_READY', () => {
    expect(sevOf(cr({ website_ready: 'NOT_READY' }), 'WEBSITE_UNVERIFIED')).toBe('HIGH');
  });
  it('PROFILE_INCOMPLETE (MEDIUM) on profile NOT_READY', () => {
    expect(sevOf(cr({ company_profile_ready: 'NOT_READY' }), 'PROFILE_INCOMPLETE')).toBe('MEDIUM');
  });
  it('MISSING_GA/GSC/SOCIAL/TEAM on respective NOT_READY', () => {
    expect(types(cr({ ga_ready: 'NOT_READY' }))).toContain('MISSING_GA');
    expect(types(cr({ gsc_ready: 'NOT_READY' }))).toContain('MISSING_GSC');
    expect(types(cr({ social_ready: 'NOT_READY' }))).toContain('MISSING_SOCIAL');
    expect(sevOf(cr({ team_ready: 'NOT_READY' }), 'MISSING_TEAM')).toBe('LOW');
  });

  it('UNKNOWN areas never produce an opportunity', () => {
    expect(types(cr({ ga_ready: 'UNKNOWN', gsc_ready: 'UNKNOWN', social_ready: 'UNKNOWN' }))).toEqual([]);
  });

  it('MISSING_BILLING: HIGH if ACTIVE, MEDIUM if DORMANT, NONE if brand-new or churned', () => {
    expect(sevOf(cr({ billing_ready: 'NOT_READY', tenant_status: 'ACTIVE' }), 'MISSING_BILLING')).toBe('HIGH');
    expect(sevOf(cr({ billing_ready: 'NOT_READY', tenant_status: 'DORMANT', readiness_bucket: 'PARTIAL', overall_readiness_score: 60 }), 'MISSING_BILLING')).toBe('MEDIUM');
    expect(types(cr({ billing_ready: 'NOT_READY', tenant_status: 'COMPANY_CREATED', last_activity_at: null }))).not.toContain('MISSING_BILLING');
    expect(types(cr({ billing_ready: 'NOT_READY', tenant_status: 'INACTIVE' }))).not.toContain('MISSING_BILLING');
  });

  it('lifecycle: INACTIVE_COMPANY (HIGH) and DORMANT_COMPANY (MEDIUM)', () => {
    expect(sevOf(cr({ tenant_status: 'INACTIVE' }), 'INACTIVE_COMPANY')).toBe('HIGH');
    expect(sevOf(cr({ tenant_status: 'DORMANT' }), 'DORMANT_COMPANY')).toBe('MEDIUM');
  });

  it('LOW_READINESS (HIGH) when bucket AT_RISK', () => {
    expect(sevOf(cr({ readiness_bucket: 'AT_RISK', overall_readiness_score: 20 }), 'LOW_READINESS')).toBe('HIGH');
  });

  it('every opportunity carries reason + evidence', () => {
    for (const o of detectOpportunities(cr({ website_ready: 'NOT_READY', readiness_bucket: 'AT_RISK' }))) {
      expect(o.reason.length).toBeGreaterThan(0);
      expect(o.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('companyOpportunities — count + highest severity', () => {
  it('aggregates count and highest severity (HIGH wins)', () => {
    const c = companyOpportunities(cr({ website_ready: 'NOT_READY', team_ready: 'NOT_READY', social_ready: 'NOT_READY' }));
    expect(c.opportunity_count).toBe(3);
    expect(c.highest_severity).toBe('HIGH'); // WEBSITE_UNVERIFIED
  });
  it('no opportunities → highest_severity null', () => {
    expect(companyOpportunities(cr()).highest_severity).toBeNull();
  });
});

describe('detectCustomerOpportunities — summary', () => {
  it('summary counts by type/severity, companies-with-opps, and ranks top', () => {
    const list = [
      cr({ company_id: 'a', website_ready: 'NOT_READY' }),                  // 1 high
      cr({ company_id: 'b', website_ready: 'NOT_READY', ga_ready: 'NOT_READY' }), // high + medium
      cr({ company_id: 'c' }),                                              // none
    ];
    const { per_company, summary } = detectCustomerOpportunities(list);
    expect(per_company).toHaveLength(3);
    expect(summary.companies_with_opportunities).toBe(2);
    expect(summary.by_type.WEBSITE_UNVERIFIED).toBe(2);
    expect(summary.by_type.MISSING_GA).toBe(1);
    expect(summary.by_severity.HIGH).toBe(2);
    expect(summary.total_opportunities).toBe(3);
    expect(summary.top_opportunities[0]).toEqual({ type: 'WEBSITE_UNVERIFIED', count: 2 });
  });
});
