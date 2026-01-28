import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import {
  getTrendRanking,
  getTrendRelevance,
  isOmniVyraEnabled,
  TrendSignalInput,
} from './omnivyraClientV1';

export type ExternalApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  is_active: boolean;
  auth_type: string;
  api_key_name?: string | null;
  platform_type?: string;
  supported_content_types?: string[];
  promotion_modes?: string[];
  required_metadata?: Record<string, any>;
  posting_constraints?: Record<string, any>;
  requires_admin?: boolean;
  created_at: string;
};

export type ExternalApiHealth = {
  api_source_id: string;
  freshness_score: number;
  reliability_score: number;
};

export type PlatformConfig = ExternalApiSource & {
  health?: ExternalApiHealth | null;
};

export type PlatformStrategy = {
  platform_type: string;
  supported_content_types: string[];
  supported_promotion_modes: string[];
  required_metadata: string[];
  is_active: boolean;
  health_score: number;
  category?: string | null;
  name?: string;
};

export type TrendSignal = {
  topic: string;
  source: string;
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  trend_source_health?: {
    freshness_score: number;
    reliability_score: number;
  };
  omnivyra?: {
    decision_id?: string;
    confidence?: number;
    placeholders?: string[];
    explanation?: string;
    contract_version?: string;
    partial?: boolean;
  };
};

const DEFAULT_TIMEOUT_MS = 5000;

const fetchWithTimeout = async (url: string, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchWithTimeoutInit = async (
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const computeFreshnessScore = (lastSuccessAt?: string | null): number => {
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

const computeReliabilityScore = (successCount: number, failureCount: number): number => {
  const total = successCount + failureCount;
  if (total === 0) return 1;
  return Number((successCount / total).toFixed(3));
};

const computePayloadHash = (payload: any): string => {
  const raw = JSON.stringify(payload ?? {});
  return createHash('sha256').update(raw).digest('hex');
};

export const recordApiHealth = async (
  source: ExternalApiSource,
  input: { success: boolean; payload?: any }
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    const { data, error } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', source.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Failed to load API health record', { source: source.name });
      return null;
    }

    const nowIso = new Date().toISOString();
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const freshnessScore = computeFreshnessScore(lastSuccessAt);
    const reliabilityScore = computeReliabilityScore(successCount, failureCount);
    const payloadHash = input.success
      ? computePayloadHash(input.payload)
      : data?.last_payload_hash ?? null;

    const { error: upsertError } = await supabase
      .from('external_api_health')
      .upsert(
        {
          api_source_id: source.id,
          last_success_at: lastSuccessAt,
          last_failure_at: lastFailureAt,
          success_count: successCount,
          failure_count: failureCount,
          last_payload_hash: payloadHash,
          freshness_score: freshnessScore,
          reliability_score: reliabilityScore,
        },
        { onConflict: 'api_source_id' }
      );

    if (upsertError) {
      console.warn('Failed to persist API health record', { source: source.name });
    }

    return { freshness_score: freshnessScore, reliability_score: reliabilityScore };
  } catch (error) {
    console.warn('API health update failed', { source: source.name });
    return null;
  }
};

export async function getEnabledApis(): Promise<ExternalApiSource[]> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load external APIs: ${error.message}`);
  }

  return data || [];
}

export async function savePlatformConfig(input: Partial<ExternalApiSource>): Promise<ExternalApiSource> {
  const payload = {
    name: input.name,
    base_url: input.base_url,
    purpose: input.purpose,
    category: input.category ?? null,
    is_active: input.is_active ?? true,
    auth_type: input.auth_type ?? 'none',
    api_key_name: input.api_key_name ?? null,
    platform_type: input.platform_type ?? 'social',
    supported_content_types: input.supported_content_types ?? [],
    promotion_modes: input.promotion_modes ?? [],
    required_metadata: input.required_metadata ?? {},
    posting_constraints: input.posting_constraints ?? {},
    requires_admin: input.requires_admin ?? true,
    created_at: input.created_at ?? new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('external_api_sources')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to save platform config: ${error.message}`);
  }

  return data;
}

