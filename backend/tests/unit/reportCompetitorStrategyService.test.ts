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
  it('builds strategy layers over evidence-only competitors and injects no hardcoded HubSpot/Adobe', () => {
    // No manual competitors and no live SERP (sync path) → evidence-only means an empty competitor
    // set. The former HubSpot/Adobe Marketo keyword-injection is gone; strategy layers still render.
    const intelligence = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeOmnivyraInput(),
    });

    assertValidCompetitorList(intelligence.detected_competitors as any[]);
    expect(intelligence.detected_competitors).toHaveLength(0);
    expect(intelligence.detected_competitors.some((item) => item.name === 'HubSpot')).toBe(false);
    expect(intelligence.discovery_metadata?.competitor_evidence_status).toBe('insufficient_public_data');

    const snapshot = buildCompetitiveSnapshotReport(intelligence);
    expect(snapshot.competitors).toHaveLength(0);
    expect(snapshot.competitive_snapshot_summary.top_threat).not.toBe('HubSpot');

    const pressure = buildCompetitivePressureAnalysis(intelligence);
    expect(pressure.competitors.some((item) => item.name === 'HubSpot')).toBe(false);

    const growth = buildCompetitiveStrategyMap(intelligence);
    expect(growth.competitive_strategy_map.tier_breakdown.tier_1.some((item) => item.name === 'HubSpot')).toBe(false);
    // Company-derived strategic position is independent of competitor evidence and still renders.
    expect(growth.strategic_position.positioning_statement).toContain('Omnivyra');
    expect(growth.strategic_position.messaging_angle).toContain('Omnivyra');
  });

  it('does not fabricate a Wysa competitor for Drishiq when there is no manual/SERP evidence', () => {
    const intelligence = buildCompetitorIntelligence({
      decisions: [],
      resolvedInput: makeDrishiqInput(),
    });

    assertValidCompetitorList(intelligence.detected_competitors as any[]);
    // Wysa used to be injected from the knowledge base by keyword-match. Evidence-only: no Wysa.
    expect(intelligence.detected_competitors).toHaveLength(0);
    expect(intelligence.detected_competitors.some((item) => item.name === 'Wysa')).toBe(false);
    expect(intelligence.discovery_metadata?.competitor_evidence_status).toBe('insufficient_public_data');

    const snapshot = buildCompetitiveSnapshotReport(intelligence);
    expect(snapshot.competitors).toHaveLength(0);
    expect(snapshot.competitive_snapshot_summary.top_threat).not.toBe('Wysa');
    expect(snapshot.competitive_snapshot_summary.immediate_positioning_angle).toContain('Drishiq');
  });
});
