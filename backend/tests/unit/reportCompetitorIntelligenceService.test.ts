import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import {
  buildCompetitorIntelligence,
  buildCompetitorIntelligenceActive,
  competitorGapsToDecisions,
} from '../../services/reportCompetitorIntelligenceService';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';

function makeResolvedInput(overrides?: Partial<ResolvedReportInput['resolved']>): ResolvedReportInput {
  return {
    companyId: 'company-1',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'company-1',
      name: 'Omnivyra',
      category: 'SaaS / Software',
      industry: 'Technology & Software',
      website_url: 'https://omnivyra.com',
      products_services: 'AI-driven marketing operating system',
      products_services_list: ['AI-driven marketing operating system', 'readiness analysis'],
      target_customer_segment: 'B2B marketing teams',
      ideal_customer_profile: 'lean growth teams',
      brand_positioning: 'Unified AI-driven platform for marketing readiness',
      competitive_advantages: 'clarity, execution sequencing, operating-system workflow',
    },
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
      businessType: 'B2B Services',
      geography: 'United States',
      socialLinks: ['https://linkedin.com/company/example'],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'SaaS / Software',
        productServices: ['AI-driven marketing operating system', 'readiness analysis'],
        targetCustomer: 'B2B marketing teams',
        idealCustomerProfile: 'lean growth teams',
        brandPositioning: 'Unified AI-driven platform for marketing readiness',
        competitiveAdvantages: 'clarity, execution sequencing',
        teamSize: '11-50',
        foundedYear: '2022',
        revenueRange: '$1M-$5M',
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
  confidenceScore?: number;
  impactTraffic?: number;
  impactConversion?: number;
  impactRevenue?: number;
  actionType?: PersistedDecisionObject['action_type'];
}): PersistedDecisionObject {
  const now = new Date('2026-03-31T00:00:00.000Z').toISOString();
  return {
    id: params.id,
    company_id: 'company-1',
    report_tier: 'snapshot',
    source_service: 'testService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: { seed: true },
    impact_traffic: params.impactTraffic ?? 58,
    impact_conversion: params.impactConversion ?? 42,
    impact_revenue: params.impactRevenue ?? 36,
    priority_score: 64,
    effort_score: 24,
    execution_score: 63,
    confidence_score: params.confidenceScore ?? 0.78,
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

describe('reportCompetitorIntelligenceService', () => {
  it('caps competitors to three and preserves source labeling', () => {
    const resolvedInput = makeResolvedInput({
      competitors: ['alpha.com', 'beta.com', 'gamma.com', 'delta.com'],
    });

    const intelligence = buildCompetitorIntelligence({
      decisions: [
        makeDecision({
          id: 'seo-1',
          issueType: 'seo_gap',
          title: 'Search visibility is thin',
          description: 'Core search demand is not covered strongly enough.',
          recommendation: 'Expand core service-page coverage.',
        }),
      ],
      resolvedInput,
    });

    expect(intelligence.detected_competitors).toHaveLength(3);
    expect(intelligence.detected_competitors.every((item) => item.source === 'manual')).toBe(true);
    expect(intelligence.generated_gaps.length).toBeGreaterThanOrEqual(1);
  });

  it('marks inferred peers clearly when explicit competitors are unavailable', () => {
    const intelligence = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeResolvedInput({ competitors: [] }),
    });

    expect(intelligence.detected_competitors).toHaveLength(3);
    expect(intelligence.detected_competitors.every((item) => item.source === 'inferred_keyword_peer')).toBe(true);
    expect(intelligence.detected_competitors[0]?.name.toLowerCase()).toContain('marketing');
    expect(intelligence.detected_competitors[0]?.fit_signals?.team_size).toBe('11-50');
    expect(intelligence.detected_competitors[0]?.fit_signals?.revenue_range).toBe('$1M-$5M');
    expect(intelligence.generated_gaps.some((gap) => gap.gap_type === 'visibility_gap' || gap.gap_type === 'content_gap')).toBe(true);
  });

  it('converts strongest gaps into snapshot decision objects and exposes them in the report payload', () => {
    const resolvedInput = makeResolvedInput({ competitors: ['alpha.com', 'beta.com', 'gamma.com'] });
    const intelligence = buildCompetitorIntelligence({
      decisions: [
        makeDecision({
          id: 'content-1',
          issueType: 'content_gap',
          title: 'Buying-stage content is thin',
          description: 'Comparison and proof content is under-covered.',
          recommendation: 'Publish comparison and case-study content.',
        }),
      ],
      resolvedInput,
    });

    const decisions = competitorGapsToDecisions({
      companyId: 'company-1',
      gaps: intelligence.generated_gaps,
    });
    const report = composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [],
      resolvedInput,
    });

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0]?.source_service).toBe('reportCompetitorIntelligenceService');
    expect(report.competitor_intelligence.detected_competitors).toHaveLength(3);
    expect(report.pipeline_audit.competitor_gap_decisions_added).toBeGreaterThanOrEqual(1);
    expect(report.summary.toLowerCase()).toContain('content coverage');
  });

  it('active discovery falls back gracefully and still returns non-empty competitors', async () => {
    const intelligence = await buildCompetitorIntelligenceActive({
      companyId: 'company-1',
      decisions: [],
      resolvedInput: makeResolvedInput({ competitors: [] }),
    });

    expect(intelligence.detected_competitors.length).toBeGreaterThanOrEqual(3);
    expect(intelligence.discovery_metadata?.serp_status).toBe('fallback');
    expect(intelligence.generated_gaps.length).toBeGreaterThanOrEqual(1);
  });
});
