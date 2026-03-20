/**
 * Config Service — single source of truth for all runtime-configurable values.
 *
 * Reads from Supabase config tables with a 5-minute in-memory cache.
 * All services MUST call these getters instead of using hardcoded constants.
 *
 * Tables:
 *   platform_rules_config     — per-platform formatting rules
 *   decision_engine_config    — engagement thresholds / ad decision rules
 *   content_validation_config — carousel/thread/hook validation limits
 *   tone_config               — named tone rule sets
 *   experiment_config         — active A/B experiments
 *   prediction_config         — prediction engine weights and thresholds
 *
 * Cache: 5-minute TTL per config type (invalidated on admin write).
 * Fallback: hardcoded defaults used ONLY when DB is unreachable.
 */

import { supabase } from '../db/supabaseClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformRulesConfig = {
  platform: string;
  content_type: string;
  rules: {
    max_sentences_per_paragraph: number;
    prefer_sentence_per_line: boolean;
    enforce_cta_at_end: boolean;
    guidelines: string[];
    [key: string]: unknown;
  };
};

export type DecisionEngineConfig = {
  min_engagement_threshold: number;
  critical_drop_percent: number;
  ad_scale_threshold: number;
  ad_test_threshold: number;
  accuracy_good_threshold: number;
  pause_condition_days: number;
  at_risk_windows: number;
  critical_runs_for_pause: number;
};

export type ContentValidationConfig = {
  hook_min_score: number;
  carousel_max_words: number;
  thread_min_count: number;
  thread_max_count: number;
  tweet_char_limit: number;
  hook_min_words: number;
  hook_max_words: number;
};

export type ToneConfig = {
  tone_name: string;
  rules: {
    filler_words?: string[];
    sentence_style?: string;
    punctuation?: string;
    [key: string]: unknown;
  };
};

export type PredictionConfig = {
  min_confidence_threshold: number;
  min_engagement_threshold: number;
  max_optimization_rounds: number;
  weight_hook_strength: number;
  weight_platform_fit: number;
  weight_readability: number;
  weight_authority: number;
  weight_historical: number;
};

export type ExperimentConfig = {
  id: string;
  experiment_name: string;
  variant_a: Record<string, unknown>;
  variant_b: Record<string, unknown>;
  traffic_split: number;
  active: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Defaults (used ONLY when DB is unreachable)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DECISION_CONFIG: DecisionEngineConfig = {
  min_engagement_threshold: 0.01,
  critical_drop_percent:    0.40,
  ad_scale_threshold:       0.05,
  ad_test_threshold:        0.02,
  accuracy_good_threshold:  0.70,
  pause_condition_days:     2,
  at_risk_windows:          2,
  critical_runs_for_pause:  2,
};

const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  min_confidence_threshold: 0.5,
  min_engagement_threshold: 0.02,
  max_optimization_rounds:  3,
  weight_hook_strength:     0.25,
  weight_platform_fit:      0.20,
  weight_readability:       0.15,
  weight_authority:         0.15,
  weight_historical:        0.25,
};

