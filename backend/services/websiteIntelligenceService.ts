import { ownedDbTable } from '../db/writeOwner';
import { computeWebsiteHealthScore } from './websiteHealthScoreService';

export async function generateWebsiteIntelligenceSignals(input: {
  companyId: string;
  websiteId?: string | null;
}) {
  const websites = await loadWebsites(input.companyId, input.websiteId);
  const generated = [];
  for (const website of websites) {
    const [pages, websiteDaily, forms, publishIntegrity, failedJobs, healthScore] = await Promise.all([
      ownedDbTable('page_analytics_daily').select('*').eq('company_id', input.companyId).eq('website_id', website.id).gte('day', recentDay(30)).limit(500),
      ownedDbTable('website_analytics_daily').select('*').eq('company_id', input.companyId).eq('website_id', website.id).gte('day', recentDay(30)).limit(60),
      ownedDbTable('form_performance_daily').select('*').eq('company_id', input.companyId).eq('website_id', website.id).gte('day', recentDay(30)).limit(200),
      ownedDbTable('publish_integrity_status').select('*').eq('company_id', input.companyId).eq('website_id', website.id).neq('integrity_status', 'healthy').limit(50),
      ownedDbTable('publishing_jobs').select('*').eq('company_id', input.companyId).eq('website_id', website.id).in('status', ['failed', 'dead_letter']).gte('created_at', recentIso(30)).limit(50),
      computeWebsiteHealthScore({ companyId: input.companyId, websiteId: website.id }),
    ]);

    const rows = [
      ...pageSignals(input.companyId, website.id, pages.data ?? []),
      ...formSignals(input.companyId, website.id, forms.data ?? []),
      ...publishingSignals(input.companyId, website.id, publishIntegrity.data ?? [], failedJobs.data ?? []),
      ...trackingSignals(input.companyId, website.id, websiteDaily.data ?? [], healthScore),
    ];
    for (const signal of rows) {
      const { data, error } = await ownedDbTable('website_intelligence_signals')
        .upsert(signal, { onConflict: 'company_id,website_id,signal_key' })
        .select('*')
        .single();
      if (!error && data) generated.push(data);
    }
  }
  return { generated };
}

export async function getWebsiteIntelligenceSignals(input: {
  companyId: string;
  websiteId?: string | null;
  includeResolved?: boolean;
}) {
  let query = ownedDbTable('website_intelligence_signals')
    .select('*')
    .eq('company_id', input.companyId)
    .order('generated_at', { ascending: false });
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  if (!input.includeResolved) query = query.in('resolved_state', ['active', 'acknowledged']);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function pageSignals(companyId: string, websiteId: string, pages: any[]) {
  return pages.flatMap((page) => {
    const conversionRate = page.page_views > 0 ? (page.form_submits || 0) / page.page_views : 0;
    if (page.page_views >= 100 && conversionRate < 0.005) {
      return [signal(companyId, websiteId, `high-traffic-low-conversion:${page.page_url}`, 'high_traffic_low_conversion_page', 'high', 0.82, 'Review CTA placement and lead magnet relevance on this high-traffic page.', { page })];
    }
    if (page.form_submits >= 5 && conversionRate >= 0.05) {
      return [signal(companyId, websiteId, `strong-conversion:${page.page_url}`, 'strong_conversion_page', 'info', 0.78, 'Promote this page in campaigns and use it as a conversion benchmark.', { page })];
    }
    if ((page.cta_clicks || 0) > 20 && (page.form_submits || 0) === 0) {
      return [signal(companyId, websiteId, `weak-cta:${page.page_url}`, 'weak_cta_location', 'medium', 0.72, 'CTA clicks are not turning into submits; check form continuity and destination.', { page })];
    }
    return [];
  });
}

function formSignals(companyId: string, websiteId: string, forms: any[]) {
  return forms
    .filter((form) => form.starts >= 10 && form.abandonments > form.submissions)
    .map((form) => signal(companyId, websiteId, `form-abandonment:${form.form_id}`, 'form_abandonment_trend', 'medium', 0.74, 'Form abandonment is higher than submissions; inspect required fields and loading behavior.', { form }));
}

function publishingSignals(companyId: string, websiteId: string, integrityRows: any[], failedJobs: any[]) {
  const signals = integrityRows.map((row) =>
    signal(companyId, websiteId, `publish-drift:${row.id}`, 'publishing_integrity_drift', 'high', 0.88, 'Published content differs from Omnivera state; run reconciliation or republish.', { integrity: row })
  );
  if (failedJobs.length) {
    signals.push(signal(companyId, websiteId, 'publishing-failures:30d', 'publishing_failures', 'high', 0.86, 'Publishing failures are present in the last 30 days; review credentials and queue errors.', { failed_count: failedJobs.length }));
  }
  return signals;
}

function trackingSignals(companyId: string, websiteId: string, daily: any[], healthScore: any) {
  if (!daily.length) {
    return [signal(companyId, websiteId, 'tracking-gap:30d', 'tracking_gap', 'critical', 0.9, 'No tracking events were aggregated in the last 30 days; verify tracking script installation.', { health_score: healthScore })];
  }
  if ((healthScore?.composite_score ?? 100) < 65) {
    return [signal(companyId, websiteId, 'website-health-low', 'website_health_low', 'high', 0.8, 'Website health score is low; address the top readiness blockers first.', { health_score: healthScore })];
  }
  return [];
}

function signal(
  companyId: string,
  websiteId: string,
  key: string,
  type: string,
  severity: string,
  confidence: number,
  recommendation: string,
  metadata: Record<string, unknown>,
) {
  return {
    company_id: companyId,
    website_id: websiteId,
    signal_key: key,
    type,
    severity,
    confidence,
    recommendation,
    metadata,
    resolved_state: 'active',
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function loadWebsites(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('websites').select('*').eq('company_id', companyId).is('deleted_at', null);
  if (websiteId) query = query.eq('id', websiteId);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function recentIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function recentDay(days: number) {
  return recentIso(days).slice(0, 10);
}
