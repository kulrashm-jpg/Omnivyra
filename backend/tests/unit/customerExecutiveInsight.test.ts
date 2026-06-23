/**
 * Phase 12F — Executive Insight Engine tests (pure, deterministic, no AI).
 */

import {
  generateCompanyInsight,
  buildNarrative,
  generatePortfolioInsights,
  type InsightType,
} from '../../services/customerExecutiveInsightService';
import type { CompanyReadiness } from '../../services/customerReadinessService';

const cr = (over: Partial<CompanyReadiness> = {}): CompanyReadiness => ({
  company_id: 'co_1', company_name: 'Acme', plan: 'Pro', user_count: 3, active_user_count_30d: 2,
  created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-06-20T00:00:00Z', tenant_status: 'ACTIVE',
  company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'READY', gsc_ready: 'READY',
  social_ready: 'READY', community_ready: 'UNKNOWN', team_ready: 'READY', billing_ready: 'READY',
  overall_readiness_score: 100, readiness_bucket: 'READY', missing_areas: [],
  ...over,
});

const insightTypes = (c: CompanyReadiness): InsightType[] => generateCompanyInsight(c).insights.map((i) => i.type);

describe('insight generation', () => {
  it('fully-ready ACTIVE tenant → no insights', () => {
    expect(generateCompanyInsight(cr()).insights).toEqual([]);
  });
  it('VERIFICATION_GAP on unverified website', () => {
    expect(insightTypes(cr({ website_ready: 'NOT_READY' }))).toContain('VERIFICATION_GAP');
  });
  it('READINESS_BLOCKER on incomplete profile; AT_RISK overall when profile is OK', () => {
    expect(insightTypes(cr({ company_profile_ready: 'NOT_READY' }))).toContain('READINESS_BLOCKER');
    const atRisk = generateCompanyInsight(cr({ readiness_bucket: 'AT_RISK', overall_readiness_score: 20 })).insights.find((i) => i.type === 'READINESS_BLOCKER');
    expect(atRisk?.severity).toBe('HIGH');
  });
  it('ADOPTION_GAP lists the missing integrations', () => {
    const i = generateCompanyInsight(cr({ ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY' })).insights.find((x) => x.type === 'ADOPTION_GAP');
    expect(i?.title).toMatch(/GA and GSC/);
  });
  it('ENGAGEMENT_RISK: INACTIVE HIGH, DORMANT MEDIUM', () => {
    expect(generateCompanyInsight(cr({ tenant_status: 'INACTIVE' })).insights.find((i) => i.type === 'ENGAGEMENT_RISK')?.severity).toBe('HIGH');
    expect(generateCompanyInsight(cr({ tenant_status: 'DORMANT' })).insights.find((i) => i.type === 'ENGAGEMENT_RISK')?.severity).toBe('MEDIUM');
  });
  it('BILLING_RISK only for engaged non-payers', () => {
    expect(insightTypes(cr({ billing_ready: 'NOT_READY', tenant_status: 'ACTIVE' }))).toContain('BILLING_RISK');
    expect(insightTypes(cr({ billing_ready: 'NOT_READY', tenant_status: 'COMPANY_CREATED', last_activity_at: null }))).not.toContain('BILLING_RISK');
  });
  it('TEAM_EXPANSION_OPPORTUNITY on single seat', () => {
    expect(insightTypes(cr({ team_ready: 'NOT_READY' }))).toContain('TEAM_EXPANSION_OPPORTUNITY');
  });
  it('every insight has title/reason/evidence/confidence', () => {
    for (const i of generateCompanyInsight(cr({ website_ready: 'NOT_READY', ga_ready: 'NOT_READY' })).insights) {
      expect(i.title && i.reason && i.evidence && i.confidence).toBeTruthy();
    }
  });
});

describe('narrative generation (deterministic, no AI)', () => {
  it('active paying, ready profile+website, missing analytics', () => {
    const n = buildNarrative(cr({ ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY', social_ready: 'NOT_READY' }));
    expect(n).toBe('Active paying customer with a complete profile and a verified website but missing GA, GSC and social integrations.');
  });
  it('dormant tenant with incomplete profile and no team', () => {
    const n = buildNarrative(cr({ tenant_status: 'DORMANT', billing_ready: 'NOT_READY', company_profile_ready: 'NOT_READY', website_ready: 'NOT_READY', team_ready: 'NOT_READY', ga_ready: 'READY', gsc_ready: 'READY', social_ready: 'READY' }));
    expect(n).toContain('Dormant tenant');
    expect(n).toContain('an incomplete profile');
    expect(n).toContain('no team expansion');
    expect(n.endsWith('.')).toBe(true);
  });
  it('is deterministic', () => {
    const c = cr({ website_ready: 'NOT_READY', ga_ready: 'NOT_READY' });
    expect(buildNarrative(c)).toBe(buildNarrative(c));
  });
});

describe('blocker / opportunity selection', () => {
  it('primary_blocker picks highest-severity blocker (VERIFICATION over profile)', () => {
    const r = generateCompanyInsight(cr({ website_ready: 'NOT_READY', company_profile_ready: 'NOT_READY' }));
    expect(r.primary_blocker?.type).toBe('VERIFICATION_GAP'); // HIGH beats MEDIUM
  });
  it('primary_opportunity picks an opportunity type', () => {
    const r = generateCompanyInsight(cr({ ga_ready: 'NOT_READY', team_ready: 'NOT_READY' }));
    expect(['ADOPTION_GAP', 'TEAM_EXPANSION_OPPORTUNITY']).toContain(r.primary_opportunity?.type);
    expect(r.primary_opportunity?.type).toBe('ADOPTION_GAP'); // MEDIUM beats LOW
  });
  it('key_insight is the highest-severity overall', () => {
    const r = generateCompanyInsight(cr({ website_ready: 'NOT_READY', team_ready: 'NOT_READY' }));
    expect(r.key_insight?.type).toBe('VERIFICATION_GAP');
  });
});

describe('portfolio aggregation + determinism', () => {
  const list: CompanyReadiness[] = [
    cr({ company_id: 'a', website_ready: 'NOT_READY', ga_ready: 'NOT_READY' }),
    cr({ company_id: 'b', website_ready: 'NOT_READY', team_ready: 'NOT_READY' }),
    cr({ company_id: 'c' }), // no gaps
  ];
  it('ranks top blockers, opportunities, readiness gaps, verification gaps', () => {
    const { portfolio, per_company } = generatePortfolioInsights(list);
    expect(per_company).toHaveLength(3);
    expect(portfolio.total_tenants).toBe(3);
    expect(portfolio.top_blockers[0]).toEqual({ type: 'VERIFICATION_GAP', count: 2 });
    expect(portfolio.top_opportunities.find((o) => o.type === 'ADOPTION_GAP')?.count).toBe(1);
    expect(portfolio.most_common_readiness_gaps.find((g) => g.area === 'WEBSITE')?.count).toBe(2);
    expect(portfolio.most_common_verification_gaps[0]).toEqual({ area: 'WEBSITE_UNVERIFIED', count: 2 });
  });
  it('is deterministic', () => {
    expect(generatePortfolioInsights(list)).toEqual(generatePortfolioInsights(list));
  });
});