const DEFAULT_VALIDATION_CONFIG: ContentValidationConfig = {
  hook_min_score:     0.30,
  carousel_max_words: 15,
  thread_min_count:   5,
  thread_max_count:   7,
  tweet_char_limit:   280,
  hook_min_words:     4,
  hook_max_words:     20,
};

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry<T> = { value: T; fetchedAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function fromCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function toCache<T>(key: string, value: T): void {
  cache.set(key, { value, fetchedAt: Date.now() });
}

/** Invalidate all cache entries for a given config type. */
export function invalidateConfigCache(configType: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(configType)) cache.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Getters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get platform-specific formatting rules.
 * Falls back to generic platform rules (any content_type) if exact match absent.
 */
export async function getPlatformRules(
  platform: string,
  contentType: string = 'post'
): Promise<PlatformRulesConfig | null> {
  const cacheKey = `platform_rules:${platform}:${contentType}`;
  const cached = fromCache<PlatformRulesConfig>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('platform_rules_config')
      .select('platform, content_type, rules')
      .eq('platform', platform.toLowerCase())
      .eq('content_type', contentType.toLowerCase())
      .maybeSingle();

    if (data) {
      const result = data as PlatformRulesConfig;
      toCache(cacheKey, result);
      return result;
    }

    // Fall back to any content_type for this platform
    const { data: fallback } = await supabase
      .from('platform_rules_config')
      .select('platform, content_type, rules')
      .eq('platform', platform.toLowerCase())
      .limit(1)
      .maybeSingle();

    if (fallback) {
      const result = fallback as PlatformRulesConfig;
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getPlatformRules DB error — using null', err);
  }

  return null;
}

/** Get all platform rules (for prompt builder). */
export async function getAllPlatformRules(): Promise<PlatformRulesConfig[]> {
  const cacheKey = 'platform_rules:all';
  const cached = fromCache<PlatformRulesConfig[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('platform_rules_config')
      .select('platform, content_type, rules')
      .order('platform');

    if (data?.length) {
      const result = data as PlatformRulesConfig[];
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getAllPlatformRules DB error', err);
  }

  return [];
}

/** Get decision engine thresholds. Falls back to hardcoded defaults on DB failure. */
export async function getDecisionConfig(): Promise<DecisionEngineConfig> {
  const cacheKey = 'decision_engine_config';
  const cached = fromCache<DecisionEngineConfig>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('decision_engine_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const result: DecisionEngineConfig = {
        min_engagement_threshold: Number(data.min_engagement_threshold ?? DEFAULT_DECISION_CONFIG.min_engagement_threshold),
        critical_drop_percent:    Number(data.critical_drop_percent    ?? DEFAULT_DECISION_CONFIG.critical_drop_percent),
        ad_scale_threshold:       Number(data.ad_scale_threshold       ?? DEFAULT_DECISION_CONFIG.ad_scale_threshold),
        ad_test_threshold:        Number(data.ad_test_threshold        ?? DEFAULT_DECISION_CONFIG.ad_test_threshold),
        accuracy_good_threshold:  Number(data.accuracy_good_threshold  ?? DEFAULT_DECISION_CONFIG.accuracy_good_threshold),
        pause_condition_days:     Number(data.pause_condition_days     ?? DEFAULT_DECISION_CONFIG.pause_condition_days),
        at_risk_windows:          Number(data.at_risk_windows          ?? DEFAULT_DECISION_CONFIG.at_risk_windows),
        critical_runs_for_pause:  Number(data.critical_runs_for_pause  ?? DEFAULT_DECISION_CONFIG.critical_runs_for_pause),
      };
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getDecisionConfig DB error — using defaults', err);
  }

  return { ...DEFAULT_DECISION_CONFIG };
}

/** Get content validation limits. Falls back to hardcoded defaults on DB failure. */
export async function getValidationConfig(): Promise<ContentValidationConfig> {
  const cacheKey = 'content_validation_config';
  const cached = fromCache<ContentValidationConfig>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('content_validation_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const result: ContentValidationConfig = {
        hook_min_score:     Number(data.hook_min_score     ?? DEFAULT_VALIDATION_CONFIG.hook_min_score),
        carousel_max_words: Number(data.carousel_max_words ?? DEFAULT_VALIDATION_CONFIG.carousel_max_words),
        thread_min_count:   Number(data.thread_min_count   ?? DEFAULT_VALIDATION_CONFIG.thread_min_count),
        thread_max_count:   Number(data.thread_max_count   ?? DEFAULT_VALIDATION_CONFIG.thread_max_count),
        tweet_char_limit:   Number(data.tweet_char_limit   ?? DEFAULT_VALIDATION_CONFIG.tweet_char_limit),
        hook_min_words:     Number(data.hook_min_words     ?? DEFAULT_VALIDATION_CONFIG.hook_min_words),
        hook_max_words:     Number(data.hook_max_words     ?? DEFAULT_VALIDATION_CONFIG.hook_max_words),
      };
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getValidationConfig DB error — using defaults', err);
  }

  return { ...DEFAULT_VALIDATION_CONFIG };
}

