import type { ExternalApiSource, TrendSignal, ExternalApiFetchResult, ExternalApiHealth } from './types';
import type { TrendSignalInput } from '../omnivyraClientV1';

// ── Source reliability weights ────────────────────────────────────────────────
const sourceReliabilityWeights: Record<string, number> = {
  youtube: 0.95,
  newsapi: 0.75,
  reddit: 0.7,
  serpapi: 0.85,
  google: 0.85,
  omnivyra: 1,
  other: 0.6,
};

export let lastSignalConfidenceSummary: { average: number; min: number; max: number } | null = null;

export const getSourceWeight = (source?: string) => {
  if (!source) return sourceReliabilityWeights.other;
  const normalized = source.toLowerCase();
  if (normalized.includes('youtube')) return sourceReliabilityWeights.youtube;
  if (normalized.includes('news')) return sourceReliabilityWeights.newsapi;
  if (normalized.includes('reddit')) return sourceReliabilityWeights.reddit;
  if (normalized.includes('serp') || normalized.includes('google')) return sourceReliabilityWeights.serpapi;
  if (normalized.includes('omnivyra')) return sourceReliabilityWeights.omnivyra;
  return sourceReliabilityWeights.other;
};

export const computeSignalConfidence = (input: {
  source: string;
  health_score?: number | null;
  freshness?: number | null;
  reliability?: number | null;
}) => {
  const base = getSourceWeight(input.source);
  const health = input.health_score ?? 1;
  const freshness = input.freshness ?? 1;
  const reliability = input.reliability ?? 1;
  const score = base * health * freshness * reliability;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
};

export const resetSignalConfidenceSummary = () => {
  lastSignalConfidenceSummary = null;
};

export const recordSignalConfidenceSummary = (confidences: number[]) => {
  if (!confidences.length) {
    lastSignalConfidenceSummary = null;
    return;
  }
  const avg = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  lastSignalConfidenceSummary = {
    average: Number(avg.toFixed(3)),
    min: Number(Math.min(...confidences).toFixed(3)),
    max: Number(Math.max(...confidences).toFixed(3)),
  };
};

export function normalizeTrendSignals(
  rawApiResults: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
    health_score?: number | null;
  }>
): TrendSignal[] {
  const signals: TrendSignal[] = [];

  rawApiResults.forEach(({ source, payload, health, health_score }) => {
    if (!payload) return;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    items.forEach((item: any) => {
      if (!item?.topic) return;
      const freshness = health?.freshness_score ?? 1;
      const reliability = health?.reliability_score ?? 1;
      signals.push({
        topic: item.topic,
        source: source.name,
        geo: item.geo,
        velocity: item.velocity,
        sentiment: item.sentiment,
        volume: item.volume,
        trend_source_health: health ?? undefined,
        signal_confidence: computeSignalConfidence({
          source: source.name,
          health_score: health_score ?? 1,
          freshness,
          reliability,
        }),
      });
    });
  });

  if (signals.length > 0) {
    const confidences = signals
      .map((signal) => signal.signal_confidence ?? 0)
      .filter((value) => Number.isFinite(value));
    if (confidences.length > 0) {
      const avg = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
      lastSignalConfidenceSummary = {
        average: Number(avg.toFixed(3)),
        min: Number(Math.min(...confidences).toFixed(3)),
        max: Number(Math.max(...confidences).toFixed(3)),
      };
    }
  }

  return signals;
}

export const toTrendInput = (signal: TrendSignal): TrendSignalInput => ({
  topic: signal.topic,
  source: signal.source,
  geo: signal.geo,
  velocity: signal.velocity,
  sentiment: signal.sentiment,
  volume: signal.volume,
});

export const mapOmniVyraTrends = (
  omnivyraTrends: Array<TrendSignalInput | { topic: string } | string> | undefined,
  fallbackSignals: TrendSignal[]
): TrendSignal[] => {
  if (!omnivyraTrends || omnivyraTrends.length === 0) return fallbackSignals;
  const byTopic = new Map<string, TrendSignal>();
  fallbackSignals.forEach((signal) => {
    byTopic.set(signal.topic.toLowerCase(), signal);
  });
  return omnivyraTrends
    .map((trend) => {
      const topic =
        typeof trend === 'string' ? trend : (trend as any)?.topic ?? (trend as any)?.title;
      if (!topic) return null;
      const match = byTopic.get(String(topic).toLowerCase());
      if (match) return match;
      return {
        topic: String(topic),
        source: (trend as any)?.source || 'omnivyra',
        geo: (trend as any)?.geo,
        velocity: (trend as any)?.velocity,
        sentiment: (trend as any)?.sentiment,
        volume: (trend as any)?.volume,
      } as TrendSignal;
    })
    .filter(Boolean) as TrendSignal[];
};

export const applyRankingOrder = (
  ranking: Array<any> | undefined,
  signals: TrendSignal[]
): TrendSignal[] => {
  if (!ranking || ranking.length === 0) return signals;
  const byTopic = new Map<string, TrendSignal>();
  signals.forEach((signal) => byTopic.set(signal.topic.toLowerCase(), signal));
  const ordered = ranking
    .map((trend) => {
      const topic =
        typeof trend === 'string' ? trend : (trend as any)?.topic ?? (trend as any)?.title;
      if (!topic) return null;
      return byTopic.get(String(topic).toLowerCase()) ?? null;
    })
    .filter(Boolean) as TrendSignal[];
  return ordered.length > 0 ? ordered : signals;
};

export const computeFreshnessScore = (lastSuccessAt?: string | null): number => {
  if (!lastSuccessAt) return 0;
  const last = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(last)) return 0;
  const now = Date.now();
  const diffHours = (now - last) / (1000 * 60 * 60);
  if (diffHours <= 24) return 1;
  const decayWindowHours = 24 * 6;
  const decay = Math.max(0, 1 - (diffHours - 24) / decayWindowHours);
  return Number(decay.toFixed(3));
};

export const computeReliabilityScore = (successCount: number, failureCount: number): number => {
  const total = successCount + failureCount;
  if (total === 0) return 1;
  return Number((successCount / total).toFixed(3));
};
