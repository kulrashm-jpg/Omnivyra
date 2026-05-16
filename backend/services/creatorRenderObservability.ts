import { createHash, randomUUID } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';

export type CreatorRenderMetricName =
  | 'render_duration_ms'
  | 'render_retry_count'
  | 'render_failure'
  | 'render_timeout'
  | 'ocr_rejection'
  | 'governance_rejection'
  | 'queue_latency_ms'
  | 'publish_rejection'
  | 'visual_regression_failure'
  | 'accessibility_rejection'
  | 'publish_live_ocr_rejection'
  | 'scheduler_validation_rejection'
  | 'dlq_replay'
  | 'queue_reconciliation';

export type CreatorRenderMetric = {
  name: CreatorRenderMetricName;
  value: number;
  auditId: string;
  tags: Record<string, string>;
  at: string;
};

const metrics: CreatorRenderMetric[] = [];

export function createCreatorAuditId(input: Record<string, unknown>): string {
  const seed = JSON.stringify(input, Object.keys(input).sort());
  return `cra_${createHash('sha1').update(seed || randomUUID()).digest('hex').slice(0, 16)}`;
}

export function recordCreatorRenderMetric(input: {
  name: CreatorRenderMetricName;
  value?: number;
  auditId?: string;
  tags?: Record<string, unknown>;
}): CreatorRenderMetric {
  const metric: CreatorRenderMetric = {
    name: input.name,
    value: Number.isFinite(Number(input.value)) ? Number(input.value) : 1,
    auditId: input.auditId ?? createCreatorAuditId({ name: input.name, at: Date.now() }),
    tags: Object.fromEntries(Object.entries(input.tags ?? {}).map(([key, value]) => [key, String(value ?? '')])),
    at: new Date().toISOString(),
  };
  metrics.push(metric);
  if (metrics.length > 1000) metrics.splice(0, metrics.length - 1000);
  console.info('[creator-render-observability]', JSON.stringify(metric));
  void persistCreatorRenderMetric(metric);
  return metric;
}

async function persistCreatorRenderMetric(metric: CreatorRenderMetric): Promise<void> {
  try {
    await ownedDbTable('creator_render_metrics').insert({
      metric_name: metric.name,
      metric_value: metric.value,
      audit_id: metric.auditId,
      tags: metric.tags,
      recorded_at: metric.at,
    });
  } catch (error) {
    console.warn('[creator-render-observability] durable metric write failed', {
      name: metric.name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function listCreatorRenderMetrics(): CreatorRenderMetric[] {
  return metrics.slice();
}

export function summarizeCreatorRenderMetrics(): Record<CreatorRenderMetricName, number> {
  return metrics.reduce((acc, metric) => {
    acc[metric.name] = (acc[metric.name] ?? 0) + metric.value;
    return acc;
  }, {} as Record<CreatorRenderMetricName, number>);
}

export async function summarizeDurableCreatorRenderMetrics(): Promise<Record<string, number>> {
  try {
    const { data, error } = await ownedDbTable('creator_render_metrics')
      .select('metric_name, metric_value')
      .gte('recorded_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .limit(5000);
    if (error || !Array.isArray(data)) throw error ?? new Error('creator_render_metrics_query_failed');
    return data.reduce((acc: Record<string, number>, row: { metric_name?: unknown; metric_value?: unknown }) => {
      const name = String(row.metric_name ?? 'unknown');
      acc[name] = (acc[name] ?? 0) + Number(row.metric_value ?? 0);
      return acc;
    }, {});
  } catch (error) {
    console.warn('[creator-render-observability] durable metric read failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return summarizeCreatorRenderMetrics();
  }
}

export async function listDurableCreatorRenderMetrics(input: {
  auditId?: string | null;
  metricName?: string | null;
  limit?: number;
} = {}): Promise<CreatorRenderMetric[]> {
  try {
    let query = ownedDbTable('creator_render_metrics')
      .select('metric_name, metric_value, audit_id, tags, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(Math.max(1, Math.min(500, input.limit ?? 100)));
    if (input.auditId) query = query.eq('audit_id', input.auditId);
    if (input.metricName) query = query.eq('metric_name', input.metricName);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw error ?? new Error('creator_render_metrics_query_failed');
    return data.map((row: Record<string, unknown>) => ({
      name: String(row.metric_name ?? 'render_failure') as CreatorRenderMetricName,
      value: Number(row.metric_value ?? 0),
      auditId: String(row.audit_id ?? ''),
      tags: row.tags && typeof row.tags === 'object' && !Array.isArray(row.tags)
        ? Object.fromEntries(Object.entries(row.tags as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]))
        : {},
      at: String(row.recorded_at ?? new Date().toISOString()),
    }));
  } catch (error) {
    console.warn('[creator-render-observability] durable metric list failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return listCreatorRenderMetrics().slice(-(input.limit ?? 100));
  }
}

export async function purgeOldCreatorRenderMetrics(input: { olderThanDays?: number } = {}): Promise<{ purgedBefore: string }> {
  const days = Math.max(1, input.olderThanDays ?? 30);
  const purgedBefore = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  try {
    await ownedDbTable('creator_render_metrics')
      .delete()
      .lt('recorded_at', purgedBefore);
  } catch (error) {
    console.warn('[creator-render-observability] durable metric purge failed', {
      message: error instanceof Error ? error.message : String(error),
      purgedBefore,
    });
  }
  return { purgedBefore };
}
