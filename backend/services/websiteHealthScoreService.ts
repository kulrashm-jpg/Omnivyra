import { ownedDbTable } from '../db/writeOwner';

export async function computeWebsiteHealthScore(input: {
  companyId: string;
  websiteId: string;
}) {
  const [events, healthChecks, jobs, forms, plugin, domains] = await Promise.all([
    ownedDbTable('tracking_events').select('id').eq('company_id', input.companyId).eq('website_id', input.websiteId).gte('occurred_at', recentIso(7)).limit(1),
    ownedDbTable('integration_health_checks').select('*').eq('company_id', input.companyId).eq('website_id', input.websiteId).order('checked_at', { ascending: false }).limit(10),
    ownedDbTable('publishing_jobs').select('status, execution_duration_ms').eq('company_id', input.companyId).eq('website_id', input.websiteId).gte('created_at', recentIso(30)).limit(200),
    ownedDbTable('form_performance_daily').select('*').eq('company_id', input.companyId).eq('website_id', input.websiteId).gte('day', recentDay(30)).limit(200),
    ownedDbTable('wordpress_plugin_registrations').select('*').eq('company_id', input.companyId).eq('website_id', input.websiteId).order('updated_at', { ascending: false }).limit(5),
    ownedDbTable('websites').select('domain_id, status').eq('id', input.websiteId).eq('company_id', input.companyId).maybeSingle(),
  ]);

  const issues: Array<Record<string, unknown>> = [];
  const recommendations: Array<Record<string, unknown>> = [];
  const publishRows = jobs.data ?? [];
  const failedPublishes = publishRows.filter((job: any) => ['failed', 'dead_letter'].includes(job.status)).length;
  const pluginRows = plugin.data ?? [];
  const healthRows = healthChecks.data ?? [];
  const formRows = forms.data ?? [];

  const categoryScores = {
    tracking_health: events.data?.length ? 100 : addIssue(issues, recommendations, 'tracking_gap', 45, 'Install or verify the Omnivera tracking script.'),
    cms_health: scoreCms(pluginRows, healthRows, issues, recommendations),
    publishing_reliability: publishRows.length ? Math.max(20, 100 - failedPublishes * 20) : 70,
    attribution_readiness: formRows.some((row: any) => row.submissions > 0) ? 85 : 55,
    conversion_readiness: formRows.length ? Math.min(100, Math.round(avg(formRows.map((row: any) => Number(row.completion_rate || 0))) * 100)) : 50,
    integration_reliability: healthRows.some((row: any) => ['failed', 'degraded'].includes(row.status)) ? 55 : 85,
    form_health: formRows.length ? Math.max(40, 100 - formRows.filter((row: any) => row.abandonments > row.submissions).length * 15) : 60,
    domain_verification: (domains.data as any)?.domain_id ? 90 : addIssue(issues, recommendations, 'domain_unlinked', 60, 'Link and verify the website domain.'),
  };

  const compositeScore = Math.round(avg(Object.values(categoryScores)));
  const improvementPriorities = Object.entries(categoryScores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([category, score]) => ({ category, score }));

  const payload = {
    company_id: input.companyId,
    website_id: input.websiteId,
    composite_score: compositeScore,
    category_scores: categoryScores,
    issues,
    recommendations,
    improvement_priorities: improvementPriorities,
    computed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await ownedDbTable('website_health_scores')
    .upsert(payload, { onConflict: 'website_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function scoreCms(pluginRows: any[], healthRows: any[], issues: Array<Record<string, unknown>>, recommendations: Array<Record<string, unknown>>) {
  const connected = pluginRows.some((row) => row.status === 'connected');
  const stale = pluginRows.some((row) => row.last_heartbeat_at && Date.now() - new Date(row.last_heartbeat_at).getTime() > 24 * 60 * 60 * 1000);
  const failed = healthRows.some((row) => ['failed', 'reauth_required'].includes(row.status));
  if (!connected) return addIssue(issues, recommendations, 'cms_not_connected', 45, 'Connect WordPress or finish plugin setup.');
  if (failed) return addIssue(issues, recommendations, 'cms_health_failed', 50, 'Review CMS connection diagnostics and reconnect if needed.');
  if (stale) return addIssue(issues, recommendations, 'plugin_stale', 65, 'Check that the WordPress plugin heartbeat is still active.');
  return 95;
}

function addIssue(
  issues: Array<Record<string, unknown>>,
  recommendations: Array<Record<string, unknown>>,
  key: string,
  score: number,
  recommendation: string,
) {
  issues.push({ key, score, severity: score < 50 ? 'high' : 'medium' });
  recommendations.push({ key, recommendation });
  return score;
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function recentIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function recentDay(days: number) {
  return recentIso(days).slice(0, 10);
}
