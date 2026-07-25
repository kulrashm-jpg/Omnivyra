jest.mock('../../db/supabaseClient', () => {
  const buildQuery = () => {
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.order = jest.fn(() => query);
    query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
    query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
    return query;
  };

  return {
    supabase: {
      from: jest.fn(() => buildQuery()),
    },
  };
});

jest.mock('axios', () => ({
  get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })),
}));

import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import {
  buildCompetitorIntelligence,
  buildCompetitorIntelligenceActive,
  competitorGapsToDecisions,
  generateDiscoveryKeywords,
} from '../../services/reportCompetitorIntelligenceService';
import {
  buildCompetitivePressureAnalysis,
  buildCompetitiveSnapshotReport,
  buildCompetitiveStrategyMap,
} from '../../services/reportCompetitorStrategyService';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import {
  assertNoMarketSubstituteCompetitors,
  assertOnlyMarketSubstituteAlternatives,
  assertSortedByTierThenScore,
  assertValidCompetitorList,
} from '../helpers/assertValidCompetitor';

function makeResolvedInput(overrides?: Partial<ResolvedReportInput['resolved']>): ResolvedReportInput {
  return {
    companyId: 'company-1',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'company-1',
      name: 'Drishik',
      category: 'AI clarity platform',
      industry: 'AI wellness and decision intelligence',
      website_url: 'https://drishik.com',
      products_services: 'AI clarity engine for self-reflection, emotional wellbeing, and life decisions',
      products_services_list: ['AI clarity engine', 'self-reflection guidance', 'emotional wellbeing decision support'],
      target_audience: 'individuals seeking personal clarity and guided self-reflection',
      ideal_customer_profile: 'adults seeking private emotional support and structured wellbeing guidance',
      brand_positioning: 'AI-guided personal clarity and self-reflection support',
      competitive_advantages: 'private reflection, decision clarity, emotionally aware guidance',
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
      websiteDomain: 'drishik.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      socialLinks: ['https://linkedin.com/company/drishik'],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance'],
        targetCustomer: 'individuals seeking personal clarity and guided self-reflection',
        idealCustomerProfile: 'adults seeking private emotional support and structured wellbeing guidance',
        brandPositioning: 'AI-guided personal clarity and self-reflection support',
        competitiveAdvantages: 'private reflection, decision clarity',
        teamSize: '1-10',
        foundedYear: '2024',
        revenueRange: 'Pre-revenue',
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
  actionPayload?: Record<string, unknown>;
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
    action_payload: params.actionPayload ?? {},
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

describe('reportCompetitorIntelligenceService', () => {
  it('generates non-empty discovery keywords from product, problem, category, and ICP', () => {
    const keywords = generateDiscoveryKeywords(makeResolvedInput({ competitors: [] }));

    expect(keywords.length).toBeGreaterThanOrEqual(5);
    expect(keywords.length).toBeLessThanOrEqual(10);
    expect(keywords).toEqual(expect.arrayContaining([
      'best AI wellness and decision intelligence software',
      'AI wellness and decision intelligence comparison',
    ]));
    expect(keywords.every((keyword) => keyword.trim().length > 0)).toBe(true);
  }, 90000);

  it('filters mixed source inputs down to engine-approved competitors only', () => {
    const resolvedInput = makeResolvedInput({
      competitors: ['Wysa', 'Woebot Health', 'Reflectly', 'Headspace', 'Optimal Virtual Employee'],
    });

    const intelligence = buildCompetitorIntelligence({
      decisions: [
        makeDecision({
          id: 'legacy-evidence-1',
          issueType: 'competitor_content_gap',
          title: 'Legacy competitor evidence should not inject output competitors',
          description: 'A raw decision payload names an irrelevant staffing business.',
          recommendation: 'Validate all competitor mentions through the engine.',
          actionPayload: {
            competitor_name: 'Optimal Virtual Employee',
            leading_competitors: ['optimalvirtualemployee.com'],
          },
        }),
      ],
      resolvedInput,
    });

    const names = intelligence.detected_competitors.map((item) => item.name);
    // Evidence-only: engine-validated manual competitors survive; irrelevant ones are filtered.
    // (No hardcoded/KB padding — the surviving set is whatever passes the engine gate.)
    expect(names).toEqual(expect.arrayContaining(['Wysa', 'Woebot Health']));
    expect(names).not.toContain('Optimal Virtual Employee');
    expect(names).not.toContain('Headspace');
    expect(intelligence.detected_competitors.every((item) => item.source === 'manual')).toBe(true);
    expect(intelligence.detected_competitors.some((item) => item.discoverySources?.includes('manual'))).toBe(true);
    expect(intelligence.detected_competitors.every((item) => item.score_card?.dimensions && item.score_card.discoverySources?.length)).toBe(true);
    assertNoMarketSubstituteCompetitors(intelligence.detected_competitors as any[]);
    expect((intelligence.market_alternatives ?? []).length).toBeLessThanOrEqual(3);
    if ((intelligence.market_alternatives ?? []).length > 0) {
      assertOnlyMarketSubstituteAlternatives((intelligence.market_alternatives ?? []) as any[]);
    }
    assertValidCompetitorList(intelligence.detected_competitors as any[]);
    assertSortedByTierThenScore(intelligence.detected_competitors as any[]);
    expect(intelligence.competitive_summary.top_threats.length).toBeGreaterThanOrEqual(1);
    expect(intelligence.competitive_summary.key_advantage).toContain('Drishik');
    expect(intelligence.competitive_summary.positioning_statement).toContain('Wysa');
    expect(intelligence.generated_gaps.length).toBeGreaterThanOrEqual(1);
    const finalKeys = new Set(intelligence.detected_competitors.flatMap((item) => [item.name.toLowerCase(), item.domain?.toLowerCase() ?? '']));
    expect(intelligence.generated_gaps.every((gap) =>
      gap.leading_competitors.every((competitor) => finalKeys.has(competitor.toLowerCase())),
    )).toBe(true);
  });

  it('enriches, scores, and filters manual competitor input before output', () => {
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
      resolvedInput: makeResolvedInput({ competitors: ['Wysa', 'Woebot Health', 'Reflectly'] }),
    });

    // Evidence-only: manual competitors are enriched, scored, and gate-filtered on their own
    // merits (no KB padding to force a count). Survivors are all manual-sourced.
    expect(intelligence.detected_competitors.length).toBeGreaterThanOrEqual(2);
    expect(intelligence.detected_competitors.length).toBeLessThanOrEqual(3);
    expect(intelligence.detected_competitors.every((item) => item.source === 'manual')).toBe(true);
    expect(intelligence.detected_competitors.some((item) => item.discoverySources?.includes('manual'))).toBe(true);
    expect(intelligence.detected_competitors.every((item) => item.score_card?.dimensions && item.score_card.discoverySources?.length)).toBe(true);
    assertValidCompetitorList(intelligence.detected_competitors as any[]);
    expect(intelligence.detected_competitors.every((item) => item.enrichment_confidence_score >= 0.6)).toBe(true);
    expect(intelligence.detected_competitors.every((item) => item.positioning.differentiation.length > 20)).toBe(true);
    expect(intelligence.competitive_summary.key_risk.length).toBeGreaterThan(20);
  }, 90000);

  it('converts strongest gaps into snapshot decision objects and exposes them in the report payload', async () => {
    const resolvedInput = makeResolvedInput({ competitors: ['Wysa', 'Headspace', 'Calm'] });
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
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'company-1',
      snapshotDecisions: [],
      resolvedInput,
      competitorIntelligenceOverride: intelligence,
    });

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0]?.source_service).toBe('reportCompetitorIntelligenceService');
    expect(report.competitor_intelligence.detected_competitors.length).toBeGreaterThanOrEqual(1);
    assertValidCompetitorList(report.competitor_intelligence.detected_competitors as any[]);
    assertSortedByTierThenScore(report.competitor_intelligence.detected_competitors as any[]);
    expect(report.competitor_intelligence.competitive_summary.top_threats.length).toBeGreaterThanOrEqual(1);
    expect(report.pipeline_audit.competitor_gap_decisions_added).toBeGreaterThanOrEqual(1);
    expect(report.summary.toLowerCase()).toContain('content coverage');
  }, 90000);

  it('returns an honest empty-state (no hardcoded/KB padding) when there is no manual input or live SERP', async () => {
    const baseline = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeResolvedInput({ competitors: [] }),
    });
    const intelligence = await buildCompetitorIntelligenceActive({
      companyId: 'company-1',
      decisions: [],
      resolvedInput: makeResolvedInput({ competitors: [] }),
    });

    // Evidence-only: with no manual competitors and no live SERP domains, competitors are NEVER
    // fabricated from the knowledge base or a keyword→company map. The result is empty but valid,
    // and the honest evidence status is surfaced.
    expect(baseline.detected_competitors).toHaveLength(0);
    expect(intelligence.detected_competitors).toHaveLength(0);
    expect(baseline.detected_competitors.some((item) => item.source === 'known_category_dataset')).toBe(false);
    expect(intelligence.detected_competitors.some((item) => item.source === 'known_category_dataset')).toBe(false);
    expect(baseline.discovery_metadata?.competitor_evidence_status).toBe('insufficient_public_data');
    expect(intelligence.discovery_metadata?.competitor_evidence_status).toBe('insufficient_public_data');
    // Empty result is still structurally valid — no throw, no crash.
    expect(baseline.competitors_by_tier).toBeDefined();
    expect(Array.isArray(baseline.generated_gaps)).toBe(true);
    expect(typeof intelligence.summary).toBe('string');
  }, 90000);

  it('degrades report strategy layers gracefully (no HubSpot/KB injection) when no competitors are discovered', () => {
    const omnivyra = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeResolvedInput({
        companyName: 'Omnivyra',
        websiteDomain: 'omnivyra.com',
        businessType: 'AI marketing automation and growth intelligence',
        competitors: [],
        companyContext: {
          marketFocus: 'AI marketing automation and growth intelligence',
          productServices: ['AI campaign planning', 'marketing automation', 'SEO intelligence'],
          targetCustomer: 'B2B founders, marketers, and lean growth teams',
          idealCustomerProfile: 'lean B2B teams managing campaigns and revenue growth',
          brandPositioning: 'AI-powered marketing operations and growth intelligence platform',
          competitiveAdvantages: 'unified campaign planning and competitor intelligence',
          teamSize: '1-10',
          foundedYear: '2025',
          revenueRange: 'Pre-revenue',
        },
      }),
    });

    // No manual/SERP evidence → no competitors, and NO hardcoded HubSpot/Salesforce/Adobe injection.
    expect(omnivyra.detected_competitors).toHaveLength(0);
    expect(omnivyra.detected_competitors.some((item) => item.name === 'HubSpot')).toBe(false);
    expect(omnivyra.discovery_metadata?.competitor_evidence_status).toBe('insufficient_public_data');

    // Downstream battle-card / positioning / strategy builders must not crash on an empty set.
    const snapshot = buildCompetitiveSnapshotReport(omnivyra);
    expect(snapshot.competitors).toHaveLength(0);
    const pressure = buildCompetitivePressureAnalysis(omnivyra);
    expect(pressure.competitors).toHaveLength(0);
    expect(pressure.competitors.some((competitor) => competitor.name === 'HubSpot')).toBe(false);
    const strategy = buildCompetitiveStrategyMap(omnivyra);
    expect(strategy.competitive_strategy_map.tier_breakdown.tier_1).toHaveLength(0);
  }, 90000);
});
