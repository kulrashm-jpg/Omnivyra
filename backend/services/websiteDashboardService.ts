import { ownedDbTable } from '../db/writeOwner';
import { getAttributionReport } from './attributionReportingService';
import { getWebsiteIntelligenceSignals } from './websiteIntelligenceService';
import { getFormPerformance } from './formIntelligenceService';

export async function getWebsiteIntelligenceDashboard(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
  useCache?: boolean;
}) {
  const from = input.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = input.to ?? new Date().toISOString().slice(0, 10);
  const cacheKey = `dashboard:${from}:${to}`;
  if (input.useCache !== false) {
    const cached = await readDashboardCache(input.companyId, input.websiteId, cacheKey);
    if (cached) return cached;
  }

  const [
    websites,
    websiteDaily,
    pageDaily,
    campaignDaily,
    publishing,
    integrity,
    health,
    plugins,
    operationalAlerts,
    forms,
    attribution,
    signals,
  ] = await Promise.all([
    loadWebsites(input.companyId, input.websiteId),
    queryRange('website_analytics_daily', input.companyId, input.websiteId, from, to),
    queryRange('page_analytics_daily', input.companyId, input.websiteId, from, to),
    queryRange('campaign_analytics_daily', input.companyId, input.websiteId, from, to),
    loadPublishing(input.companyId, input.websiteId),
    loadIntegrity(input.companyId, input.websiteId),
    loadHealth(input.companyId, input.websiteId),
    loadPlugins(input.companyId, input.websiteId),
    loadOperationalAlerts(input.companyId, input.websiteId),
    getFormPerformance({ companyId: input.companyId, websiteId: input.websiteId, from, to }),
    getAttributionReport({ companyId: input.companyId, websiteId: input.websiteId, from, to }),
    getWebsiteIntelligenceSignals({ companyId: input.companyId, websiteId: input.websiteId }),
  ]);

  const dashboard = {
    date_range: { from, to },
    websites,
    overview: summarizeWebsiteDaily(websiteDaily),
    traffic_overview: {
      by_page: topRows(pageDaily, 'page_views', 15),
      by_campaign: topRows(campaignDaily, 'page_views', 15),
    },
    conversion_overview: {
      pages: topRows(pageDaily, 'form_submits', 15),
      forms: topRows(forms.rows, 'submissions', 15),
      attribution_summary: attribution.website_conversion_summary,
    },
    campaign_overview: {
      top_converting_campaigns: attribution.top_converting_campaigns,
      traffic_sources: attribution.traffic_source_conversion,
    },
    publishing_overview: {
      recent: publishing.slice(0, 20),
      failed: publishing.filter((job: any) => ['failed', 'dead_letter'].includes(job.status)).length,
      integrity,
    },
    attribution_overview: attribution,
    form_performance: forms.rows,
    tracking_health: summarizeTracking(websiteDaily),
    cms_health: { plugins, health_checks: health },
    intelligence_alerts: signals,
    operational_alerts: operationalAlerts,
    setup_progress: setupProgress(websites, plugins, websiteDaily, forms.rows),
    async_sections: [
      'attribution_overview',
      'form_performance',
      'publishing_overview',
      'intelligence_alerts',
    ],
  };
  await writeDashboardCache(input.companyId, input.websiteId, cacheKey, dashboard);
  return dashboard;
}

async function readDashboardCache(companyId: string, websiteId: string | null | undefined, key: string) {
  let query = ownedDbTable('website_dashboard_cache')
    .select('payload, expires_at')
    .eq('company_id', companyId)
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  query = websiteId ? query.eq('website_id', websiteId) : query.is('website_id', null);
  const { data } = await query;
  return data?.[0]?.payload ?? null;
}

async function writeDashboardCache(companyId: string, websiteId: string | null | undefined, key: string, payload: unknown) {
  await ownedDbTable('website_dashboard_cache').upsert({
    company_id: companyId,
    website_id: websiteId ?? null,
    cache_key: key,
    payload,
    computed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }, { onConflict: 'company_id,website_id,cache_key' });
}

async function loadWebsites(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('websites').select('*').eq('company_id', companyId).is('deleted_at', null);
  if (websiteId) query = query.eq('id', websiteId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function queryRange(table: string, companyId: string, websiteId: string | null | undefined, from: string, to: string) {
  let query = ownedDbTable(table).select('*').eq('company_id', companyId).gte('day', from).lte('day', to);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadPublishing(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('publishing_jobs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadIntegrity(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('publish_integrity_status').select('*').eq('company_id', companyId).order('last_checked_at', { ascending: false }).limit(100);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadHealth(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('website_health_scores').select('*').eq('company_id', companyId).order('computed_at', { ascending: false }).limit(100);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadPlugins(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('wordpress_plugin_registrations').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(100);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadOperationalAlerts(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('website_intelligence_alerts')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['open', 'acknowledged'])
    .order('last_seen_at', { ascending: false })
    .limit(25);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

function summarizeWebsiteDaily(rows: any[]) {
  return rows.reduce((acc, row) => {
    acc.page_views += row.page_views || 0;
    acc.unique_visitors += row.unique_visitors || 0;
    acc.cta_clicks += row.cta_clicks || 0;
    acc.form_starts += row.form_starts || 0;
    acc.form_submits += row.form_submits || 0;
    acc.outbound_clicks += row.outbound_clicks || 0;
    return acc;
  }, { page_views: 0, unique_visitors: 0, cta_clicks: 0, form_starts: 0, form_submits: 0, outbound_clicks: 0 });
}

function summarizeTracking(rows: any[]) {
  const totals = summarizeWebsiteDaily(rows);
  return {
    status: totals.page_views > 0 ? 'active' : 'not_detected',
    last_aggregated_day: rows.map((row) => row.day).sort().pop() ?? null,
    totals,
  };
}

function topRows(rows: any[], metric: string, limit: number) {
  return [...rows].sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0)).slice(0, limit);
}

function setupProgress(websites: any[], plugins: any[], websiteDaily: any[], forms: any[]) {
  const hasWebsite = websites.length > 0;
  const hasPlugin = plugins.some((plugin) => plugin.status === 'connected');
  const hasTracking = websiteDaily.some((row) => Number(row.page_views || 0) > 0);
  const hasForms = forms.length > 0;
  const steps = [
    { label: 'Website created', complete: hasWebsite, action: 'Create or select a website.' },
    { label: 'WordPress connected', complete: hasPlugin, action: 'Install the plugin and connect with a setup token.' },
    { label: 'Tracking detected', complete: hasTracking, action: 'Enable tracking injection in the plugin.' },
    { label: 'Forms connected', complete: hasForms, action: 'Submit a tracked form or connect hosted forms.' },
  ];
  return { complete: steps.every((step) => step.complete), steps };
}
