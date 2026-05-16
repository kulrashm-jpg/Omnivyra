/**
 * Phase 10 — Long-window intelligence trends.
 *
 * Reads the Phase 9 analytics warehouse (`analytics_warehouse_facts`)
 * and composes long-window series for the standard six trend kinds.
 * Output rows in `intelligence_trend_aggregations` are deterministic
 * roll-ups — same window + same warehouse rows → same series. Re-running
 * a trend with the same dimensions UPDATEs the same row (UNIQUE
 * constraint anchors that).
 *
 * Hard guarantees:
 *   • Operator-triggered. No autonomous scheduling.
 *   • Bounded window — clamp to the configured TREND_WINDOW_DAYS map.
 *   • Series bucket granularity matches warehouse granularity (daily).
 *   • Replay-safe upserts.
 *   • Tenant-first reads.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  TREND_WINDOW_DAYS,
  type IntelligenceTrendAggregation,
  type TrendKind,
  type TrendSeriesPoint,
  type TrendWindowKind,
} from '../types/intelligenceTrend';
import { listWarehouseFacts } from './analyticsWarehouseService';
import { publishRealtime } from './realtimePublisherService';
import { publishTrendMaterialized } from '../events/listeningEvents';

const TREND_TO_FACT: Record<TrendKind, 'opportunity_daily' | 'source_roi_daily' | 'escalation_daily' | 'execution_daily' | 'moderation_daily' | 'sla_daily' | 'cost_daily'> = {
  opportunity_long: 'opportunity_daily',
  competitor_movement: 'source_roi_daily',
  source_quality: 'source_roi_daily',
  moderation_trend: 'moderation_daily',
  conversion_trend: 'execution_daily',
  escalation_pattern: 'escalation_daily',
};

function windowBounds(windowKind: TrendWindowKind): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - TREND_WINDOW_DAYS[windowKind] * 86400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function deterministicDimensionsKey(dimensions: Record<string, unknown>): string {
  const canonical = JSON.stringify(dimensions, Object.keys(dimensions).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function valueExtractor(trend: TrendKind, measures: Record<string, number>): number {
  switch (trend) {
    case 'opportunity_long': return measures.count ?? 0;
    case 'competitor_movement': return measures.opportunities ?? 0;
    case 'source_quality': return measures.sum_score ?? 0;
    case 'moderation_trend': return measures.total ?? 0;
    case 'conversion_trend': return measures.complete ?? 0;
    case 'escalation_pattern': return measures.count ?? 0;
  }
}

function buildExplanation(trend: TrendKind, points: number, window: TrendWindowKind): string {
  return (
    `trend=${trend}; window=${window}; series_points=${points}; ` +
    `derivation=warehouse_fact_pull; deterministic=true; replay_safe=true`
  );
}

export type MaterializeTrendInput = {
  organizationId: string;
  trendKind: TrendKind;
  windowKind: TrendWindowKind;
  dimensions?: Record<string, string | number | null>;
  initiatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function materializeTrend(input: MaterializeTrendInput): Promise<IntelligenceTrendAggregation> {
  const { start, end } = windowBounds(input.windowKind);
  const factKind = TREND_TO_FACT[input.trendKind];
  const facts = await listWarehouseFacts(input.organizationId, {
    factKind,
    bucketStart: start,
    bucketEnd: end,
    limit: 1000,
  });

  // Filter facts by requested dimensions (subset match).
  const filterDims = input.dimensions ?? {};
  const matching = facts.filter((f) =>
    Object.entries(filterDims).every(([k, v]) => (f.dimensions as Record<string, unknown>)[k] === v),
  );

  const series: TrendSeriesPoint[] = matching.map((f) => ({
    bucket: f.bucket_start,
    value: valueExtractor(input.trendKind, f.measures),
    components: f.measures,
  }));
  series.sort((a, b) => a.bucket.localeCompare(b.bucket));

  const dimensions = filterDims;
  const dimensionsKey = deterministicDimensionsKey(dimensions);

  const existing = await ownedDbTable('intelligence_trend_aggregations')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('trend_kind', input.trendKind)
    .eq('window_kind', input.windowKind)
    .eq('window_start', start)
    .contains('dimensions', dimensions)
    .maybeSingle();

  const payload = {
    series,
    window_end: end,
    derivation_explanation: buildExplanation(input.trendKind, series.length, input.windowKind),
    initiated_by: input.initiatedBy,
    metadata: { ...input.metadata, dimensions_key: dimensionsKey },
  };

  let row: IntelligenceTrendAggregation;
  if (existing.data) {
    const upd = await ownedDbTable('intelligence_trend_aggregations')
      .update(payload)
      .eq('id', (existing.data as { id: string }).id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`trend_update_failed:${upd.error?.message ?? 'unknown'}`);
    row = upd.data as IntelligenceTrendAggregation;
  } else {
    const ins = await ownedDbTable('intelligence_trend_aggregations')
      .insert({
        organization_id: input.organizationId,
        trend_kind: input.trendKind,
        window_kind: input.windowKind,
        window_start: start,
        window_end: end,
        dimensions,
        ...payload,
      })
      .select('*')
      .single();
    if (ins.error || !ins.data) {
      if ((ins.error as { code?: string }).code === '23505') {
        const reread = await ownedDbTable('intelligence_trend_aggregations')
          .select('*')
          .eq('organization_id', input.organizationId)
          .eq('trend_kind', input.trendKind)
          .eq('window_kind', input.windowKind)
          .eq('window_start', start)
          .contains('dimensions', dimensions)
          .single();
        row = reread.data as IntelligenceTrendAggregation;
      } else {
        throw new Error(`trend_insert_failed:${ins.error?.message ?? 'unknown'}`);
      }
    } else {
      row = ins.data as IntelligenceTrendAggregation;
    }
  }

  try {
    await publishTrendMaterialized({
      organizationId: input.organizationId,
      trendKind: input.trendKind,
      windowKind: input.windowKind,
      windowStart: start,
      windowEnd: end,
      seriesPoints: series.length,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'intelligence_trends',
      eventName: 'trend.materialized',
      payload: { trend_kind: input.trendKind, window_kind: input.windowKind, series_points: series.length },
    });
  } catch { /* best effort */ }

  return row;
}

export async function listTrends(
  organizationId: string,
  options?: { trendKind?: TrendKind; windowKind?: TrendWindowKind; limit?: number },
): Promise<IntelligenceTrendAggregation[]> {
  let q = ownedDbTable('intelligence_trend_aggregations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('window_start', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.trendKind) q = q.eq('trend_kind', options.trendKind);
  if (options?.windowKind) q = q.eq('window_kind', options.windowKind);
  const { data } = await q;
  return (data as IntelligenceTrendAggregation[]) ?? [];
}
