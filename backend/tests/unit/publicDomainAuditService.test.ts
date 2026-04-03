const mockFrom = jest.fn();

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';

function makeBuilder(data: unknown, error: { message: string } | null = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data, error }),
    in: jest.fn().mockResolvedValue({ data, error }),
  };
}

describe('publicDomainAuditService', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('turns public crawl data into positioning, conversion, trust, and AEO decisions', async () => {
    const pagesQuery = makeBuilder([
      {
        id: 'page-home',
        url: 'https://example.com/',
        page_type: 'home',
        title: 'Example Platform',
        meta_title: 'Example Platform',
        meta_description: 'Platform for teams.',
        headings: [{ level: 1, text: 'Work better' }],
        ctas: [{ text: 'Learn more', href: 'https://example.com/features' }],
        internal_link_count: 1,
        http_status: 200,
        crawl_depth: 0,
        crawl_metadata: {},
      },
      {
        id: 'page-feature',
        url: 'https://example.com/features',
        page_type: 'feature',
        title: 'Features',
        meta_title: 'Features',
        meta_description: 'See features.',
        headings: [{ level: 1, text: 'Features' }],
        ctas: [],
        internal_link_count: 1,
        http_status: 200,
        crawl_depth: 1,
        crawl_metadata: {},
      },
    ]);
    const contentQuery = makeBuilder([
      { page_id: 'page-home', block_type: 'paragraph', content_text: 'Simple platform for teams.', heading_level: null },
      { page_id: 'page-feature', block_type: 'paragraph', content_text: 'Feature overview. Learn how it works.', heading_level: null },
    ]);
    const linksQuery = makeBuilder([
      { from_page_id: 'page-home', to_page_id: 'page-feature', to_url: 'https://example.com/features', anchor_text: 'Features', is_internal: true },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'canonical_pages') return pagesQuery;
      if (table === 'page_content') return contentQuery;
      if (table === 'page_links') return linksQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await buildPublicDomainAuditDecisions({
      companyId: '11111111-1111-1111-1111-111111111111',
      reportTier: 'snapshot',
      resolvedInput: {
        companyId: '11111111-1111-1111-1111-111111111111',
        reportCategory: 'snapshot',
        profile: null,
        requestPayload: {},
        defaults: {
          company_name: null,
          website_domain: 'example.com',
          business_type: 'B2B SaaS',
          geography: 'United States',
          social_links: [],
          competitors: [],
        },
        resolved: {
          companyName: null,
          websiteDomain: 'example.com',
          businessType: 'B2B SaaS',
          geography: 'United States',
          socialLinks: [],
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

    const issueTypes = result.decisions.map((decision) => decision.issue_type);
    expect(result.site_structure.homepage).toBe('https://example.com/');
    expect(Array.isArray(result.geo_aeo_context.queries)).toBe(true);
    expect(Array.isArray(result.geo_aeo_context.entities)).toBe(true);
    expect(issueTypes).toContain('intent_gap');
    expect(issueTypes).toContain('cta_clarity_gap');
    expect(issueTypes).toContain('content_gap');
    expect(issueTypes).toContain('credibility_gap');
    expect(issueTypes).toContain('seo_gap');
  });

  it('detects thin metadata, thin pages, crawlability issues, and weak geo targeting from crawl data', async () => {
    const pagesQuery = makeBuilder([
      {
        id: 'page-home',
        url: 'https://example.com/',
        page_type: 'home',
        title: 'Example',
        meta_title: '',
        meta_description: '',
        headings: [],
        ctas: [{ text: 'Contact', href: 'https://example.com/contact' }],
        internal_link_count: 1,
        http_status: 200,
        crawl_depth: 0,
        crawl_metadata: {},
      },
      {
        id: 'page-pricing',
        url: 'https://example.com/pricing',
        page_type: 'pricing',
        title: 'Pricing',
        meta_title: 'Pricing',
        meta_description: 'Short.',
        headings: [{ level: 2, text: 'Plans' }],
        ctas: [],
        internal_link_count: 0,
        http_status: 404,
        crawl_depth: 1,
        crawl_metadata: {},
      },
      {
        id: 'page-city',
        url: 'https://example.com/coverage',
        page_type: 'landing',
        title: 'United States Service Coverage',
        meta_title: 'Pricing',
        meta_description: 'Short.',
        headings: [{ level: 2, text: 'United States Coverage' }],
        ctas: [],
        internal_link_count: 0,
        http_status: 200,
        crawl_depth: 1,
        crawl_metadata: {},
      },
    ]);
    const contentQuery = makeBuilder([
      { page_id: 'page-home', block_type: 'paragraph', content_text: 'Home copy only.', heading_level: null },
      { page_id: 'page-pricing', block_type: 'paragraph', content_text: 'Pricing summary.', heading_level: null },
      { page_id: 'page-city', block_type: 'paragraph', content_text: 'Location summary.', heading_level: null },
    ]);
    const linksQuery = makeBuilder([]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'canonical_pages') return pagesQuery;
      if (table === 'page_content') return contentQuery;
      if (table === 'page_links') return linksQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await buildPublicDomainAuditDecisions({
      companyId: '11111111-1111-1111-1111-111111111111',
      reportTier: 'snapshot',
      resolvedInput: {
        companyId: '11111111-1111-1111-1111-111111111111',
        reportCategory: 'snapshot',
        profile: null,
        requestPayload: {},
        defaults: {
          company_name: null,
          website_domain: 'example.com',
          business_type: 'Local Services',
          geography: 'United States',
          social_links: [],
          competitors: [],
        },
        resolved: {
          companyName: null,
          websiteDomain: 'example.com',
          businessType: 'Local Services',
          geography: 'United States',
          socialLinks: [],
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

    const titles = result.decisions.map((decision) => decision.title);
    expect(titles).toContain('Metadata coverage is too weak to support strong search visibility');
    expect(titles).toContain('Core pages are too thin or weakly structured to perform well in search');
    expect(titles).toContain('Technical crawlability and internal linking are leaving pages under-supported');
    expect(titles).toContain('Location pages exist but are not clearly targeted enough for local search');
  });
});
