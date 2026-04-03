import { supabase } from '../../db/supabaseClient';
import { composeSnapshotReport } from '../../services/snapshotReportService';

type GeneratedRow = {
  id: string;
  domain: string;
  created_at: string;
  data: {
    composed_report?: any;
  } | null;
  metadata: Record<string, unknown> | null;
};

function buildResolvedInput(params: {
  companyId: string;
  domain: string;
  businessType: string;
  geography: string;
  competitors?: string[];
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
      competitors: params.competitors ?? [],
    },
    resolved: {
      companyName: null,
      websiteDomain: params.domain,
      businessType: params.businessType,
      geography: params.geography,
      socialLinks: [],
      competitors: params.competitors ?? [],
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

function isSnapshotRow(row: { report_type: string; metadata: Record<string, unknown> | null }): boolean {
  if (row.report_type === 'snapshot') return true;
  if (row.report_type !== 'content_readiness') return false;
  return String(row.metadata?.requested_report_category ?? 'snapshot') === 'snapshot';
}

function countNotAvailableSignals(report: any): number {
  const seo = report?.visual_intelligence ?? {};
  const geo = report?.geo_aeo_visuals ?? {};
  const values: Array<unknown> = [
    seo?.seo_capability_radar?.technical_seo_score,
    seo?.seo_capability_radar?.keyword_research_score,
    seo?.seo_capability_radar?.rank_tracking_score,
    seo?.seo_capability_radar?.backlinks_score,
    seo?.seo_capability_radar?.competitor_intelligence_score,
    seo?.seo_capability_radar?.content_quality_score,
    seo?.search_visibility_funnel?.impressions,
    seo?.search_visibility_funnel?.clicks,
    seo?.search_visibility_funnel?.ctr,
    seo?.search_visibility_funnel?.estimated_lost_clicks,
    geo?.ai_answer_presence_radar?.answer_coverage_score,
    geo?.ai_answer_presence_radar?.entity_clarity_score,
    geo?.ai_answer_presence_radar?.topical_authority_score,
    geo?.ai_answer_presence_radar?.citation_readiness_score,
    geo?.ai_answer_presence_radar?.content_structure_score,
    geo?.ai_answer_presence_radar?.freshness_score,
    geo?.answer_extraction_funnel?.total_queries,
    geo?.answer_extraction_funnel?.answerable_content_pct,
    geo?.answer_extraction_funnel?.structured_content_pct,
    geo?.answer_extraction_funnel?.citation_ready_pct,
  ];
  return values.filter((value) => value == null).length;
}

describe('manual snapshot activation validation', () => {
  it(
    'generates fresh snapshots and validates activation signals',
    async () => {
      const baseRowsRes = await supabase
        .from('reports')
        .select('id, report_type, metadata, data, created_at')
        .eq('report_type', 'content_readiness')
        .order('created_at', { ascending: false })
        .limit(80);

      const baseRows = (baseRowsRes.data ?? []) as Array<{
        id: string;
        report_type: string;
        metadata: Record<string, unknown> | null;
        data: any;
        created_at: string;
      }>;

      const beforeSnapshots = baseRows.filter((row) => isSnapshotRow(row));
      const beforeFallbackCount = beforeSnapshots.filter((row) => {
        const metadata = row.data?.composed_report?.competitor_intelligence?.discovery_metadata;
        return metadata?.is_fallback_used === true || metadata?.serp_status === 'fallback';
      }).length;
      const beforeNullSignals = beforeSnapshots.reduce((sum, row) => {
        return sum + countNotAvailableSignals(row.data?.composed_report);
      }, 0);
      const beforeAvgNullSignals = beforeSnapshots.length > 0
        ? Number((beforeNullSignals / beforeSnapshots.length).toFixed(2))
        : null;

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

      const targets = [
        { domain: 'hubspot.com', businessType: 'Marketing Software', geography: 'United States' },
        { domain: 'calendly.com', businessType: 'SaaS / Scheduling', geography: 'United States' },
        { domain: 'carrd.co', businessType: 'Website Builder', geography: 'Global' },
      ];

      const generated: GeneratedRow[] = [];
      const now = Date.now();
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const composed = await composeSnapshotReport(companyId, {
          resolvedInput: buildResolvedInput({
            companyId,
            domain: target.domain,
            businessType: target.businessType,
            geography: target.geography,
          }) as any,
        });

        const createdAt = new Date(now + index * 2000).toISOString();
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
              generated_for: 'manual_activation_check',
            },
            data: {
              generated_at: createdAt,
              engine_version: 'v1',
              report_id: `validation_${target.domain}_${createdAt}`,
              domain: target.domain,
              report_type: 'content_readiness',
              requested_category: 'snapshot',
              composed_report: composed,
            },
          })
          .select('id, domain, created_at, data, metadata')
          .single();

        expect(insertRes.data?.id).toBeTruthy();
        generated.push(insertRes.data as GeneratedRow);
      }

      // Re-run same domain 2 more times to activate time-series chain.
      for (let rerun = 0; rerun < 2; rerun += 1) {
        const target = targets[1]; // calendly.com
        const composed = await composeSnapshotReport(companyId, {
          resolvedInput: buildResolvedInput({
            companyId,
            domain: target.domain,
            businessType: target.businessType,
            geography: target.geography,
          }) as any,
        });

        const createdAt = new Date(now + (targets.length + rerun) * 2000).toISOString();
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
              generated_for: 'manual_activation_check',
            },
            data: {
              generated_at: createdAt,
              engine_version: 'v1',
              report_id: `validation_rerun_${target.domain}_${createdAt}`,
              domain: target.domain,
              report_type: 'content_readiness',
              requested_category: 'snapshot',
              composed_report: composed,
            },
          })
          .select('id, domain, created_at, data, metadata')
          .single();

        expect(insertRes.data?.id).toBeTruthy();
        generated.push(insertRes.data as GeneratedRow);
      }

      const generatedReports = generated.map((row) => row.data?.composed_report).filter(Boolean);
      const liveSerpCount = generatedReports.filter((report: any) => report?.competitor_intelligence?.discovery_metadata?.serp_status === 'live').length;
      const fallbackCount = generatedReports.filter((report: any) => report?.competitor_intelligence?.discovery_metadata?.is_fallback_used === true).length;
      const fallbackUsagePct = generatedReports.length > 0
        ? Number(((fallbackCount / generatedReports.length) * 100).toFixed(1))
        : 0;
      const realDomainCompetitors = generatedReports.flatMap((report: any) =>
        (report?.competitor_intelligence?.detected_competitors ?? []).map((item: any) => item?.domain).filter(Boolean),
      );
      const uniqueRealDomains = [...new Set(realDomainCompetitors)];
      const narrativeFallbackCount = generatedReports.filter((report: any) => {
        const text = String(report?.competitor_intelligence_summary?.competitor_explanation ?? '');
        return text.includes('Insights are based on limited available signals');
      }).length;

      const afterNullSignals = generatedReports.reduce((sum, report: any) => sum + countNotAvailableSignals(report), 0);
      const afterAvgNullSignals = generatedReports.length > 0
        ? Number((afterNullSignals / generatedReports.length).toFixed(2))
        : null;

      const calendlyRowsRes = await supabase
        .from('reports')
        .select('id, created_at, report_type, metadata')
        .eq('company_id', companyId)
        .eq('domain', 'calendly.com')
        .in('report_type', ['snapshot', 'content_readiness'])
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(20);
      const calendlyRows = (calendlyRowsRes.data ?? []) as Array<{
        id: string;
        created_at: string;
        report_type: string;
        metadata: Record<string, unknown> | null;
      }>;
      const calendlySnapshotRows = calendlyRows.filter(isSnapshotRow);

      console.log(
        JSON.stringify(
          {
            generated_report_ids: generated.map((row) => row.id),
            generated_domains: generated.map((row) => row.domain),
            sample_competitor_domains_real: uniqueRealDomains.slice(0, 10),
            discovery_metadata: generatedReports.map((report: any) => ({
              domain: report?.input_context?.resolved?.websiteDomain ?? null,
              discovery_metadata: report?.competitor_intelligence?.discovery_metadata ?? null,
            })),
            fallback_usage_pct_new_reports: fallbackUsagePct,
            serp_live_reports: liveSerpCount,
            narrative_fallback_reports: narrativeFallbackCount,
            trust_proxy_before_after: {
              before_avg_null_signals_per_report: beforeAvgNullSignals,
              after_avg_null_signals_per_report: afterAvgNullSignals,
            },
            time_series_activation: {
              calendly_snapshot_rows_found: calendlySnapshotRows.length,
              can_support_progress_movement_timeline: calendlySnapshotRows.length >= 2,
            },
            before_snapshot_count: beforeSnapshots.length,
            before_fallback_usage_pct:
              beforeSnapshots.length > 0
                ? Number(((beforeFallbackCount / beforeSnapshots.length) * 100).toFixed(1))
                : null,
          },
          null,
          2,
        ),
      );

      expect(generated.length).toBeGreaterThanOrEqual(5);
      expect(calendlySnapshotRows.length).toBeGreaterThanOrEqual(2);
    },
    240000,
  );
});

