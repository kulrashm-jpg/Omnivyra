import { normalizeSignalSource } from './signalNormalizationService';

export type TrendSignal = {
  topic: string;
  source?: string;
  sources?: string[];
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  frequency?: number;
  platform_tag?: string;
};

export const CONFIDENCE_THRESHOLDS = {
  high: 0.75,
  medium: 0.4,
};

export const getConfidenceLabel = (ratio: number) => {
  if (ratio >= CONFIDENCE_THRESHOLDS.high) return { label: 'High', className: 'text-green-700' };
  if (ratio >= CONFIDENCE_THRESHOLDS.medium) return { label: 'Medium', className: 'text-yellow-700' };
  return { label: 'Low', className: 'text-red-700' };
};

export const hasNoExternalSignals = (placeholders?: string[]) =>
  (placeholders || []).includes('no_external_signals');

export const shouldShowNoveltyWarning = (noveltyScore?: number) =>
  typeof noveltyScore === 'number' && noveltyScore > 0.6;

export const buildTrendSourceCounts = (trends: TrendSignal[]) => {
  const counts: Record<string, number> = {
    youtube: 0,
    newsapi: 0,
    reddit: 0,
    serpapi: 0,
    omnivyra: 0,
    ignored: 0,
  };
  trends.forEach((trend) => {
    const sources = trend.sources && trend.sources.length > 0 ? trend.sources : trend.source ? [trend.source] : [];
    if (sources.length === 0) return;
    sources.forEach((source) => {
      const normalized = normalizeSignalSource(source);
      if (normalized.includes('youtube')) counts.youtube += 1;
      else if (normalized.includes('news')) counts.newsapi += 1;
      else if (normalized.includes('reddit')) counts.reddit += 1;
      else if (normalized.includes('serp') || normalized.includes('google')) counts.serpapi += 1;
      else if (normalized.includes('omnivyra')) counts.omnivyra += 1;
    });
  });
  return counts;
};
