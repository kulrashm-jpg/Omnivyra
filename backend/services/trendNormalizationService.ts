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
  const source = ctx.sourceName || 'YouTube';
  const confidence = 0.8;
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
        source,
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeNewsApiTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const articles = Array.isArray(raw?.articles) ? raw.articles : [];
  const source = ctx.sourceName || 'NewsAPI';
  const confidence = 0.7;
  const totalResults = typeof raw?.totalResults === 'number' ? raw.totalResults : undefined;
  return articles
    .map((article: any) => {
      const title = normalizeString(article?.title);
      if (!title) return null;
      const description = normalizeString(article?.description || article?.content);
      const volume = totalResults;
      return {
        source,
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: article,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

/**
 * Google Trends RSS — after RSS→JSON conversion: response.rss.channel[0].item[]
 */
export const normalizeGoogleTrendsRss = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const source = ctx.sourceName || 'GoogleTrends';
  const confidence = 0.75;
  const channel = raw?.rss?.channel;
  const channelObj = Array.isArray(channel) ? channel[0] : channel;
  const items = Array.isArray(channelObj?.item) ? channelObj.item : [];
  const signals = items
    .map((item: any) => {
      const title = normalizeString(item?.title);
      if (!title) return null;
      const description = normalizeString(item?.description || item?.link || '');
      return {
        source,
        title,
        description,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
  if (signals.length > 0) {
    console.log('[normalize] google trends signals extracted', { count: signals.length });
  }
  return signals;
};

export const normalizeRedditTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const children = Array.isArray(raw?.data?.children) ? raw.data.children : [];
  const source = ctx.sourceName || 'Reddit';
  const confidence = 0.65;
  const signals = children
    .map((item: any) => {
      const post = item?.data || item;
      const title = normalizeString(post?.title || post?.name);
      if (!title) return null;
      const description = normalizeString(post?.subreddit || post?.selftext || '');
      const volume =
        typeof post?.score === 'number'
          ? post.score
          : typeof post?.ups === 'number'
            ? post.ups
            : typeof post?.upvotes === 'number'
              ? post.upvotes
              : undefined;
      return {
        source,
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: post,
      };
    })
    .filter(Boolean) as TrendSignal[];
  if (signals.length > 0) {
    console.log('[normalize] reddit signals extracted', { count: signals.length });
  }
  return signals;
};

const extractGenericList = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.organic_results)) return raw.organic_results;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
};

export const normalizeGenericTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const items = extractGenericList(raw);
  const source = ctx.sourceName || 'GenericAPI';
  const confidence = 0.5;
  return items
    .map((item: any) => {
      const title = normalizeString(
        item?.title ||
          item?.name ||
          item?.query ||
          item?.topic ||
          item?.keyword ||
          item?.term ||
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
        source,
        title,
        description,
        volume: volumeCandidate,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];
};

export const normalizeSerpApiTrends = (raw: any, ctx: NormalizationContext = {}): TrendSignal[] => {
  const source = ctx.sourceName || 'SerpAPI';
  const confidence = 0.6;
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
      const title = normalizeString(item?.query || item?.title || item?.keyword || item?.topic);
      if (!title) return null;
      const description = normalizeString(item?.description || '');
      const volume = typeof item?.value === 'number' ? item.value : undefined;
      return {
        source,
        title,
        description,
        volume,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
        raw: item,
      };
    })
    .filter(Boolean) as TrendSignal[];

  if (fromTrendResults.length > 0) return fromTrendResults;

  return timeline
    .map((item: any) => {
      const title = normalizeString(
        item?.query || item?.keyword || item?.topic || item?.title || item?.formattedTime || item?.time || item?.date
      );
      if (!title) return null;
      const description = normalizeString(item?.topic || item?.title || item?.description || '');
      const volume = Array.isArray(item?.value) ? Number(item.value[0]) : item?.value;
      return {
        source,
        title,
        description,
        volume: typeof volume === 'number' ? volume : undefined,
        geo: ctx.geo,
        category: ctx.category,
        confidence,
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
  const payload = input.payload;
  const normalizedName = sourceName.toLowerCase();

  // Structure-based detection (before source name)
  if (payload && typeof payload === 'object' && payload.rss?.channel) {
    const signals = normalizeGoogleTrendsRss(payload, context);
    if (signals.length > 0) return signals;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.data?.children)) {
    const signals = normalizeRedditTrends(payload, context);
    if (signals.length > 0) return signals;
  }

  // Source name-based detection
  let signals: TrendSignal[] = [];
  if (normalizedName.includes('youtube')) {
    signals = normalizeYouTubeTrends(payload, context);
  } else if (normalizedName.includes('news')) {
    signals = normalizeNewsApiTrends(payload, context);
  } else if (normalizedName.includes('reddit')) {
    signals = normalizeRedditTrends(payload, context);
  } else if (normalizedName.includes('serp') || normalizedName.includes('google')) {
    signals = normalizeSerpApiTrends(payload, context);
  } else if (normalizedName.includes('google')) {
    signals = normalizeGoogleTrendsRss(payload, context);
  } else {
    signals = normalizeGenericTrends(payload, context);
  }
  if (signals.length === 0) {
    signals = normalizeGenericTrends(payload, { ...context, sourceName: sourceName || 'GenericAPI' });
  }
  return signals;
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
  const filtered = (normalized ?? []).filter((item) => item && item.title);
  const sourceNames = rawResults.map((r) => r.source?.name ?? r.source?.id ?? 'unknown').join(', ');
  if (filtered.length === 0) {
    const payloadHints = rawResults.map((r) => {
      if (!r.payload) return 'null';
      if (Array.isArray(r.payload)) return `array[${r.payload.length}]`;
      if (typeof r.payload === 'object') return `keys:${Object.keys(r.payload).slice(0, 5).join(',')}`;
      return typeof r.payload;
    });
    console.log('[normalize] no signals extracted', { sources: sourceNames || 'none', payloadHints });
  } else {
    console.log('[normalize] signals extracted', { count: filtered.length, sources: sourceNames });
  }
  return filtered;
};
