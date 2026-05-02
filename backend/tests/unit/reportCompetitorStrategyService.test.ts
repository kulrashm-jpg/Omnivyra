jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

jest.mock('axios', () => ({
  get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })),
}));

import type { ResolvedReportInput } from '../../services/reportInputResolver';
import { buildCompetitorIntelligence } from '../../services/reportCompetitorIntelligenceService';
import {
  buildCompetitivePressureAnalysis,
  buildCompetitiveSnapshotReport,
  buildCompetitiveStrategyMap,
} from '../../services/reportCompetitorStrategyService';
import { assertValidCompetitorList } from '../helpers/assertValidCompetitor';

function makeOmnivyraInput(): ResolvedReportInput {
  return {
    companyId: 'omnivyra-company',
    reportCategory: 'growth',
    profile: {
      company_id: 'omnivyra-company',
      name: 'Omnivyra',
      category: 'AI marketing command center',
      industry: 'AI marketing automation and growth intelligence',
      website_url: 'https://www.omnivyra.com',
      products_services: 'AI marketing command center for campaign planning, SEO, lead generation, and revenue growth',
      products_services_list: ['AI campaign planning', 'marketing automation', 'SEO intelligence', 'lead generation workflows'],
      target_audience: 'B2B founders, marketers, and lean growth teams',
      ideal_customer_profile: 'lean B2B SaaS and service teams managing campaigns and growth execution',
      brand_positioning: 'AI-powered marketing operations and growth intelligence platform',
      competitive_advantages: 'unified campaign planning, competitor intelligence, execution recommendations',
    } as any,
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
      companyName: 'Omnivyra',
      websiteDomain: 'www.omnivyra.com',
      businessType: 'AI marketing automation and growth intelligence',
      geography: 'Global',
      socialLinks: [],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI marketing automation and growth intelligence',
        productServices: ['AI campaign planning', 'marketing automation', 'SEO intelligence'],
        targetCustomer: 'B2B founders, marketers, and lean growth teams',
        idealCustomerProfile: 'lean B2B SaaS and service teams managing campaigns and growth execution',
        brandPositioning: 'AI-powered marketing operations and growth intelligence platform',
        competitiveAdvantages: 'unified campaign planning, competitor intelligence, execution recommendations',
        teamSize: '1-10',
        foundedYear: '2025',
        revenueRange: 'Pre-revenue',
      },
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
      manual_entry: { connected: true, source: 'system', label: 'Manual Data Entry' },
    },
  };
}

function makeDrishiqInput(): ResolvedReportInput {
  return {
    companyId: 'drishiq-company',
    reportCategory: 'snapshot',
    profile: {
      company_id: 'drishiq-company',
      name: 'Drishiq',
      category: 'AI clarity platform',
      industry: 'AI wellness and decision intelligence',
      website_url: 'https://www.drishiq.com',
      products_services: 'AI clarity engine for self-reflection, emotional wellbeing, and life decisions',
      products_services_list: ['AI clarity engine', 'self-reflection guidance', 'emotional wellbeing decision support'],
      target_audience: 'individuals seeking personal clarity and guided self-reflection',
      ideal_customer_profile: 'adults seeking private emotional support and structured wellbeing guidance',
      brand_positioning: 'AI-guided personal clarity and self-reflection support',
      competitive_advantages: 'private reflection, decision clarity, emotionally aware guidance',
    } as any,
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
      companyName: 'Drishiq',
      websiteDomain: 'www.drishiq.com',
      businessType: 'AI wellness and decision intelligence',
      geography: 'Global',
      socialLinks: [],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: 'AI wellness and decision intelligence',
        productServices: ['AI clarity engine', 'self-reflection guidance', 'emotional wellbeing decision support'],
        targetCustomer: 'individuals seeking personal clarity and guided self-reflection',
        idealCustomerProfile: 'adults seeking private emotional support and structured wellbeing guidance',
        brandPositioning: 'AI-guided personal clarity and self-reflection support',
        competitiveAdvantages: 'private reflection, decision clarity, emotionally aware guidance',
        teamSize: '1-10',
        foundedYear: '2024',
        revenueRange: 'Pre-revenue',
      },
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

describe('reportCompetitorStrategyService', () => {
  it('builds light, diagnostic, and strategic report layers from final competitor intelligence', () => {
    const intelligence = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeOmnivyraInput(),
    });

    assertValidCompetitorList(intelligence.detected_competitors as any[]);

    const snapshot = buildCompetitiveSnapshotReport(intelligence);
    expect(snapshot.competitors).toHaveLength(3);
    expect(snapshot.competitors.every((item) => item.tier && item.threat_level && item.differentiation)).toBe(true);
    expect(snapshot.competitive_snapshot_summary.top_threat).toBe('HubSpot');
    expect(snapshot.competitive_snapshot_summary.action).toContain('HubSpot');

    const pressure = buildCompetitivePressureAnalysis(intelligence);
    const hubSpotPressure = pressure.competitors.find((item) => item.name === 'HubSpot');
    expect(hubSpotPressure?.threat_level).toBe('high');
    expect(hubSpotPressure?.authority_score).toBeGreaterThan(0.7);
    expect(hubSpotPressure?.pressure_on).toEqual(expect.arrayContaining(['SEO', 'Brand authority']));
    expect(pressure.competitors.every((item) => item.action.length > 20)).toBe(true);
    expect(pressure.summary.next_action).toContain('HubSpot');

    const growth = buildCompetitiveStrategyMap(intelligence);
    expect(growth.competitive_strategy_map.tier_breakdown.tier_1.map((item) => item.name)).toEqual(
      expect.arrayContaining(['HubSpot', 'Salesforce']),
    );
    expect(growth.competitive_strategy_map.strategic_actions.how_to_beat_tier_1).toContain('HubSpot');
    expect(growth.competitive_strategy_map.opportunity_map.weak_competitor_areas.length).toBeGreaterThan(0);
    expect(growth.competitive_strategy_map.strategic_actions.how_to_differentiate_from_tier_2.length).toBeGreaterThan(20);
    expect(growth.competitive_strategy_map.strategic_actions.how_to_ignore_tier_3.length).toBeGreaterThan(20);
    expect(growth.strategic_position.positioning_statement).toContain('Omnivyra');
    expect(growth.strategic_position.primary_battlefield.length).toBeGreaterThan(20);
    expect(growth.strategic_position.avoidance_zone.length).toBeGreaterThan(20);
    expect(growth.strategic_position.messaging_angle).toContain('Omnivyra');
  });

  it('keeps Drishiq snapshot intelligence focused on Wysa without manual competitors', () => {
    const intelligence = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeDrishiqInput(),
    });

    assertValidCompetitorList(intelligence.detected_competitors as any[]);

    const snapshot = buildCompetitiveSnapshotReport(intelligence);
    const pressure = buildCompetitivePressureAnalysis(intelligence);
    const wysaPressure = pressure.competitors.find((item) => item.name === 'Wysa');

    expect(snapshot.competitive_snapshot_summary.top_threat).toBe('Wysa');
    expect(snapshot.competitors[0]).toMatchObject({
      name: 'Wysa',
      tier: 'Tier 1',
      threat_level: 'high',
    });
    expect(wysaPressure?.threat_level).toBe('high');
    expect(wysaPressure?.pressure_on).toEqual(expect.arrayContaining(['Conversion', 'AI visibility']));
    expect(snapshot.competitive_snapshot_summary.immediate_positioning_angle).toContain('Drishiq');
  });
});