/** Get tone rules by name. Returns null if not found. */
export async function getToneConfig(toneName: string): Promise<ToneConfig | null> {
  const cacheKey = `tone_config:${toneName}`;
  const cached = fromCache<ToneConfig>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('tone_config')
      .select('tone_name, rules')
      .eq('tone_name', toneName.toLowerCase())
      .maybeSingle();

    if (data) {
      const result = data as ToneConfig;
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getToneConfig DB error', err);
  }

  return null;
}

/** Get all active experiments. */
export async function getActiveExperiments(): Promise<ExperimentConfig[]> {
  const cacheKey = 'experiment_config:active';
  const cached = fromCache<ExperimentConfig[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('experiment_config')
      .select('*')
      .eq('active', true);

    const result = (data ?? []) as ExperimentConfig[];
    toCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[configService] getActiveExperiments DB error', err);
  }

  return [];
}

/** Get a specific experiment by name. Returns null if not active. */
export async function getActiveExperiment(name: string): Promise<ExperimentConfig | null> {
  const experiments = await getActiveExperiments();
  return experiments.find((e) => e.experiment_name === name) ?? null;
}

/**
 * Assign a variant for an experiment using deterministic hashing on a seed
 * (e.g. campaign_id, user_id). Returns 'a' or 'b'.
 */
export function assignVariant(
  experiment: ExperimentConfig,
  seed: string
): 'a' | 'b' {
  // Simple deterministic hash: sum of char codes mod 100 vs split
  const hash = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 100;
  return hash < experiment.traffic_split * 100 ? 'a' : 'b';
}

