/**
 * Phase 5 — Organization learning memory.
 *
 * Computes ROLLING-WINDOW aggregate metrics over an org's
 * recommendation / execution / opportunity history and persists them as
 * `org_learning_metrics` rows. Read-only feedback for future discovery
 * and source-prioritisation logic.
 *
 * Strict rules:
 *   • All metrics are computed from existing data; no inference, no AI.
 *   • Bounded historical windows (default 30 days).
 *   • UNIQUE (org, metric_key, metric_subject, window_start) guarantees
 *     idempotent recomputation.
 *   • No autonomous loop calls this service. It's invoked explicitly via
 *     the API or as a best-effort tail-call after pipeline runs.
 */

import { ownedDbTable } from '../db/writeOwner';
import type { LearningMetricKey, OrgLearningMetric } from '../types/orgLearningMetric';

const DEFAULT_WINDOW_HOURS = 24 * 30;

function isoWindow(windowHours: number): { window_start: string; window_end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 60 * 60 * 1000);
  return { window_start: start.toISOString(), window_end: end.toISOString() };
}

async function upsertMetric(args: {
  organizationId: string;
  metricKey: LearningMetricKey;
  metricSubject: string | null;
  window: { window_start: string; window_end: string };
  metricValue: number;
  sampleCount: number;
  metadata: Record<string, unknown>;
}): Promise<OrgLearningMetric> {
  const payload = {
    organization_id: args.organizationId,
    metric_key: args.metricKey,
    metric_subject: args.metricSubject,
    window_start: args.window.window_start,
    window_end: args.window.window_end,
    metric_value: Number(args.metricValue.toFixed(4)),
    sample_count: args.sampleCount,
    metadata: args.metadata,
  };
  const { data: existing } = await ownedDbTable('org_learning_metrics')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('metric_key', args.metricKey)
    .eq('window_start', args.window.window_start)
    .filter('metric_subject', args.metricSubject == null ? 'is' : 'eq', args.metricSubject == null ? null : args.metricSubject)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('org_learning_metrics')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`learning_metric_update_failed:${error?.message ?? 'unknown'}`);
    return data as OrgLearningMetric;
  }
  const { data, error } = await ownedDbTable('org_learning_metrics')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`learning_metric_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OrgLearningMetric;
}

export async function recomputeLearningMetrics(
  organizationId: string,
  windowHours = DEFAULT_WINDOW_HOURS,
): Promise<{ written: number }> {
  const window = isoWindow(windowHours);
  const since = window.window_start;
  let written = 0;

  // ---- recommendation_acceptance_rate / dismissal_rate ----
  const { data: recs } = await ownedDbTable('community_recommendations')
    .select('recommendation_status')
    .eq('organization_id', organizationId)
    .gt('created_at', since);
  const recRows = (recs ?? []) as Array<{ recommendation_status: string }>;
  if (recRows.length > 0) {
    const accepted = recRows.filter((r) => r.recommendation_status === 'approved' || r.recommendation_status === 'activated').length;
    const dismissed = recRows.filter((r) => r.recommendation_status === 'dismissed' || r.recommendation_status === 'rejected').length;
    await upsertMetric({
      organizationId,
      metricKey: 'recommendation_acceptance_rate',
      metricSubject: null,
      window,
      metricValue: accepted / recRows.length,
      sampleCount: recRows.length,
      metadata: { accepted, total: recRows.length },
    });
    written += 1;
    await upsertMetric({
      organizationId,
      metricKey: 'recommendation_dismissal_rate',
      metricSubject: null,
      window,
      metricValue: dismissed / recRows.length,
      sampleCount: recRows.length,
      metadata: { dismissed, total: recRows.length },
    });
    written += 1;
  }

  // ---- execution_partial_rate / execution_failure_rate ----
  const { data: execs } = await ownedDbTable('listening_executions')
    .select('execution_status')
    .eq('organization_id', organizationId)
    .gt('created_at', since);
  const execRows = (execs ?? []) as Array<{ execution_status: string }>;
  if (execRows.length > 0) {
    const partial = execRows.filter((e) => e.execution_status === 'partial').length;
    const failed = execRows.filter((e) => e.execution_status === 'failed').length;
    await upsertMetric({
      organizationId,
      metricKey: 'execution_partial_rate',
      metricSubject: null,
      window,
      metricValue: partial / execRows.length,
      sampleCount: execRows.length,
      metadata: { partial, total: execRows.length },
    });
    written += 1;
    await upsertMetric({
      organizationId,
      metricKey: 'execution_failure_rate',
      metricSubject: null,
      window,
      metricValue: failed / execRows.length,
      sampleCount: execRows.length,
      metadata: { failed, total: execRows.length },
    });
    written += 1;
  }

  // ---- source_signal_yield, source_moderation_block_rate (per source) ----
  const { data: execStats } = await ownedDbTable('listening_executions')
    .select('listening_source_id, signal_stats')
    .eq('organization_id', organizationId)
    .gt('created_at', since)
    .in('execution_status', ['completed', 'partial']);
  type Bag = { persisted: number; blocked: number; total: number; executions: number };
  const bySource = new Map<string, Bag>();
  for (const e of (execStats ?? []) as Array<{ listening_source_id: string; signal_stats: Record<string, number> | null }>) {
    const bag = bySource.get(e.listening_source_id) ?? { persisted: 0, blocked: 0, total: 0, executions: 0 };
    const s = e.signal_stats ?? {};
    const persisted = Number(s.signals_persisted ?? 0);
    const blocked = Number(s.signals_moderation_blocked ?? 0);
    const deduped = Number(s.signals_deduplicated ?? 0);
    bag.persisted += persisted;
    bag.blocked += blocked;
    bag.total += persisted + blocked + deduped;
    bag.executions += 1;
    bySource.set(e.listening_source_id, bag);
  }
  for (const [sourceId, bag] of bySource.entries()) {
    if (bag.executions === 0) continue;
    await upsertMetric({
      organizationId,
      metricKey: 'source_signal_yield',
      metricSubject: sourceId,
      window,
      metricValue: bag.persisted / bag.executions,
      sampleCount: bag.executions,
      metadata: { persisted: bag.persisted, executions: bag.executions },
    });
    written += 1;
    if (bag.total > 0) {
      await upsertMetric({
        organizationId,
        metricKey: 'source_moderation_block_rate',
        metricSubject: sourceId,
        window,
        metricValue: bag.blocked / bag.total,
        sampleCount: bag.total,
        metadata: { blocked: bag.blocked, observed: bag.total },
      });
      written += 1;
    }
  }

  // ---- opportunity_conversion_rate (org-level) ----
  const { data: oppCount } = await ownedDbTable('opportunity_feed_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gt('created_at', since);
  if ((oppCount as unknown as { count?: number })?.count && execRows.length > 0) {
    const oppTotal = (oppCount as unknown as { count: number }).count;
    await upsertMetric({
      organizationId,
      metricKey: 'opportunity_conversion_rate',
      metricSubject: null,
      window,
      metricValue: oppTotal / Math.max(1, execRows.length),
      sampleCount: execRows.length,
      metadata: { opportunities: oppTotal, executions: execRows.length },
    });
    written += 1;
  }

  return { written };
}

export async function listLearningMetrics(
  organizationId: string,
  options?: { metricKey?: LearningMetricKey; limit?: number },
): Promise<OrgLearningMetric[]> {
  let q = ownedDbTable('org_learning_metrics')
    .select('*')
    .eq('organization_id', organizationId)
    .order('window_end', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.metricKey) q = q.eq('metric_key', options.metricKey);
  const { data, error } = await q;
  if (error) throw new Error(`learning_metric_list_failed:${error.message}`);
  return (data as OrgLearningMetric[]) ?? [];
}
