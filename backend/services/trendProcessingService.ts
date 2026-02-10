import { TrendSignal } from './externalApiService';

export type TrendSignalNormalized = TrendSignal & {
  sources: string[];
  frequency: number;
  platform_tag?: string;
  /** Regions this signal was seen in (multi-region merge). */
  regions?: string[];
};

const normalizeTopic = (topic: string) => topic.trim().toLowerCase();

export const normalizeTrendSignals = (rawApiResponses: Array<any>): TrendSignal[] => {
  if (!Array.isArray(rawApiResponses)) return [];
  return rawApiResponses
    .map((item) => ({
      topic: String(item?.topic || item?.title || '').trim(),
      source: String(item?.source || item?.trend_source || 'unknown'),
      geo: item?.geo ? String(item.geo) : undefined,
      velocity: typeof item?.velocity === 'number' ? item.velocity : undefined,
      sentiment: typeof item?.sentiment === 'number' ? item.sentiment : undefined,
      volume: typeof item?.volume === 'number' ? item.volume : undefined,
      trend_source_health: item?.trend_source_health,
    }))
    .filter((item) => item.topic.length > 0);
};

export const removeDuplicates = (signals: TrendSignal[]): TrendSignal[] => {
  const seen = new Set<string>();
  const unique: TrendSignal[] = [];
  signals.forEach((signal) => {
    const key = normalizeTopic(signal.topic);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(signal);
  });
  return unique;
};

export const mergeTrendsAcrossSources = (signals: TrendSignal[]): TrendSignalNormalized[] => {
  const groups = new Map<string, TrendSignalNormalized>();
  signals.forEach((signal) => {
    const key = normalizeTopic(signal.topic);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...signal,
        topic: signal.topic.trim(),
        sources: signal.source ? [signal.source] : [],
        frequency: 1,
      });
    } else {
      existing.sources = Array.from(new Set([...existing.sources, signal.source || 'unknown']));
      existing.frequency += 1;
      existing.volume = Math.max(existing.volume ?? 0, signal.volume ?? 0) || existing.volume;
      existing.velocity = Math.max(existing.velocity ?? 0, signal.velocity ?? 0) || existing.velocity;
      existing.sentiment = Math.max(existing.sentiment ?? 0, signal.sentiment ?? 0) || existing.sentiment;
    }
  });
  return Array.from(groups.values());
};

export const scoreByFrequency = (signals: TrendSignalNormalized[]): TrendSignalNormalized[] => {
  return [...signals].sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    const bVolume = b.volume ?? 0;
    const aVolume = a.volume ?? 0;
    return bVolume - aVolume;
  });
};

export const tagByPlatform = (signals: TrendSignalNormalized[]): TrendSignalNormalized[] => {
  return signals.map((signal) => {
    const source = (signal.source || '').toLowerCase();
    let platform_tag = signal.platform_tag;
    if (source.includes('youtube')) platform_tag = 'youtube';
    else if (source.includes('reddit')) platform_tag = 'reddit';
    else if (source.includes('news')) platform_tag = 'news';
    else if (source.includes('google') || source.includes('serp')) platform_tag = 'google';
    return { ...signal, platform_tag };
  });
};

/** Per-region signal with region code. */
export type RegionSignal = { region: string; signal: TrendSignal };

/**
 * Merge signals from multiple regions: dedupe by topic, score by average + recency weighting, attach region metadata.
 */
export const mergeSignalsAcrossRegions = (
  perRegion: Array<{ region: string; signals: TrendSignal[] }>
): TrendSignalNormalized[] => {
  const byTopic = new Map<
    string,
    { regions: string[]; volumes: number[]; confidences: number[]; recencyWeights: number[]; first: TrendSignal }
  >();
  let regionIndex = 0;
  for (const { region, signals } of perRegion) {
    const recencyWeight = 1 + 0.1 * regionIndex;
    regionIndex += 1;
    for (const signal of signals) {
      const key = normalizeTopic(signal.topic);
      if (!key) continue;
      const existing = byTopic.get(key);
      const vol = signal.volume ?? 0;
      const conf = signal.signal_confidence ?? 0.5;
      if (!existing) {
        byTopic.set(key, {
          regions: [region],
          volumes: [vol],
          confidences: [conf],
          recencyWeights: [recencyWeight],
          first: signal,
        });
      } else {
        existing.regions.push(region);
        existing.volumes.push(vol);
        existing.confidences.push(conf);
        existing.recencyWeights.push(recencyWeight);
      }
    }
  }
  const merged: TrendSignalNormalized[] = [];
  for (const [topicKey, data] of byTopic.entries()) {
    const { regions, volumes, confidences, recencyWeights, first } = data;
    const sumW = recencyWeights.reduce((a, b) => a + b, 0);
    const avgVolume =
      sumW > 0
        ? volumes.reduce((acc, v, i) => acc + v * recencyWeights[i], 0) / sumW
        : (volumes[0] ?? 0);
    const avgConf =
      sumW > 0
        ? confidences.reduce((acc, c, i) => acc + c * recencyWeights[i], 0) / sumW
        : (confidences[0] ?? 0.5);
    merged.push({
      ...first,
      topic: first.topic.trim(),
      sources: Array.from(new Set([first.source].filter(Boolean))),
      frequency: regions.length,
      volume: Math.round(avgVolume * 100) / 100,
      signal_confidence: Math.min(1, Math.round(avgConf * 1000) / 1000),
      regions,
    });
  }
  return scoreByFrequency(merged);
};