/** Get prediction engine weights and thresholds. Falls back to defaults on DB failure. */
export async function getPredictionConfig(): Promise<PredictionConfig> {
  const cacheKey = 'prediction_config';
  const cached = fromCache<PredictionConfig>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('prediction_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const result: PredictionConfig = {
        min_confidence_threshold: Number(data.min_confidence_threshold ?? DEFAULT_PREDICTION_CONFIG.min_confidence_threshold),
        min_engagement_threshold: Number(data.min_engagement_threshold ?? DEFAULT_PREDICTION_CONFIG.min_engagement_threshold),
        max_optimization_rounds:  Number(data.max_optimization_rounds  ?? DEFAULT_PREDICTION_CONFIG.max_optimization_rounds),
        weight_hook_strength:     Number(data.weight_hook_strength     ?? DEFAULT_PREDICTION_CONFIG.weight_hook_strength),
        weight_platform_fit:      Number(data.weight_platform_fit      ?? DEFAULT_PREDICTION_CONFIG.weight_platform_fit),
        weight_readability:       Number(data.weight_readability       ?? DEFAULT_PREDICTION_CONFIG.weight_readability),
        weight_authority:         Number(data.weight_authority         ?? DEFAULT_PREDICTION_CONFIG.weight_authority),
        weight_historical:        Number(data.weight_historical        ?? DEFAULT_PREDICTION_CONFIG.weight_historical),
      };
      toCache(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('[configService] getPredictionConfig DB error — using defaults', err);
  }

  return { ...DEFAULT_PREDICTION_CONFIG };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write / audit
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigUpdateInput = {
  config_type: 'decision_engine_config' | 'content_validation_config' | 'platform_rules_config' | 'tone_config' | 'experiment_config' | 'prediction_config';
  payload: Record<string, unknown>;
  changed_by?: string;
  note?: string;
};

/**
 * Validate and persist a config update. Writes audit log. Invalidates cache.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function updateConfig(input: ConfigUpdateInput): Promise<{ ok: boolean; error?: string }> {
  const { config_type, payload, changed_by = 'admin', note } = input;

  // Validate known config types
  const validation = validateConfigPayload(config_type, payload);
  if (!validation.ok) return validation;

  try {
    // Capture before state for audit
    const { data: before } = await supabase
      .from(config_type)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Upsert (single-row tables use first row; multi-row tables use payload.id)
    const upsertPayload = {
      ...payload,
      updated_at: new Date().toISOString(),
    };

    let upsertError: { message: string } | null = null;

    if (['decision_engine_config', 'content_validation_config', 'prediction_config'].includes(config_type)) {
      // Single-row config: update the most recent row
      const rowId = (before as any)?.id;
      if (rowId) {
        const { error } = await supabase.from(config_type).update(upsertPayload).eq('id', rowId);
        upsertError = error;
      } else {
        const { error } = await supabase.from(config_type).insert(upsertPayload);
        upsertError = error;
      }
    } else {
      // Multi-row tables: upsert by id or unique key
      const { error } = await supabase.from(config_type).upsert(upsertPayload);
      upsertError = error;
    }

    if (upsertError) return { ok: false, error: upsertError.message };

    // Write audit log
    await supabase.from('config_change_logs').insert({
      config_type,
      changed_by,
      before_json: before ?? null,
      after_json:  upsertPayload,
      note:        note ?? null,
      created_at:  new Date().toISOString(),
    });

    // Invalidate cache
    invalidateConfigCache(config_type.replace(/_config$/, '').replace(/_/g, '_'));
    invalidateConfigCache(config_type);

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Rollback a config to a previous state using a log entry id.
 */
export async function rollbackConfig(logId: string, changedBy: string = 'admin'): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: log } = await supabase
      .from('config_change_logs')
      .select('*')
      .eq('id', logId)
      .maybeSingle();

    if (!log?.before_json) return { ok: false, error: 'No before_json in log entry — cannot rollback' };

    return updateConfig({
      config_type: log.config_type as ConfigUpdateInput['config_type'],
      payload:     log.before_json as Record<string, unknown>,
      changed_by:  changedBy,
      note:        `Rollback to log ${logId}`,
    });
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateConfigPayload(
  type: string,
  payload: Record<string, unknown>
): { ok: boolean; error?: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Payload must be an object' };
  }

  if (type === 'decision_engine_config') {
    const numericFields = ['min_engagement_threshold', 'critical_drop_percent', 'ad_scale_threshold',
      'ad_test_threshold', 'accuracy_good_threshold', 'pause_condition_days',
      'at_risk_windows', 'critical_runs_for_pause'];
    for (const f of numericFields) {
      if (f in payload && (typeof payload[f] !== 'number' || isNaN(payload[f] as number))) {
        return { ok: false, error: `${f} must be a number` };
      }
    }
    const pct = payload.critical_drop_percent as number | undefined;
    if (pct !== undefined && (pct < 0 || pct > 1)) {
      return { ok: false, error: 'critical_drop_percent must be between 0 and 1' };
    }
  }

  if (type === 'content_validation_config') {
    const intFields = ['carousel_max_words', 'thread_min_count', 'thread_max_count', 'tweet_char_limit', 'hook_min_words', 'hook_max_words'];
    for (const f of intFields) {
      if (f in payload && (!Number.isInteger(payload[f]) || (payload[f] as number) < 1)) {
        return { ok: false, error: `${f} must be a positive integer` };
      }
    }
    const min = payload.thread_min_count as number | undefined;
    const max = payload.thread_max_count as number | undefined;
    if (min !== undefined && max !== undefined && min > max) {
      return { ok: false, error: 'thread_min_count must be ≤ thread_max_count' };
    }
  }

  if (type === 'experiment_config') {
    const split = payload.traffic_split as number | undefined;
    if (split !== undefined && (split < 0 || split > 1)) {
      return { ok: false, error: 'traffic_split must be between 0 and 1' };
    }
  }

  return { ok: true };
}