export async function getPlatformConfigs(): Promise<PlatformConfig[]> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load platform configs: ${error.message}`);
  }

  const apiIds = (data || []).map((row: any) => row.id);
  let healthMap: Record<string, ExternalApiHealth> = {};
  if (apiIds.length > 0) {
    const { data: healthData, error: healthError } = await supabase
      .from('external_api_health')
      .select('*')
      .in('api_source_id', apiIds);
    if (!healthError && healthData) {
      healthMap = healthData.reduce((acc: Record<string, ExternalApiHealth>, row: any) => {
        acc[row.api_source_id] = {
          api_source_id: row.api_source_id,
          freshness_score: row.freshness_score ?? 1,
          reliability_score: row.reliability_score ?? 1,
        };
        return acc;
      }, {});
    }
  }

  return (data || []).map((row: any) => ({
    ...row,
    health: healthMap[row.id] || null,
  }));
}

const normalizeArray = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
};

const normalizeRequiredMetadata = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).filter((key) => Boolean(value[key]));
  }
  return [];
};

export async function getPlatformStrategies(): Promise<PlatformStrategy[]> {
  const configs = await getPlatformConfigs();
  return configs.map((config) => {
    const healthScore =
      (config.health?.freshness_score ?? 1) * (config.health?.reliability_score ?? 1);
    return {
      platform_type: config.platform_type || 'social',
      supported_content_types: normalizeArray(config.supported_content_types),
      supported_promotion_modes: normalizeArray(config.promotion_modes),
      required_metadata: normalizeRequiredMetadata(config.required_metadata),
      is_active: config.is_active !== false,
      health_score: Number(healthScore.toFixed(3)),
      category: config.category ?? null,
      name: config.name,
    };
  });
}

export async function getPlatformConfigByPlatform(
  platform: string
): Promise<PlatformConfig | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .or(`category.eq.${platform},name.ilike.%${platform}%`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('Failed to load platform config', { platform });
    return null;
  }

  const record = data?.[0];
  if (!record) return null;

  const health = await getApiHealthByPlatform(platform);
  return {
    ...record,
    health,
  };
}

export function validatePlatformConfig(input: Partial<ExternalApiSource>): {
  ok: boolean;
  message?: string;
} {
  if (!input.name || !input.base_url || !input.platform_type) {
    return { ok: false, message: 'Missing required fields' };
  }
  if (input.supported_content_types && !Array.isArray(input.supported_content_types)) {
    return { ok: false, message: 'supported_content_types must be an array' };
  }
  if (input.promotion_modes && !Array.isArray(input.promotion_modes)) {
    return { ok: false, message: 'promotion_modes must be an array' };
  }
  return { ok: true };
}

const getHealthForSource = async (
  source: ExternalApiSource
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    const { data, error } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', source.id)
      .single();
    if (error && error.code !== 'PGRST116') {
      return null;
    }
    if (!data) return null;
    return {
      freshness_score: data.freshness_score ?? 1,
      reliability_score: data.reliability_score ?? 1,
    };
  } catch (error) {
    return null;
  }
};

export async function getApiConfigByPlatform(
  platform: string
): Promise<ExternalApiSource | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .or(`category.eq.${platform},name.ilike.%${platform}%`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('Failed to load external API config', { platform });
    return null;
  }

  return data?.[0] ?? null;
}

export async function getApiHealthByPlatform(
  platform: string
): Promise<ExternalApiHealth | null> {
  const config = await getApiConfigByPlatform(platform);
  if (!config) return null;
  const { data, error } = await supabase
    .from('external_api_health')
    .select('*')
    .eq('api_source_id', config.id)
    .single();
  if (error && error.code !== 'PGRST116') {
    return null;
  }
  if (!data) return null;
  return {
    api_source_id: data.api_source_id,
    freshness_score: data.freshness_score ?? 1,
    reliability_score: data.reliability_score ?? 1,
  };
}

export function normalizeTrendSignals(
  rawApiResults: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
  }>
): TrendSignal[] {
  const signals: TrendSignal[] = [];

  rawApiResults.forEach(({ source, payload, health }) => {
    if (!payload) return;

    const items = Array.isArray(payload?.items) ? payload.items : [];
    items.forEach((item: any) => {
      if (!item?.topic) return;
      signals.push({
        topic: item.topic,
        source: source.name,
        geo: item.geo,
        velocity: item.velocity,
        sentiment: item.sentiment,
        volume: item.volume,
        trend_source_health: health ?? undefined,
      });
    });
  });

  return signals;
}

const toTrendInput = (signal: TrendSignal): TrendSignalInput => ({
  topic: signal.topic,
  source: signal.source,
  geo: signal.geo,
  velocity: signal.velocity,
  sentiment: signal.sentiment,
  volume: signal.volume,
});

const mapOmniVyraTrends = (
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
      if (match) {
        return match;
      }
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

const applyRankingOrder = (
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

export async function fetchTrendsFromApis(
  geo?: string,
  category?: string,
  options?: { recordHealth?: boolean; minReliability?: number }
): Promise<TrendSignal[]> {
  const sources = await getEnabledApis();
  if (sources.length === 0) return [];

  const results: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
  }> = [];
  const recordHealth = options?.recordHealth ?? true;
  const minReliability = options?.minReliability ?? 0;

  for (const source of sources) {
    try {
      const health = await getHealthForSource(source);
      const reliability = health?.reliability_score ?? 1;
      if (reliability < minReliability) {
        console.warn('Skipping external API due to unreliable source', {
          source: source.name,
          reason: 'unreliable source',
        });
        continue;
      }

      const authType = source.auth_type ?? 'none';
      const apiKey = source.api_key_name ? process.env[source.api_key_name] : undefined;
      if (authType !== 'none' && source.api_key_name && !apiKey) {
        console.warn('External API key missing', { source: source.name });
        if (recordHealth) {
          await recordApiHealth(source, { success: false });
        }
        continue;
      }

      const url = new URL(source.base_url);
      if (geo) url.searchParams.set('geo', geo);
      if (category) url.searchParams.set('category', category);
      if (apiKey && authType !== 'none') url.searchParams.set('apiKey', apiKey);

      const response = await fetchWithTimeout(url.toString());
      if (!response.ok) {
        console.warn('External API fetch failed', {
          source: source.name,
          status: response.status,
        });
        if (recordHealth) {
          await recordApiHealth(source, { success: false });
        }
        continue;
      }

      const payload = await response.json();
      const healthUpdate = recordHealth
        ? await recordApiHealth(source, { success: true, payload })
        : null;
      results.push({ source, payload, health: healthUpdate ?? health ?? undefined });
    } catch (error) {
      console.warn('External API fetch error', { source: source.name });
      if (recordHealth) {
        await recordApiHealth(source, { success: false });
      }
    }
  }

  const normalized = normalizeTrendSignals(results);
  if (!isOmniVyraEnabled()) {
    return normalized;
  }

  const relevance = await getTrendRelevance({
    signals: normalized.map(toTrendInput),
    geo,
    category,
  });

  const withRelevance =
    relevance.status === 'ok'
      ? mapOmniVyraTrends(
          relevance.data?.relevant_trends ?? relevance.data?.trends,
          normalized
        )
      : normalized;

  if (relevance.status !== 'ok') {
    console.warn('OMNIVYRA_FALLBACK_TRENDS', { reason: relevance.error?.message });
  }

  const ranking = await getTrendRanking({
    signals: withRelevance.map(toTrendInput),
    geo,
    category,
  });

  if (ranking.status !== 'ok') {
    console.warn('OMNIVYRA_FALLBACK_RANKING', { reason: ranking.error?.message });
    return withRelevance;
  }

  const ordered = applyRankingOrder(
    ranking.data?.ranked_trends ?? ranking.data?.trends,
    withRelevance
  );

  return ordered.map((signal) => ({
    ...signal,
    omnivyra: {
      decision_id: ranking.decision_id,
      confidence: ranking.confidence,
      placeholders: ranking.placeholders,
      explanation: ranking.explanation,
      contract_version: ranking.contract_version,
      partial: ranking.partial,
    },
  }));
}

export async function validateExternalApiSource(
  sourceId: string
): Promise<{ freshness_score: number; reliability_score: number } | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('id', sourceId)
    .single();
  if (error || !data) {
    throw new Error('API source not found');
  }
  const source = data as ExternalApiSource;
  const authType = source.auth_type ?? 'none';
  const apiKey = source.api_key_name ? process.env[source.api_key_name] : undefined;
  if (authType !== 'none' && source.api_key_name && !apiKey) {
    return recordApiHealth(source, { success: false });
  }

  const url = new URL(source.base_url);
  if (apiKey && authType !== 'none') url.searchParams.set('apiKey', apiKey);

  try {
    const headResponse = await fetchWithTimeoutInit(url.toString(), { method: 'HEAD' });
    if (headResponse.ok) {
      return recordApiHealth(source, { success: true, payload: { ok: true } });
    }
    if (headResponse.status === 405) {
      const getResponse = await fetchWithTimeout(url.toString());
      if (!getResponse.ok) {
        return recordApiHealth(source, { success: false });
      }
      return recordApiHealth(source, { success: true, payload: { ok: true } });
    }
    return recordApiHealth(source, { success: false });
  } catch (error) {
    return recordApiHealth(source, { success: false });
  }
}
