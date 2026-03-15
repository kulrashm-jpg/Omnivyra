import { TrendSignal } from './externalApiService';
import {
  insertNormalizedSignals,
  type NormalizedSignalInput,
} from './intelligenceSignalStore';
import { normalizeSignalSource } from './signalNormalizationService';

/** Lineage: trace recommendation back to originating signal. */
export type SignalLineageMeta = {
  signal_id?: string | null;
  signal_type?: 'EXTERNAL_API' | 'OMNIVYRA' | 'COMMUNITY' | 'MANUAL' | null;
  source_topic?: string | null;
};

export type TrendSignalNormalized = TrendSignal & {
  sources: string[];
  frequency: number;
  platform_tag?: string;
  /** Regions this signal was seen in (multi-region merge). */
  regions?: string[];
  /** Lineage: FK to intelligence_signals, provenance, original topic. */
  signal_id?: string | null;
  signal_type?: 'EXTERNAL_API' | 'OMNIVYRA' | 'COMMUNITY' | 'MANUAL' | null;
  source_topic?: string | null;
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

/** Derive source_signal_type from source string for lineage. */
export function deriveSignalTypeFromSource(source: string | { id?: string; name?: string } | undefined): 'EXTERNAL_API' | 'OMNIVYRA' | 'COMMUNITY' | 'MANUAL' | null {
  const s = typeof source === 'string' ? source.toLowerCase() : String((source as any)?.id ?? (source as any)?.name ?? '').toLowerCase();
  if (s.includes('omnivyra') || s.includes('omni_vyra')) return 'OMNIVYRA';
  if (s.includes('community') || s.includes('community_ai')) return 'COMMUNITY';
  if (s.includes('manual') || s.includes('detected_opportunity') || s.includes('opportunity') || s.includes('strategic_themes') || s.includes('ai_generated')) return 'MANUAL';
  if (s && s !== 'unknown') return 'EXTERNAL_API';
  return null;
}

export const mergeTrendsAcrossSources = (signals: TrendSignal[]): TrendSignalNormalized[] => {
  const groups = new Map<string, TrendSignalNormalized>();
  signals.forEach((signal) => {
    const key = normalizeTopic(signal.topic);
    const srcRaw = (signal as any).source;
    const src = typeof srcRaw === 'string' ? srcRaw : (srcRaw?.id ?? srcRaw?.name ?? 'unknown');
    const existing = groups.get(key);
    if (!existing) {
      const first: TrendSignalNormalized = {
        ...signal,
        topic: signal.topic.trim(),
        sources: src ? [src] : [],
        frequency: 1,
      };
      const signalType = deriveSignalTypeFromSource(src);
      if (signalType) first.signal_type = signalType;
      first.source_topic = signal.topic?.trim() ?? null;
      if ((signal as any).signal_id) first.signal_id = (signal as any).signal_id;
      if ((signal as any).signal_type) first.signal_type = (signal as any).signal_type;
      if ((signal as any).source_topic) first.source_topic = (signal as any).source_topic;
      groups.set(key, first);
    } else {
      existing.sources = Array.from(new Set([...existing.sources, String(src || 'unknown')]));
      existing.frequency += 1;
      existing.volume = Math.max(existing.volume ?? 0, signal.volume ?? 0) || existing.volume;
      existing.velocity = Math.max(existing.velocity ?? 0, signal.velocity ?? 0) || existing.velocity;
      existing.sentiment = Math.max(existing.sentiment ?? 0, signal.sentiment ?? 0) || existing.sentiment;
      if (!existing.signal_id && (signal as any).signal_id) {
        existing.signal_id = (signal as any).signal_id;
        existing.signal_type = (signal as any).signal_type ?? existing.signal_type;
        existing.source_topic = (signal as any).source_topic ?? existing.source_topic;
      }
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
    const source = normalizeSignalSource(signal.source);
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
    const firstSrc = typeof (first as any).source === 'string' ? (first as any).source : ((first as any).source?.id ?? (first as any).source?.name ?? '');
    const mergedItem: TrendSignalNormalized = {
      ...first,
      topic: first.topic.trim(),
      sources: Array.from(new Set([firstSrc].filter(Boolean))),
      frequency: regions.length,
      volume: Math.round(avgVolume * 100) / 100,
      signal_confidence: Math.min(1, Math.round(avgConf * 1000) / 1000),
      regions,
    };
    if ((first as any).signal_id) mergedItem.signal_id = (first as any).signal_id;
    if ((first as any).signal_type) mergedItem.signal_type = (first as any).signal_type;
    else {
      const st = deriveSignalTypeFromSource(firstSrc);
      if (st) mergedItem.signal_type = st;
    }
    mergedItem.source_topic = (first as any).source_topic ?? first.topic?.trim() ?? null;
    merged.push(mergedItem);
  }
  return scoreByFrequency(merged);
};

/**
 * Persist normalized trend signals to the unified intelligence signal store.
 * Does not change any existing return values; call when you have sourceApiId and want to store.
 */
export async function persistNormalizedTrendSignals(
  signals: TrendSignalNormalized[],
  options: {
    sourceApiId: string;
    companyId?: string | null;
    detectedAt?: Date;
    signalType?: string;
  }
): Promise<{ inserted: number; skipped: number }> {
  if (!signals.length) return { inserted: 0, skipped: 0 };
  const detectedAt = options.detectedAt ?? new Date();
  const detectedAtStr = typeof detectedAt === 'string' ? detectedAt : detectedAt.toISOString();
  const inputs: NormalizedSignalInput[] = signals.map((s) => ({
    source_api_id: options.sourceApiId,
    company_id: options.companyId ?? null,
    signal_type: options.signalType ?? 'trend',
    topic: s.topic ?? null,
    confidence_score: s.signal_confidence ?? null,
    detected_at: detectedAtStr,
    normalized_payload: {
      topic: s.topic,
      sources: s.sources,
      frequency: s.frequency,
      volume: s.volume,
      velocity: s.velocity,
      platform_tag: s.platform_tag,
      regions: s.regions,
    },
    topics: s.topic ? [s.topic] : [],
  }));
  const result = await insertNormalizedSignals(inputs, {
    signal_type: options.signalType ?? 'trend',
  });
  return { inserted: result.inserted, skipped: result.skipped };
}
