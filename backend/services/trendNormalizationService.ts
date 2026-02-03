import { ExternalApiSource, ExternalApiHealth } from './externalApiService';

export type TrendSignal = {
  source: string;
  title: string;
  description: string;
  volume?: number;
  geo?: string;
  category?: string;
  confidence: number;
  raw: any;
};

type NormalizationContext = {
  geo?: string;
  category?: string;
  sourceName?: string;
  health?: ExternalApiHealth | null;
};

const clampConfidence = (value: number) => Math.max(0, Math.min(1, value));

const baseConfidenceBySource = (sourceName?: string) => {
  const name = (sourceName || '').toLowerCase();
  if (name.includes('youtube')) return 0.85;
  if (name.includes('news')) return 0.75;
  if (name.includes('serp') || name.includes('google')) return 0.8;
  return 0.6;
};

const computeConfidence = (input: {
  sourceName?: string;
  health?: ExternalApiHealth | null;
  volume?: number;
}): number => {
  const base = baseConfidenceBySource(input.sourceName);
  const healthFactor =
    (input.health?.freshness_score ?? 1) * (input.health?.reliability_score ?? 1);
  const volumeBoost = typeof input.volume === 'number' && input.volume > 0 ? 0.05 : 0;
  return clampConfidence(Number((base * healthFactor + volumeBoost).toFixed(3)));
};

const normalizeString = (value: any) => String(value || '').trim();

export const normalizeYouTubeTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items
    .map((item: any) => {
      const title = normalizeString(item?.snippet?.title || item?.title);
      if (!title) return null;
      const description = normalizeString(item?.snippet?.description || item?.description);
      const volume = item?.statistics?.viewCount
        ? Number(item.statistics.viewCount)
        : typeof item?.viewCount === 'number'
        ? item.viewCount
        : undefined;
      return {
        source: ctx.sourceName || 'YouTube',
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({ sourceName: ctx.sourceName, health: ctx.health, volume }),
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeNewsApiTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const articles = Array.isArray(raw?.articles) ? raw.articles : [];
  const totalResults = typeof raw?.totalResults === 'number' ? raw.totalResults : undefined;
  return articles
    .map((article: any) => {
      const title = normalizeString(article?.title);
      if (!title) return null;
      const description = normalizeString(article?.description || article?.content);
      const volume = totalResults;
      return {
        source: ctx.sourceName || 'NewsAPI',
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({ sourceName: ctx.sourceName, health: ctx.health, volume }),
        raw: article,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeRedditTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const children = Array.isArray(raw?.data?.children) ? raw.data.children : [];
  return children
    .map((item: any) => {
      const data = item?.data || item;
      const title = normalizeString(data?.title || data?.name);
      if (!title) return null;
      const description = normalizeString(data?.subreddit || data?.selftext || '');
      const volume = typeof data?.score === 'number'
        ? data.score
        : typeof data?.ups === 'number'
        ? data.ups
        : typeof data?.upvotes === 'number'
        ? data.upvotes
        : undefined;
      return {
        source: ctx.sourceName || 'Reddit',
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({ sourceName: ctx.sourceName, health: ctx.health, volume }),
        raw: data,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

const extractGenericList = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
};

export const normalizeGenericTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const items = extractGenericList(raw);
  return items
    .map((item: any) => {
      const title = normalizeString(
        item?.title ||
          item?.name ||
          item?.topic ||
          item?.query ||
          item?.term ||
          item?.keyword ||
          item?.headline
      );
      if (!title) return null;
      const description = normalizeString(item?.description || item?.snippet || item?.summary || item?.url || '');
      const volumeCandidate =
        typeof item?.score === 'number'
          ? item.score
          : typeof item?.volume === 'number'
          ? item.volume
          : typeof item?.count === 'number'
          ? item.count
          : typeof item?.views === 'number'
          ? item.views
          : undefined;
      return {
        source: ctx.sourceName || 'External API',
        title,
        description,
        volume: volumeCandidate,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({
          sourceName: ctx.sourceName,
          health: ctx.health,
          volume: volumeCandidate,
        }),
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeSerpApiTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const trendResults = Array.isArray(raw?.trend_results)
    ? raw.trend_results
    : Array.isArray(raw?.related_queries)
    ? raw.related_queries
    : [];
  const timeline = Array.isArray(raw?.interest_over_time?.timeline_data)
    ? raw.interest_over_time.timeline_data
    : [];
  const fromTrendResults = trendResults
    .map((item: any) => {
      const title = normalizeString(item?.query || item?.topic || item?.title);
      if (!title) return null;
      const description = normalizeString(item?.description || '');
      const volume = typeof item?.value === 'number' ? item.value : undefined;
      return {
        source: ctx.sourceName || 'SerpAPI',
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({ sourceName: ctx.sourceName, health: ctx.health, volume }),
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];

  if (fromTrendResults.length > 0) return fromTrendResults;

  return timeline
    .map((item: any) => {
      const title = normalizeString(item?.formattedTime || item?.time || item?.date);
      if (!title) return null;
      const description = normalizeString(item?.topic || item?.title || '');
      const volume = Array.isArray(item?.value) ? Number(item.value[0]) : item?.value;
      return {
        source: ctx.sourceName || 'SerpAPI',
        title,
        description,
        volume: typeof volume === 'number' ? volume : undefined,
        geo: ctx.geo,
        category: ctx.category,
        confidence: computeConfidence({ sourceName: ctx.sourceName, health: ctx.health, volume }),
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeExternalTrends = (input: {
  source: ExternalApiSource;
  payload: any;
  health?: ExternalApiHealth | null;
  geo?: string;
  category?: string;
}): TrendSignal[] => {
  const sourceName = input.source?.name || 'External API';
  const context: NormalizationContext = {
    geo: input.geo,
    category: input.category,
    sourceName,
    health: input.health,
  };
  const normalizedName = sourceName.toLowerCase();
  if (normalizedName.includes('youtube')) return normalizeYouTubeTrends(input.payload, context);
  if (normalizedName.includes('news')) return normalizeNewsApiTrends(input.payload, context);
  if (normalizedName.includes('reddit')) return normalizeRedditTrends(input.payload, context);
  if (normalizedName.includes('serp') || normalizedName.includes('google'))
    return normalizeSerpApiTrends(input.payload, context);
  return normalizeGenericTrends(input.payload, context);
};

export const normalizeTrends = (
  rawResults: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: ExternalApiHealth | null;
    geo?: string;
    category?: string;
  }>
): TrendSignal[] => {
  const normalized = rawResults.flatMap((result) =>
    normalizeExternalTrends({
      source: result.source,
      payload: result.payload,
      health: result.health ?? null,
      geo: result.geo,
      category: result.category,
    })
  );
  return normalized.filter((item) => item.title);
};
