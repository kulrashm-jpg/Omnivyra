import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import {
  composeSnapshotReportFromDecisions,
  ensureSnapshotDecisionFloor,
} from '../../services/snapshotReportService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

function makeResolvedInput(overrides?: Partial<ResolvedReportInput['resolved']>): ResolvedReportInput {
  return {
    companyId: 'company-1',
    reportCategory: 'snapshot',
    profile: null,
    requestPayload: {},
    defaults: {
      company_name: null,
      website_domain: null,
      business_type: null,
      geography: null,
      social_links: [],
      competitors: [],
    },
    resolved: {
      companyName: null,
      websiteDomain: 'example.com',
      businessType: null,
      geography: null,
      socialLinks: [],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: null,
        productServices: [],
        targetCustomer: null,
        idealCustomerProfile: null,
        brandPositioning: null,
        competitiveAdvantages: null,
        teamSize: null,
        foundedYear: null,
        revenueRange: null,
      },
      ...overrides,
    },
    integrations: {
      google_analytics: { connected: false, source: 'system', label: 'Google Analytics' },
      google_search_console: { connected: false, source: 'system', label: 'Google Search Console' },
      google_ads: { connected: false, source: 'system', label: 'Google Ads' },
      linkedin_ads: { connected: false, source: 'system', label: 'LinkedIn Ads' },
      meta_ads: { connected: false, source: 'system', label: 'Meta Ads' },
      shopify: { connected: false, source: 'system', label: 'Shopify' },
      woocommerce: { connected: false, source: 'system', label: 'WooCommerce' },
      social_accounts: { connected: false, source: 'system', label: 'Social Accounts' },
      wordpress: { connected: false, source: 'system', label: 'WordPress' },
      custom_blog_api: { connected: false, source: 'system', label: 'Custom Blog API' },
      lead_webhook: { connected: false, source: 'system', label: 'Lead Webhook' },
      website_crawl: { connected: true, source: 'system', label: 'Website Crawl' },
      data_upload: { connected: false, source: 'system', label: 'Uploaded Data File' },
      manual_entry: { connected: false, source: 'system', label: 'Manual Data Entry' },
    },
  };
}

