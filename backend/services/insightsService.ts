import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { normalizeMetadata } from './intelligenceResponseMapper';

export type IntelligenceInsight = {
  type: 'positive' | 'negative' | 'warning';
  title: string;
  description: string;
  source: string;
  metric: number;
};

type AttributionRow = {
  revenue_touchpoint_id: string;
};

type RevenueTouchpointRow = {
  id: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
};

type SourceTouchpointRow = {
  source: string | null;
  touchpoint_type: string;
  metadata: Record<string, unknown> | null;
};

type GapRow = {
  metadata: Record<string, unknown> | null;
};

type SourcePerformanceAggregate = {
  source: string;
  leads: number;
  revenue: number;
};

const ATTRIBUTED_REVENUE_BATCH_SIZE = 500;

function normalizeCompanyId(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}

function normalizeSourceLabel(value: unknown): string {
  return String(value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function safeNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function revenueAmountFromMetadata(value: unknown): number {
  const metadata = normalizeMetadata(value);
  return (
    safeNumber(metadata.revenue_amount) ??
    safeNumber(metadata.amount) ??
    safeNumber(metadata.revenue) ??
    safeNumber(metadata.deal_value) ??
    safeNumber(metadata.value) ??
    0
  );
}

function sourceFromGapMetadata(value: unknown): string {
  const metadata = normalizeMetadata(value);
  const unifiedSource = normalizeMetadata(metadata.unified_source);

  return normalizeSourceLabel(
    metadata.source ??
      unifiedSource.provider ??
      unifiedSource.category ??
      'unknown'
  );
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadAttributedRevenueBySource(companyId: string): Promise<Map<string, number>> {
  const { data: attributionData, error: attributionError } = await supabase
    .from('attribution_results')
    .select('revenue_touchpoint_id')
    .eq('company_id', companyId);

  if (attributionError) {
    throw new Error(`Failed to load attributed revenue links: ${attributionError.message}`);
  }

  const revenueTouchpointIds = Array.from(
    new Set(
      ((attributionData ?? []) as AttributionRow[])
        .map((row) => row.revenue_touchpoint_id)
        .filter(Boolean)
    )
  );

  const bySource = new Map<string, number>();
  for (const batch of chunkValues(revenueTouchpointIds, ATTRIBUTED_REVENUE_BATCH_SIZE)) {
    if (batch.length === 0) {
      continue;
    }

    const { data, error } = await supabase
      .from('unified_touchpoints')
      .select('id, source, metadata')
      .eq('company_id', companyId)
      .eq('touchpoint_type', 'revenue')
      .in('id', batch);

    if (error) {
      throw new Error(`Failed to load attributed revenue touchpoints: ${error.message}`);
    }

    for (const touchpoint of (data ?? []) as RevenueTouchpointRow[]) {
      const source = normalizeSourceLabel(touchpoint.source);
      const amount = revenueAmountFromMetadata(touchpoint.metadata);
      bySource.set(source, (bySource.get(source) ?? 0) + amount);
    }
  }

  return bySource;
}

async function loadSourcePerformance(companyId: string): Promise<SourcePerformanceAggregate[]> {
  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('source, touchpoint_type, metadata')
    .eq('company_id', companyId)
    .in('touchpoint_type', ['lead_created', 'revenue']);

  if (error) {
    throw new Error(`Failed to load source performance for insights: ${error.message}`);
  }

  const bySource = new Map<string, SourcePerformanceAggregate>();
  for (const touchpoint of (data ?? []) as SourceTouchpointRow[]) {
    const source = normalizeSourceLabel(touchpoint.source);
    const aggregate = bySource.get(source) ?? { source, leads: 0, revenue: 0 };

    if (touchpoint.touchpoint_type === 'lead_created') {
      aggregate.leads += 1;
    }

    if (touchpoint.touchpoint_type === 'revenue') {
      aggregate.revenue += revenueAmountFromMetadata(touchpoint.metadata);
    }

    bySource.set(source, aggregate);
  }

  return [...bySource.values()].map((aggregate) => ({
    ...aggregate,
    revenue: roundMetric(aggregate.revenue),
  }));
}

async function loadOpenGapsBySource(companyId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('intelligence_gaps')
    .select('metadata')
    .eq('company_id', companyId)
    .eq('status', 'open');

  if (error) {
    throw new Error(`Failed to load open gaps for insights: ${error.message}`);
  }

  const bySource = new Map<string, number>();
  for (const gap of (data ?? []) as GapRow[]) {
    const source = sourceFromGapMetadata(gap.metadata);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }

  return bySource;
}

function buildHighPerformingSourceInsight(
  attributedRevenueBySource: Map<string, number>
): IntelligenceInsight | null {
  const topSource = [...attributedRevenueBySource.entries()]
    .filter(([, revenue]) => revenue > 0)
    .sort((left, right) => right[1] - left[1])[0];

  if (!topSource) {
    return null;
  }

  const [source, revenue] = topSource;
  const metric = roundMetric(revenue);

  return {
    type: 'positive',
    title: 'High-performing source',
    description: `${source} has the highest attributed revenue in the current intelligence data.`,
    source,
    metric,
  };
}

function buildUnderperformingSourceInsight(
  sourcePerformance: SourcePerformanceAggregate[]
): IntelligenceInsight | null {
  const candidates = sourcePerformance.filter((source) => source.leads > 0);
  const noRevenueCandidates = candidates
    .filter((source) => source.revenue <= 0)
    .sort((left, right) => right.leads - left.leads);

  const underperformingSource = noRevenueCandidates[0];
  if (!underperformingSource) {
    return null;
  }

  return {
    type: 'negative',
    title: 'Underperforming source',
    description: `${underperformingSource.source} has ${underperformingSource.leads} lead touchpoint(s) but no recorded revenue.`,
    source: underperformingSource.source,
    metric: 0,
  };
}

function buildGapHeavySourceInsight(openGapsBySource: Map<string, number>): IntelligenceInsight | null {
  const topSource = [...openGapsBySource.entries()]
    .filter(([, gapCount]) => gapCount > 0)
    .sort((left, right) => right[1] - left[1])[0];

  if (!topSource) {
    return null;
  }

  const [source, gapCount] = topSource;

  return {
    type: 'warning',
    title: 'Gap-heavy area',
    description: `${source} has the most open intelligence gaps.`,
    source,
    metric: gapCount,
  };
}

export async function getIntelligenceInsights(companyId: string): Promise<IntelligenceInsight[]> {
  const normalizedCompanyId = normalizeCompanyId(companyId);

  const [attributedRevenueBySource, sourcePerformance, openGapsBySource] = await Promise.all([
    loadAttributedRevenueBySource(normalizedCompanyId),
    loadSourcePerformance(normalizedCompanyId),
    loadOpenGapsBySource(normalizedCompanyId),
  ]);

  const insights = [
    buildHighPerformingSourceInsight(attributedRevenueBySource),
    buildUnderperformingSourceInsight(sourcePerformance),
    buildGapHeavySourceInsight(openGapsBySource),
  ].filter((insight): insight is IntelligenceInsight => Boolean(insight));

  return insights;
}
