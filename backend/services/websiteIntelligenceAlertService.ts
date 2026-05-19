import { ownedDbTable } from '../db/writeOwner';

export type WebsiteIntelligenceAlertSeverity = 'info' | 'warning' | 'critical';

export async function upsertWebsiteIntelligenceAlert(input: {
  companyId?: string | null;
  websiteId?: string | null;
  alertKey: string;
  alertType: string;
  severity?: WebsiteIntelligenceAlertSeverity;
  message: string;
  remediation?: string | null;
  routing?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const existing = await ownedDbTable('website_intelligence_alerts')
    .select('id, occurrence_count')
    .eq('alert_key', input.alertKey)
    .eq('company_id', input.companyId ?? null)
    .eq('website_id', input.websiteId ?? null)
    .maybeSingle();

  const payload = {
    company_id: input.companyId ?? null,
    website_id: input.websiteId ?? null,
    alert_key: input.alertKey,
    alert_type: input.alertType,
    severity: input.severity ?? 'warning',
    status: 'open',
    message: input.message,
    remediation: input.remediation ?? null,
    routing: input.routing ?? { team: 'growth-ops', channel: 'website-intelligence' },
    metadata: input.metadata ?? {},
    last_seen_at: new Date().toISOString(),
    occurrence_count: Number((existing.data as any)?.occurrence_count ?? 0) + 1,
  };

  const { data, error } = await ownedDbTable('website_intelligence_alerts')
    .upsert(payload, { onConflict: 'company_id,website_id,alert_key' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function evaluateWebsiteIntelligenceAlerts(input: {
  companyId?: string | null;
  websiteId?: string | null;
}) {
  const alerts = [];
  const [queueMetrics, workers, plugins, integrity, ingestion] = await Promise.all([
    scoped('queue_metrics', input).select('*').order('metric_window_end', { ascending: false }).limit(20),
    ownedDbTable('worker_health').select('*').order('heartbeat_at', { ascending: false }).limit(50),
    scoped('wordpress_plugin_registrations', input).select('*').order('last_heartbeat_at', { ascending: false }).limit(50),
    scoped('publish_integrity_status', input).select('*').neq('integrity_status', 'healthy').order('last_checked_at', { ascending: false }).limit(50),
    scoped('tracking_events', input).select('id, occurred_at').gte('occurred_at', recentIso(1)).limit(1),
  ]);

  for (const metric of (queueMetrics.data ?? []) as any[]) {
    if (Number(metric.lag_seconds || 0) > 300) {
      alerts.push(await upsertWebsiteIntelligenceAlert({
        companyId: metric.company_id ?? input.companyId,
        websiteId: metric.website_id ?? input.websiteId,
        alertKey: `queue-lag:${metric.queue_name}:${metric.website_id ?? 'global'}`,
        alertType: 'queue_lag',
        severity: Number(metric.lag_seconds) > 900 ? 'critical' : 'warning',
        message: `${metric.queue_name} lag is ${metric.lag_seconds}s.`,
        remediation: 'Inspect worker health, queue saturation, provider failures, and retry amplification.',
        metadata: metric,
      }));
    }
    if (Number(metric.dead_letter_count || 0) > 0) {
      alerts.push(await upsertWebsiteIntelligenceAlert({
        companyId: metric.company_id ?? input.companyId,
        websiteId: metric.website_id ?? input.websiteId,
        alertKey: `dead-letter:${metric.queue_name}:${metric.website_id ?? 'global'}`,
        alertType: 'dead_letter',
        severity: 'critical',
        message: `${metric.dead_letter_count} dead-lettered jobs exist in ${metric.queue_name}.`,
        remediation: 'Review dead-letter jobs, fix root cause, and manually requeue only after validation.',
        metadata: metric,
      }));
    }
  }

  for (const worker of (workers.data ?? []) as any[]) {
    if (Date.now() - new Date(worker.heartbeat_at).getTime() > 10 * 60_000) {
      alerts.push(await upsertWebsiteIntelligenceAlert({
        alertKey: `worker-stale:${worker.worker_type}:${worker.worker_id}`,
        alertType: 'worker_stale',
        severity: 'critical',
        message: `${worker.worker_type} worker ${worker.worker_id} heartbeat is stale.`,
        remediation: 'Restart worker and inspect recent queue metrics.',
        metadata: worker,
      }));
    }
  }

  for (const plugin of (plugins.data ?? []) as any[]) {
    if (!plugin.last_heartbeat_at || Date.now() - new Date(plugin.last_heartbeat_at).getTime() > 24 * 60 * 60_000) {
      alerts.push(await upsertWebsiteIntelligenceAlert({
        companyId: plugin.company_id,
        websiteId: plugin.website_id,
        alertKey: `plugin-heartbeat:${plugin.id}`,
        alertType: 'plugin_heartbeat',
        severity: 'warning',
        message: 'WordPress plugin heartbeat is missing or stale.',
        remediation: 'Ask the site admin to open the Omnivera plugin page and run diagnostics.',
        metadata: plugin,
      }));
    }
  }

  if ((integrity.data ?? []).length > 0) {
    alerts.push(await upsertWebsiteIntelligenceAlert({
      companyId: input.companyId,
      websiteId: input.websiteId,
      alertKey: `reconciliation-drift:${input.websiteId ?? 'global'}`,
      alertType: 'reconciliation_drift',
      severity: 'warning',
      message: `${(integrity.data ?? []).length} publish integrity records need review.`,
      remediation: 'Run reconciliation, inspect externally modified/missing posts, and republish if needed.',
      metadata: { count: (integrity.data ?? []).length },
    }));
  }

  if (input.websiteId && !(ingestion.data ?? []).length) {
    alerts.push(await upsertWebsiteIntelligenceAlert({
      companyId: input.companyId,
      websiteId: input.websiteId,
      alertKey: `ingestion-anomaly:${input.websiteId}`,
      alertType: 'ingestion_anomaly',
      severity: 'warning',
      message: 'No tracking events were ingested in the last 24 hours.',
      remediation: 'Verify plugin tracking injection, consent mode, domain enforcement, and event endpoint health.',
    }));
  }

  return { alerts };
}

function scoped(table: string, input: { companyId?: string | null; websiteId?: string | null }) {
  let query = ownedDbTable(table) as any;
  if (input.companyId) query = query.eq('company_id', input.companyId);
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  return query;
}

function recentIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
