import type {
  ActionableIntelligenceItem,
  DashboardGapItem,
  IntelligencePriority,
} from './intelligenceResponseMapper';
import { normalizeMetadata } from './intelligenceResponseMapper';
import type { IntelligenceInsight } from './insightsService';

type SourcePerformanceInput = {
  source: string;
  leads: number;
  revenue: number;
};

export type CmoIntelligenceItem = {
  title: string;
  description: string;
  source: string | null;
  metric: number | null;
  priority?: IntelligencePriority;
  score?: number | null;
  confidence?: number | null;
  reference_id?: string;
  suggested_action?: string;
};

export type CmoIntelligenceSummary = {
  what_is_working: CmoIntelligenceItem[];
  what_is_not_working: CmoIntelligenceItem[];
  biggest_risks: CmoIntelligenceItem[];
  next_best_actions: CmoIntelligenceItem[];
};

export type CmoIntelligenceInput = {
  insights: IntelligenceInsight[];
  sourcePerformance: SourcePerformanceInput[];
  topGaps: DashboardGapItem[];
  actionableItems: ActionableIntelligenceItem[];
};

const MAX_ITEMS_PER_SECTION = 5;

function normalizeSource(value: unknown): string {
  return String(value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function sourceFromGap(gap: DashboardGapItem): string {
  const metadata = normalizeMetadata(gap.metadata);
  const unifiedSource = normalizeMetadata(metadata.unified_source);

  return normalizeSource(
    metadata.source ??
      unifiedSource.provider ??
      unifiedSource.category ??
      gap.metadata.provider ??
      'unknown'
  );
}

function mapWorkingInsights(insights: IntelligenceInsight[]): CmoIntelligenceItem[] {
  return insights
    .filter((insight) => insight.type === 'positive')
    .sort((left, right) => right.metric - left.metric)
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((insight) => ({
      title: insight.title,
      description: insight.description,
      source: normalizeSource(insight.source),
      metric: roundMetric(insight.metric),
    }));
}

function mapWorkingFallback(sourcePerformance: SourcePerformanceInput[]): CmoIntelligenceItem[] {
  return sourcePerformance
    .filter((source) => source.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((source) => ({
      title: 'Revenue-producing source',
      description: `${source.source} is producing recorded revenue in the current intelligence data.`,
      source: normalizeSource(source.source),
      metric: roundMetric(source.revenue),
    }));
}

function mapNotWorkingSources(sourcePerformance: SourcePerformanceInput[]): CmoIntelligenceItem[] {
  return sourcePerformance
    .filter((source) => source.leads > 0 && source.revenue <= 0)
    .sort((left, right) => right.leads - left.leads)
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((source) => ({
      title: 'Leads without revenue',
      description: `${source.source} has ${source.leads} lead touchpoint(s) but no recorded revenue.`,
      source: normalizeSource(source.source),
      metric: source.leads,
    }));
}

function mapHighScoreGapRisks(topGaps: DashboardGapItem[]): CmoIntelligenceItem[] {
  return topGaps
    .filter((gap) => gap.priority === 'high' || gap.score >= 80)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((gap) => ({
      title: gap.title,
      description: gap.description,
      source: sourceFromGap(gap),
      metric: gap.score,
      priority: gap.priority,
      score: gap.score,
      confidence: gap.confidence,
      reference_id: gap.id,
      suggested_action:
        typeof gap.metadata.suggested_action === 'string'
          ? gap.metadata.suggested_action
          : undefined,
    }));
}

function mapMissingRevenueClusters(topGaps: DashboardGapItem[]): CmoIntelligenceItem[] {
  const clusters = new Map<string, number>();

  for (const gap of topGaps) {
    if (gap.gap_type !== 'missing_revenue') {
      continue;
    }

    const source = sourceFromGap(gap);
    clusters.set(source, (clusters.get(source) ?? 0) + 1);
  }

  return [...clusters.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map(([source, count]) => ({
      title: 'Missing revenue cluster',
      description: `${source} has multiple open missing-revenue gaps.`,
      source,
      metric: count,
      priority: 'high' as IntelligencePriority,
    }));
}

function mapNextBestActions(actionableItems: ActionableIntelligenceItem[]): CmoIntelligenceItem[] {
  return actionableItems
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((item) => ({
      title: item.suggested_action,
      description: item.description,
      source: null,
      metric: item.score,
      priority: item.priority,
      score: item.score,
      confidence: item.confidence,
      reference_id: item.id,
      suggested_action: item.suggested_action,
    }));
}

export function buildCmoIntelligenceSummary(input: CmoIntelligenceInput): CmoIntelligenceSummary {
  const whatIsWorking = mapWorkingInsights(input.insights);
  const gapRisks = mapHighScoreGapRisks(input.topGaps);
  const clusterRisks = mapMissingRevenueClusters(input.topGaps);
  const riskByKey = new Map<string, CmoIntelligenceItem>();

  for (const risk of [...gapRisks, ...clusterRisks]) {
    const key = `${risk.title}:${risk.source ?? 'none'}:${risk.reference_id ?? ''}`;
    riskByKey.set(key, risk);
  }

  return {
    what_is_working:
      whatIsWorking.length > 0
        ? whatIsWorking
        : mapWorkingFallback(input.sourcePerformance),
    what_is_not_working: mapNotWorkingSources(input.sourcePerformance),
    biggest_risks: [...riskByKey.values()]
      .sort((left, right) => (right.score ?? right.metric ?? 0) - (left.score ?? left.metric ?? 0))
      .slice(0, MAX_ITEMS_PER_SECTION),
    next_best_actions: mapNextBestActions(input.actionableItems),
  };
}
