import { ownedDbTable } from '../db/writeOwner';

export async function getWebsiteIntelligenceDiagnostics(input: {
  companyId?: string | null;
  websiteId?: string | null;
  status?: string | null;
}) {
  const [
    publishingFailures,
    retryingJobs,
    reconciliation,
    trackingEvents,
    integrationLogs,
    plugins,
    healthScores,
    auditEvents,
  ] = await Promise.all([
    scoped('publishing_jobs', input).select('*').in('status', ['failed', 'retrying', 'dead_letter']).order('created_at', { ascending: false }).limit(100),
    scoped('publishing_jobs', input).select('id, company_id, website_id, status, next_retry_at, attempt_count, max_attempts, last_error').eq('status', 'retrying').order('next_retry_at', { ascending: true }).limit(100),
    scoped('reconciliation_jobs', input).select('*').order('created_at', { ascending: false }).limit(100),
    scoped('tracking_events', input).select('id, company_id, website_id, event_name, occurred_at, bot_flag, processed_at').gte('occurred_at', recentIso(1)).order('occurred_at', { ascending: false }).limit(200),
    scoped('integration_logs', input).select('*').in('level', ['warn', 'error']).order('created_at', { ascending: false }).limit(100),
    scoped('wordpress_plugin_registrations', input).select('*').order('updated_at', { ascending: false }).limit(100),
    scoped('website_health_scores', input).select('*').order('computed_at', { ascending: false }).limit(100),
    scoped('audit_events', input).select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  return {
    queue_visibility: {
      publishing_failures: publishingFailures.data ?? [],
      retrying_jobs: retryingJobs.data ?? [],
      reconciliation_jobs: reconciliation.data ?? [],
    },
    tracking_ingestion: {
      recent_events: trackingEvents.data ?? [],
      last_24h_count: trackingEvents.data?.length ?? 0,
      bot_filtered_hint: (trackingEvents.data ?? []).filter((event: any) => event.bot_flag).length,
    },
    integration_failures: integrationLogs.data ?? [],
    plugin_health: plugins.data ?? [],
    website_health_scores: healthScores.data ?? [],
    audit_events: auditEvents.data ?? [],
    remediation_actions: [
      'retry_publish_job',
      'run_publish_reconciliation',
      'refresh_plugin_token',
      'verify_tracking_installation',
      'recompute_health_score',
    ],
  };
}

function scoped(table: string, input: { companyId?: string | null; websiteId?: string | null }) {
  let query = ownedDbTable(table) as any;
  if (input.companyId) query = query.eq('company_id', input.companyId);
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  return query as any;
}

function recentIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
