import axios from 'axios';
import { supabase } from '../../db/supabaseClient';
import { composeSnapshotReport } from '../../services/snapshotReportService';

type ValidationSummary = {
  key_present: boolean;
  key_source: 'SERPAPI_API_KEY' | 'SERP_API_KEY' | 'SERPAPI_KEY' | 'none';
  serp_probe: {
    ok: boolean;
    status: number | null;
    organic_results: number;
    error: string | null;
  };
  generated: Array<{
    id: string;
    domain: string;
    discovery_metadata: {
      serp_status: 'live' | 'fallback';
      serp_domains_found: number;
      is_fallback_used: boolean;
      keyword_count: number;
    } | null;
    competitor_domains: string[];
    keyword_gap_sizes: {
      missing: number;
      weak: number;
      strong: number;
    };
    radar_competitor_count: number;
  }>;
  fallback_usage_pct_new: number;
  before_vs_after: {
    previous_fallback_usage_pct: number | null;
    previous_avg_keyword_gap_missing: number | null;
    current_avg_keyword_gap_missing: number | null;
  };
};

function buildResolvedInput(params: {
  companyId: string;
  domain: string;
  businessType: string;
  geography: string;
}) {
  return {
    companyId: params.companyId,
    reportCategory: 'snapshot',
    profile: null,
    requestPayload: {},
    defaults: {
      company_name: null,
      website_domain: params.domain,
      business_type: params.businessType,
      geography: params.geography,
      social_links: [],
      competitors: [],
    },
    resolved: {
      companyName: null,
      websiteDomain: params.domain,
      businessType: params.businessType,
      geography: params.geography,
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
  };
}

describe('live SERP validation', () => {
  it('validates live competitor discovery for calendly and hubspot', async () => {
    const key =
      process.env.SERPAPI_API_KEY ||
      process.env.SERP_API_KEY ||
      process.env.SERPAPI_KEY ||
      '';
    const keySource: ValidationSummary['key_source'] =
      process.env.SERPAPI_API_KEY
        ? 'SERPAPI_API_KEY'
        : process.env.SERP_API_KEY
          ? 'SERP_API_KEY'
          : process.env.SERPAPI_KEY
            ? 'SERPAPI_KEY'
            : 'none';

    const serpProbe: ValidationSummary['serp_probe'] = {
      ok: false,
      status: null,
      organic_results: 0,
      error: null,
    };

    if (key) {
      try {
        const probe = await axios.get('https://serpapi.com/search.json', {
          params: {
            engine: 'google',
            q: 'calendly',
            num: 5,
            api_key: key,
          },
          timeout: 12000,
        });
        const organic = Array.isArray(probe.data?.organic_results) ? probe.data.organic_results : [];
        serpProbe.ok = probe.status === 200;
        serpProbe.status = probe.status;
        serpProbe.organic_results = organic.length;
      } catch (error: any) {
        serpProbe.ok = false;
        serpProbe.status = error?.response?.status ?? null;
        serpProbe.error = error?.response?.data?.error ?? error?.message ?? 'SERP probe failed';
      }
    } else {
      serpProbe.error = 'No SERP key found';
    }

    const membershipRes = await supabase
      .from('user_company_roles')
      .select('company_id, user_id')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const membership = membershipRes.data;
    expect(membership?.company_id).toBeTruthy();
    expect(membership?.user_id).toBeTruthy();

    const companyId = String(membership!.company_id);
    const userId = String(membership!.user_id);

    const domains = [
      { domain: 'calendly.com', businessType: 'SaaS / Scheduling', geography: 'United States' },
      { domain: 'hubspot.com', businessType: 'Marketing Software', geography: 'United States' },
    ];

    const generated: ValidationSummary['generated'] = [];
    const now = Date.now();

    for (let index = 0; index < domains.length; index += 1) {
      const target = domains[index];
      const composed = await composeSnapshotReport(companyId, {
        resolvedInput: buildResolvedInput({
          companyId,
          domain: target.domain,
          businessType: target.businessType,
          geography: target.geography,
        }) as any,
      });

      const createdAt = new Date(now + index * 1000).toISOString();
      const insertRes = await supabase
        .from('reports')
        .insert({
          company_id: companyId,
          user_id: userId,
          domain: target.domain,
          is_free: false,
          report_type: 'content_readiness',
          status: 'completed',
          created_at: createdAt,
          completed_at: createdAt,
          metadata: {
            requested_report_category: 'snapshot',
            validation_run: true,
            generated_for: 'live_serp_validation',
          },
          data: {
            generated_at: createdAt,
            engine_version: 'v1',
            report_id: `live_serp_${target.domain}_${createdAt}`,
            domain: target.domain,
            report_type: 'content_readiness',
            requested_category: 'snapshot',
            composed_report: composed,
          },
        })
        .select('id')
        .single();

      const competitorDomains = (composed?.competitor_intelligence?.detected_competitors ?? [])
        .map((item: any) => item?.domain)
        .filter(Boolean);
      const keywordGap = composed?.competitor_visuals?.keyword_gap_analysis ?? {};

      generated.push({
        id: String(insertRes.data?.id ?? ''),
        domain: target.domain,
        discovery_metadata: composed?.competitor_intelligence?.discovery_metadata ?? null,
        competitor_domains: [...new Set(competitorDomains)],
        keyword_gap_sizes: {
          missing: Array.isArray(keywordGap.missing_keywords) ? keywordGap.missing_keywords.length : 0,
          weak: Array.isArray(keywordGap.weak_keywords) ? keywordGap.weak_keywords.length : 0,
          strong: Array.isArray(keywordGap.strong_keywords) ? keywordGap.strong_keywords.length : 0,
        },
        radar_competitor_count: Array.isArray(composed?.competitor_visuals?.competitor_positioning_radar?.competitors)
          ? composed.competitor_visuals.competitor_positioning_radar.competitors.length
          : 0,
      });
    }

    const fallbackNew = generated.filter((item) => item.discovery_metadata?.is_fallback_used === true).length;
    const fallbackUsagePctNew = generated.length > 0
      ? Number(((fallbackNew / generated.length) * 100).toFixed(1))
      : 0;

    const previousRowsRes = await supabase
      .from('reports')
      .select('data')
      .eq('company_id', companyId)
      .eq('report_type', 'content_readiness')
      .eq('status', 'completed')
      .contains('metadata', { requested_report_category: 'snapshot' })
      .neq('metadata->>generated_for', 'live_serp_validation')
      .order('created_at', { ascending: false })
      .limit(20);

    const previousRows = (previousRowsRes.data ?? []) as Array<{ data: any }>;
    const previousFallbackCount = previousRows.filter((row) => {
      const metadata = row.data?.composed_report?.competitor_intelligence?.discovery_metadata;
      return metadata?.is_fallback_used === true || metadata?.serp_status === 'fallback';
    }).length;
    const previousFallbackPct = previousRows.length > 0
      ? Number(((previousFallbackCount / previousRows.length) * 100).toFixed(1))
      : null;
    const previousMissingAvg = previousRows.length > 0
      ? Number((
          previousRows.reduce((sum, row) => {
            const list = row.data?.composed_report?.competitor_visuals?.keyword_gap_analysis?.missing_keywords;
            return sum + (Array.isArray(list) ? list.length : 0);
          }, 0) / previousRows.length
        ).toFixed(2))
      : null;
    const currentMissingAvg = generated.length > 0
      ? Number((generated.reduce((sum, item) => sum + item.keyword_gap_sizes.missing, 0) / generated.length).toFixed(2))
      : null;

    const summary: ValidationSummary = {
      key_present: Boolean(key),
      key_source: keySource,
      serp_probe: serpProbe,
      generated,
      fallback_usage_pct_new: fallbackUsagePctNew,
      before_vs_after: {
        previous_fallback_usage_pct: previousFallbackPct,
        previous_avg_keyword_gap_missing: previousMissingAvg,
        current_avg_keyword_gap_missing: currentMissingAvg,
      },
    };

    console.log(JSON.stringify(summary, null, 2));

    expect(summary.key_present).toBe(true);
    expect(summary.serp_probe.status).not.toBe(401);
    expect(generated.length).toBe(2);
  }, 240000);
});