function makeDecision(params: {
  id: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  actionType?: PersistedDecisionObject['action_type'];
  impactTraffic?: number;
  impactConversion?: number;
  impactRevenue?: number;
  priorityScore?: number;
  confidenceScore?: number;
  reportTier?: PersistedDecisionObject['report_tier'];
}): PersistedDecisionObject {
  const now = new Date('2026-03-31T00:00:00.000Z').toISOString();
  return {
    id: params.id,
    company_id: 'company-1',
    report_tier: params.reportTier ?? 'snapshot',
    source_service: 'testService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: { seed: true },
    impact_traffic: params.impactTraffic ?? 50,
    impact_conversion: params.impactConversion ?? 30,
    impact_revenue: params.impactRevenue ?? 20,
    priority_score: params.priorityScore ?? 60,
    effort_score: 20,
    execution_score: 60,
    confidence_score: params.confidenceScore ?? 0.8,
    recommendation: params.recommendation,
    action_type: params.actionType ?? 'improve_content',
    action_payload: {},
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

describe('snapshotReportService', () => {
  it('guarantees a meaningful snapshot for minimal input', () => {
    const resolvedInput = makeResolvedInput();
    const floor = ensureSnapshotDecisionFloor({
      companyId: 'company-1',
      decisions: [],
      resolvedInput,
    });

    const report = composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [],
      resolvedInput,
    });

    const insightCount = report.sections.reduce((sum, section) => sum + section.insights.length, 0);
    const actionCount = report.sections.reduce((sum, section) => sum + section.actions.length, 0);

    expect(floor.decisions.length).toBeGreaterThanOrEqual(3);
    expect(report.diagnosis.length).toBeGreaterThan(20);
    expect(report.primary_problem).toContain('The core problem is');
    expect(report.seo_executive_summary.overall_health_score).toBeGreaterThan(0);
    expect(report.seo_executive_summary.primary_problem.title.length).toBeGreaterThan(5);
    expect(report.seo_executive_summary.top_3_actions.length).toBeGreaterThanOrEqual(3);
    expect(report.geo_aeo_visuals.ai_answer_presence_radar.answer_coverage_score).toBeNull();
    expect(report.geo_aeo_executive_summary.primary_gap.title.length).toBeGreaterThan(5);
    expect(insightCount).toBeGreaterThanOrEqual(3);
    expect(actionCount).toBeGreaterThanOrEqual(2);
    expect(report.top_priorities.length).toBeGreaterThanOrEqual(1);
    expect(report.score.dimensions).toHaveLength(9);
    expect(report.score.weakest_dimensions.length).toBeGreaterThanOrEqual(1);
    expect(report.score.limiting_factors.length).toBeGreaterThanOrEqual(1);
    expect(report.score.growth_path.focus.length).toBeGreaterThanOrEqual(1);
    expect(report.sections.flatMap((section) => section.insights).every((item) => item.why_it_matters.length > 10)).toBe(true);
    expect(report.sections.flatMap((section) => section.insights).every((item) => item.business_impact.length > 20)).toBe(true);
    expect(report.sections.flatMap((section) => section.actions).every((item) => item.steps.length >= 2)).toBe(true);
    expect(report.sections.flatMap((section) => section.actions).every((item) => item.expected_upside.length > 20)).toBe(true);
    expect(report.sections.flatMap((section) => section.actions).every((item) => ['quick_win', 'high_impact', 'strategic'].includes(item.priority_type))).toBe(true);
    expect(report.top_priorities.every((item) => item.expected_upside.length > 20)).toBe(true);
    expect(report.top_priorities.every((item) => ['quick_win', 'high_impact', 'strategic'].includes(item.priority_type))).toBe(true);
    expect(report.visual_intelligence.seo_capability_radar.content_quality_score).not.toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.data_source_strength.content_quality_score).toBeTruthy();
    expect(report.visual_intelligence.search_visibility_funnel.drop_off_reason_distribution.ranking_issue_pct).toBeNull();
    expect(report.visual_intelligence.crawl_health_breakdown.severity_split.classification).toBe('unclassified');
    expect(report.visual_intelligence.search_visibility_funnel.impressions).toBeNull();
    expect(report.visual_intelligence.opportunity_coverage_matrix.opportunities).toHaveLength(0);
    expect(report.pipeline_audit.fallback_decisions_added).toBeGreaterThanOrEqual(1);
    expect(report.pipeline_audit.competitor_gap_decisions_added).toBeGreaterThanOrEqual(1);
    expect(report.competitor_intelligence.detected_competitors).toHaveLength(3);
    expect(report.sections.map((section) => section.section_name)).toEqual([
      'Visibility',
      'Content Strength',
      'Authority',
    ]);
  });

  it('strengthens insights when partial input is available', () => {
    const resolvedInput = makeResolvedInput({
      socialLinks: ['https://linkedin.com/company/example'],
      geography: 'United States',
    });

    const report = composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [
        makeDecision({
          id: 'seo-1',
          issueType: 'ranking_gap',
          title: 'Keyword ranking is stuck outside the traffic zone',
          description: 'Core keyword pages are visible but not winning enough top positions.',
          recommendation: 'Improve supporting depth and on-page specificity for the primary service keywords.',
          impactTraffic: 61,
          priorityScore: 64,
        }),
      ],
      resolvedInput,
    });

    const opportunityCount = report.sections.reduce((sum, section) => sum + section.opportunities.length, 0);
    expect(report.signal_availability.authority).not.toBe('NO_DATA');
    expect(report.signal_availability.geo_relevance).not.toBe('NO_DATA');
    expect(opportunityCount).toBeGreaterThanOrEqual(1);
    expect(report.seo_executive_summary.primary_problem.reasoning.length).toBeGreaterThan(10);
    expect(report.visual_intelligence.seo_capability_radar.content_quality_score).not.toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.data_source_strength.content_quality_score).toBeTruthy();
    expect(report.geo_aeo_visuals.ai_answer_presence_radar.data_source_strength).toBeTruthy();
    expect(report.top_priorities.length).toBeGreaterThanOrEqual(2);
    expect(report.pipeline_audit.final_insights).toBeGreaterThanOrEqual(3);
    expect(report.pipeline_audit.final_actions).toBeGreaterThanOrEqual(2);
    expect(report.summary).toContain(report.primary_problem);
  });

  it('preserves strong real decisions for fuller inputs', () => {
    const resolvedInput = makeResolvedInput({
      businessType: 'B2B Services',
      geography: 'United States',
      socialLinks: ['https://linkedin.com/company/example'],
      competitors: ['comp-a.com', 'comp-b.com'],
    });

    const report = composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [
        makeDecision({
          id: 'seo-1',
          issueType: 'impression_click_gap',
          title: 'Search impressions are not converting into visits',
          description: 'Pages are visible in search but click-through remains weak.',
          recommendation: 'Rewrite titles and meta messaging around a sharper value promise.',
          impactTraffic: 68,
          impactConversion: 42,
          priorityScore: 70,
        }),
        makeDecision({
          id: 'content-1',
          issueType: 'content_gap',
          title: 'High-intent topics are missing from the content portfolio',
          description: 'The company is under-covered on comparison and evaluation topics.',
          recommendation: 'Publish comparison, use-case, and decision-stage pages for the buying committee.',
          impactTraffic: 57,
          impactConversion: 51,
          priorityScore: 72,
        }),
      ],
      supplementalGrowthDecisions: [
        makeDecision({
          id: 'auth-1',
          issueType: 'authority_deficit',
          title: 'Authority proof is too thin for a confident buyer journey',
          description: 'The site lacks enough proof, backlinks, and credibility markers for higher-stakes buying.',
          recommendation: 'Publish proof-backed authority assets and add visible credibility signals to conversion pages.',
          actionType: 'adjust_strategy',
          impactTraffic: 36,
          impactConversion: 63,
          impactRevenue: 54,
          priorityScore: 69,
          reportTier: 'growth',
        }),
      ],
      resolvedInput,
    });

    expect(report.pipeline_audit.fallback_decisions_added).toBe(0);
    expect(report.score.value).toBeGreaterThanOrEqual(25);
    expect(report.diagnosis.length).toBeGreaterThan(30);
    expect(report.primary_problem.length).toBeGreaterThan(30);
    expect(
      report.seo_executive_summary.growth_opportunity === null ||
      report.seo_executive_summary.growth_opportunity.title.length > 5
    ).toBe(true);
    expect(report.geo_aeo_executive_summary.overall_ai_visibility_score).toBeGreaterThanOrEqual(0);
    expect(report.seo_executive_summary.top_3_actions.every((item) => item.reasoning.length > 5)).toBe(true);
    expect(report.visual_intelligence.seo_capability_radar.content_quality_score).not.toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.source_tags.content_quality_score).toBeTruthy();
    expect(report.sections.every((section) => section.insights.length > 0)).toBe(true);
    expect(report.top_priorities[0]?.title).toBeTruthy();
    expect(report.top_priorities[0]?.expected_outcome).toBeTruthy();
    expect(report.secondary_problems.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts actions and priorities by priority type then impact score', () => {
    const resolvedInput = makeResolvedInput({
      businessType: 'B2B Services',
      geography: 'United States',
    });

    const report = composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [
        makeDecision({
          id: 'quick-win',
          issueType: 'cta_clarity_gap',
          title: 'Primary CTA is too weak on service pages',
          description: 'The page asks visitors to do too much thinking before taking the next step.',
          recommendation: 'Rewrite CTA copy and make the next action explicit on the highest-intent pages.',
          actionType: 'fix_conversion',
          impactConversion: 58,
          impactRevenue: 44,
        }),
        makeDecision({
          id: 'high-impact',
          issueType: 'content_gap',
          title: 'Decision-stage content is missing',
          description: 'High-intent comparison and proof pages are missing.',
          recommendation: 'Build the decision-stage content cluster for the highest-value services.',
          actionType: 'improve_content',
          impactTraffic: 82,
          impactConversion: 66,
          impactRevenue: 59,
        }),
        makeDecision({
          id: 'strategic',
          issueType: 'authority_deficit',
          title: 'Authority proof is too thin',
          description: 'The site lacks enough visible proof and authority assets.',
          recommendation: 'Develop authority assets and link acquisition around the core offer.',
          actionType: 'adjust_strategy',
          impactTraffic: 52,
          impactConversion: 48,
          impactRevenue: 46,
        }),
      ],
      resolvedInput,
    });

    const actions = report.sections.flatMap((section) => section.actions);
    const priorities = report.top_priorities;
    const rank = { quick_win: 0, high_impact: 1, strategic: 2 } as const;

    expect(actions[0]?.priority_type).toBe('quick_win');
    expect(priorities[0]?.priority_type).toBe('quick_win');
    expect(actions.every((item) => item.expected_upside.length > 20)).toBe(true);
    expect(priorities.every((item) => item.expected_upside.length > 20)).toBe(true);
    expect(report.sections.every((section) => section.actions.every((item, index, list) => index === 0 || rank[list[index - 1].priority_type] <= rank[item.priority_type]))).toBe(true);
    expect(priorities.every((item, index, list) => index === 0 || rank[list[index - 1].priority_type] <= rank[item.priority_type])).toBe(true);
  });
});
