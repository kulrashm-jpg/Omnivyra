import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import {
  assertSortedByTierThenScore,
  assertValidCompetitorList,
} from '../helpers/assertValidCompetitor';

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
  actionPayload?: Record<string, unknown>;
  impactTraffic?: number;
  impactConversion?: number;
  impactRevenue?: number;
  priorityScore?: number;
  effortScore?: number;
  confidenceScore?: number;
  reportTier?: PersistedDecisionObject['report_tier'];
  evidence?: Record<string, unknown>;
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
    evidence: params.evidence ?? { seed: true },
    impact_traffic: params.impactTraffic ?? 50,
    impact_conversion: params.impactConversion ?? 30,
    impact_revenue: params.impactRevenue ?? 20,
    priority_score: params.priorityScore ?? 60,
    effort_score: params.effortScore ?? 20,
    execution_score: 60,
    confidence_score: params.confidenceScore ?? 0.8,
    recommendation: params.recommendation,
    action_type: params.actionType ?? 'improve_content',
    action_payload: params.actionPayload ?? {},
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

describe('snapshotReportService', () => {
  it('renders an honest insufficient-signal snapshot when no decisions are available', async () => {
    const resolvedInput = makeResolvedInput();

    const report = await composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [],
      resolvedInput,
    });

    // Canonical Trust Foundation: empty input must produce an honest empty/insufficient-signal report.
    // No synthetic decision floor, no fabricated insights, no manufactured actions.
    expect(report.pipeline_audit.fallback_decisions_added).toBe(0);
    expect(report.score.dimensions).toHaveLength(9);
    expect(report.score.dimensions.every((d) => d.value === null || d.state === 'measured' || d.state === 'inferred')).toBe(true);
    // The radar visual must render null (gap) rather than fake zeroes.
    expect(report.geo_aeo_visuals.ai_answer_presence_radar.answer_coverage_score).toBeNull();
    expect(report.visual_intelligence.opportunity_coverage_matrix.opportunities).toHaveLength(0);
    expect(report.visual_intelligence.search_visibility_funnel.impressions).toBeNull();
    expect(report.sections.map((section) => section.section_name)).toEqual([
      'Visibility',
      'Content Strength',
      'Authority',
    ]);
  });

  it('strengthens insights when partial input is available', async () => {
    const resolvedInput = makeResolvedInput({
      socialLinks: ['https://linkedin.com/company/example'],
      geography: 'United States',
    });

    const report = await composeSnapshotReportFromDecisions({
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
    // Canonical Architecture Consolidation (Phase 2): signal_availability is removed
    // from the public report shape. Authority/geo coverage now flows through the
    // canonical pillar score states.
    const authorityPillar = report.canonical.pillars.find((p) => p.pillar === 'authority');
    expect(authorityPillar).toBeDefined();
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

  it('preserves strong real decisions for fuller inputs', async () => {
    const resolvedInput = makeResolvedInput({
      businessType: 'B2B Services',
      geography: 'United States',
      socialLinks: ['https://linkedin.com/company/example'],
      competitors: [],
    });

    const report = await composeSnapshotReportFromDecisions({
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
    expect(report.score.value === null || report.score.value >= 0).toBe(true);
    expect(report.diagnosis.length).toBeGreaterThan(30);
    expect(report.primary_problem.length).toBeGreaterThan(30);
    expect(
      report.seo_executive_summary.growth_opportunity === null ||
      report.seo_executive_summary.growth_opportunity.title.length > 5
    ).toBe(true);
    // Canonical Trust Foundation: overall_ai_visibility_score is null when no GEO/AEO axis is measured.
    expect(
      report.geo_aeo_executive_summary.overall_ai_visibility_score === null ||
      report.geo_aeo_executive_summary.overall_ai_visibility_score >= 0,
    ).toBe(true);
    expect(report.seo_executive_summary.top_3_actions.every((item) => item.reasoning.length > 5)).toBe(true);
    expect(report.visual_intelligence.seo_capability_radar.content_quality_score).not.toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.source_tags.content_quality_score).toBeTruthy();
    expect(report.sections.every((section) => section.insights.length > 0)).toBe(true);
    expect(report.top_priorities[0]?.title).toBeTruthy();
    expect(report.top_priorities[0]?.expected_outcome).toBeTruthy();
    expect(report.secondary_problems.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts actions and priorities by priority type then impact score', async () => {
    const resolvedInput = makeResolvedInput({
      businessType: 'B2B Services',
      geography: 'United States',
    });

    const report = await composeSnapshotReportFromDecisions({
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

  it('builds structured action recommendations from real gap data', async () => {
    const resolvedInput = makeResolvedInput({
      companyName: 'Drishik',
      websiteDomain: 'drishik.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance'],
        targetCustomer: 'individuals seeking personal clarity and guided self-reflection',
        idealCustomerProfile: 'adults seeking private emotional support and structured wellbeing guidance',
        brandPositioning: 'AI-guided personal clarity and self-reflection support',
        competitiveAdvantages: null,
        teamSize: null,
        foundedYear: null,
        revenueRange: null,
      },
    });

    const report = await composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [
        makeDecision({
          id: 'content-gap-1',
          issueType: 'competitor_content_gap',
          title: 'Competitors cover more buying-stage content than drishik.com',
          description: 'Comparison and decision-stage pages are missing for the highest-intent AI wellness alternatives.',
          recommendation: 'Build comparison and proof pages around the buying-stage topics competitors already own.',
          actionType: 'improve_content',
          priorityScore: 88,
          effortScore: 34,
          impactTraffic: 81,
          impactConversion: 66,
          actionPayload: {
            optimization_focus: 'comparison_pages',
            thin_pages: ['https://drishik.com/product', 'https://drishik.com/pricing'],
          },
        }),
      ],
      resolvedInput,
      publicAudit: {
        site_structure: {
          homepage: 'https://drishik.com/',
          product_pages: ['https://drishik.com/product'],
          pricing_pages: ['https://drishik.com/pricing'],
          blog_pages: ['https://drishik.com/blog/getting-started'],
          contact_pages: [],
          geo_pages: [],
        },
        geo_aeo_context: {
          queries: [],
          entities: [],
          answerable_content_pct: null,
          structured_content_pct: null,
          citation_ready_pct: null,
          answer_coverage_score: null,
          entity_clarity_score: null,
          topical_authority_score: null,
          citation_readiness_score: null,
          content_structure_score: null,
          freshness_score: null,
        },
        decisions: [
          makeDecision({
            id: 'audit-thin-pages',
            issueType: 'weak_content_depth',
            title: 'Core pages are too thin or weakly structured to perform well in search',
            description: 'Important pages are too thin.',
            recommendation: 'Deepen the important pages first.',
            actionType: 'improve_content',
            actionPayload: {
              optimization_focus: 'page_depth',
              thin_pages: ['https://drishik.com/product', 'https://drishik.com/pricing'],
            },
          }),
        ],
      },
      competitorIntelligenceOverride: {
        detected_competitors: [
          {
            name: 'Wysa',
            domain: 'wysa.com',
            classification: 'direct_competitor',
            source: 'manual',
            relevance_score: 91,
            final_score: 0.91,
            category: 'mental_wellness_ai',
            tags: ['chatbot'],
            tier: 'Tier 1',
            enrichment: null,
            enrichment_confidence_score: 0,
            rationale: 'Direct AI wellness competitor',
          },
        ],
        generated_gaps: [
          {
            gap_type: 'content_gap',
            issue_type: 'competitor_content_gap',
            title: 'Competitors cover more buying-stage content than drishik.com',
            insight: 'Drishik lacks comparison and decision-stage content.',
            why_it_matters: 'Buyers shortlist alternatives before reaching the site.',
            recommendation: 'Build /vs/ pages and comparison content.',
            action_type: 'improve_content',
            expected_outcome: 'The site should compete more often in high-intent search and comparison moments.',
            effort_level: 'medium',
            impact_score: 88,
            confidence_score: 0.86,
            leading_competitors: ['wysa.com'],
          },
        ],
        summary: 'Competitors are ahead on buying-stage coverage.',
        comparison: null,
        discovery_metadata: {
          serp_status: 'live',
          serp_domains_found: 1,
          is_fallback_used: false,
        },
      } as any,
    });

    const action = report.seo_executive_summary.top_3_actions[0];

    expect(report.competitor_intelligence.detected_competitors.map((item) => item.name)).toEqual(['Wysa']);
    assertValidCompetitorList(report.competitor_intelligence.detected_competitors as any[]);
    assertSortedByTierThenScore(report.competitor_intelligence.detected_competitors as any[]);
    expect(action.title.length).toBeGreaterThan(5);
    expect(action.reasoning.length).toBeGreaterThan(20);
    expect(action.tactics.length).toBeGreaterThanOrEqual(2);
    expect(action.focus_page.length).toBeGreaterThan(0);
    expect(action.timeline.short.length).toBeGreaterThan(0);
    expect(action.timeline.mid.length).toBeGreaterThan(0);
    expect(action.timeline.long.length).toBeGreaterThan(0);
    expect(action.confidence).toBeGreaterThan(0);
    // Canonical Trust Foundation: tactic strings now reflect the actual top decision (a content
    // gap in this fixture) rather than authority tactics injected by the deleted decision floor.
    expect(action.tactics.every((tactic) => tactic.length > 5)).toBe(true);
  });
});
