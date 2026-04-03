import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import { buildReportScoreModel } from '../../services/reportScoreModelService';

function makeDecision(params: {
  id: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  impactTraffic?: number;
  impactConversion?: number;
  impactRevenue?: number;
  confidenceScore?: number;
}): PersistedDecisionObject {
  const now = new Date('2026-04-01T00:00:00.000Z').toISOString();
  return {
    id: params.id,
    company_id: 'company-1',
    report_tier: 'snapshot',
    source_service: 'testService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.title,
    evidence: { seed: true },
    impact_traffic: params.impactTraffic ?? 50,
    impact_conversion: params.impactConversion ?? 45,
    impact_revenue: params.impactRevenue ?? 40,
    priority_score: 65,
    effort_score: 30,
    execution_score: 60,
    confidence_score: params.confidenceScore ?? 0.8,
    recommendation: 'Take action',
    action_type: 'adjust_strategy',
    action_payload: {},
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

describe('reportScoreModelService', () => {
  it('heavily penalizes multiple weak dimensions', () => {
    const weakModel = buildReportScoreModel({
      decisions: [
        makeDecision({ id: '1', issueType: 'content_gap', title: 'Content coverage is weak', impactTraffic: 82, impactConversion: 70 }),
        makeDecision({ id: '2', issueType: 'cta_clarity_gap', title: 'CTA clarity is weak', impactConversion: 78, impactRevenue: 72 }),
        makeDecision({ id: '3', issueType: 'authority_deficit', title: 'Authority is weak', impactTraffic: 76, impactRevenue: 68 }),
        makeDecision({ id: '4', issueType: 'seo_gap', title: 'Reach is weak', impactTraffic: 80, impactConversion: 52 }),
      ],
    });

    expect(weakModel.value).toBeLessThan(55);
    expect(weakModel.weakest_dimensions.length).toBeGreaterThanOrEqual(3);
  });

  it('does not let one strong area hide several weak ones', () => {
    const model = buildReportScoreModel({
      decisions: [
        makeDecision({ id: '1', issueType: 'authority_deficit', title: 'Authority is weak', impactRevenue: 82 }),
        makeDecision({ id: '2', issueType: 'cta_clarity_gap', title: 'Conversion path is weak', impactConversion: 79 }),
        makeDecision({ id: '3', issueType: 'content_gap', title: 'Coverage is weak', impactTraffic: 81 }),
      ],
      resolvedInput: {
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
          socialLinks: ['https://linkedin.com/company/example', 'https://x.com/example'],
          competitors: [],
          source: 'manual-entry',
          uploadedFileName: null,
          manualData: null,
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
      },
    });

    expect(model.value).toBeLessThan(70);
    expect(model.growth_path.projected_score_improvements.length).toBeGreaterThanOrEqual(1);
  });
});
