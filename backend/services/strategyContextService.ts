/**
 * Strategy Context Service
 * Validates and normalizes StrategyContext before it enters the planning pipeline.
 */

import type { StrategyContext } from '../types/campaignPlanning';
import { CANONICAL_PLATFORMS } from '../constants/platforms';
import { CURRENT_STRATEGY_SCHEMA_VERSION } from '../constants/strategySchema';

export class StrategyContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyContextValidationError';
  }
}

export class StrategySchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategySchemaVersionError';
  }
}

export class StrategySchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategySchemaMigrationError';
  }
}

const CANONICAL_SET = new Set<string>(CANONICAL_PLATFORMS);

const PLATFORM_ALIASES: Record<string, string> = {
  linkedin: 'linkedin',
  'x': 'twitter',
  twitter: 'twitter',
  'x (twitter)': 'twitter',
  youtube: 'youtube',
  instagram: 'instagram',
  blog: 'blog',
};

const POSTING_FREQUENCY_MAX = 30;

function toCanonicalPlatform(raw: string): string {
  const key = raw.trim().toLowerCase();
  const canonical = PLATFORM_ALIASES[key];
  if (canonical) return canonical;
  if (CANONICAL_SET.has(key)) return key;
  // Normalize display variants: "X (Twitter)", "Twitter/X", "x(twitter)" → twitter
  if (/x\s*\(?\s*twitter\s*\)?|twitter\s*\/\s*x/.test(key)) return 'twitter';
  throw new StrategyContextValidationError(`Unknown platform: "${raw}". Allowed: linkedin, twitter, youtube, instagram, blog`);
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}

function deepCopy<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => deepCopy(item)) as T;
  const copy = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    copy[k] = deepCopy(v);
  }
  return copy as T;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    obj.forEach((item) => deepFreeze(item));
  } else {
    Object.values(obj as Record<string, unknown>).forEach((v) => deepFreeze(v));
  }
  return obj;
}

/**
 * Migrate StrategyContext to current schema version.
 * Future versions will implement migrations here.
 * Migration output must have required fields; throws StrategySchemaMigrationError if invalid.
 */
export function migrateStrategyContext(input: Record<string, unknown>): Record<string, unknown> {
  const version = input.strategy_schema_version;
  if (version !== undefined && version !== 1) return input;

  if (input.duration_weeks == null) {
    throw new StrategySchemaMigrationError('Migration output missing required field: duration_weeks');
  }
  if (!Array.isArray(input.platforms)) {
    throw new StrategySchemaMigrationError('Migration output missing required field: platforms');
  }
  if (input.posting_frequency == null || typeof input.posting_frequency !== 'object' || Array.isArray(input.posting_frequency)) {
    throw new StrategySchemaMigrationError('Migration output missing required field: posting_frequency');
  }

  return input;
}

/**
 * Validate and normalize StrategyContext.
 * Pipeline: 1. clone input 2. migrateStrategyContext() 3. normalize fields 4. validate fields.
 * Migration output never bypasses normalization.
 * Returns deeply frozen (immutable) object.
 */
export function normalizeStrategyContext(input: unknown): StrategyContext {
  if (!isRecord(input)) {
    throw new StrategyContextValidationError('strategy_context must be an object');
  }

  // 1. clone input
  const cloned = deepCopy(input) as Record<string, unknown>;
  // 2. migrate
  const migrated = migrateStrategyContext(cloned);
  // 3. normalize & 4. validate (below)

  const inputVersion = migrated.strategy_schema_version;
  if (
    inputVersion !== undefined &&
    Number(inputVersion) !== CURRENT_STRATEGY_SCHEMA_VERSION
  ) {
    throw new StrategySchemaVersionError(
      `strategy_schema_version ${inputVersion} is not supported. Expected: ${CURRENT_STRATEGY_SCHEMA_VERSION}`
    );
  }

  const duration_weeks = Number(migrated.duration_weeks);
  if (!Number.isFinite(duration_weeks) || duration_weeks <= 0) {
    throw new StrategyContextValidationError('duration_weeks must be a number greater than 0');
  }

  const rawPlatforms = migrated.platforms;
  const rawPlatformList: string[] = Array.isArray(rawPlatforms)
    ? (rawPlatforms as unknown[]).map((p) => String(p ?? '').trim()).filter(Boolean) as string[]
    : [];
  if (rawPlatformList.length === 0) {
    throw new StrategyContextValidationError('platforms must be a non-empty array');
  }

  const platforms: string[] = [];
  const seen = new Set<string>();
  for (const p of rawPlatformList) {
    const canonical = toCanonicalPlatform(p);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      platforms.push(canonical);
    }
  }

  const rawFreq = migrated.posting_frequency;
  if (rawFreq == null || typeof rawFreq !== 'object' || Array.isArray(rawFreq)) {
    throw new StrategyContextValidationError('posting_frequency must be an object');
  }
  const posting_frequency: Record<string, number> = {};

  const platformSet = new Set(platforms);
  for (const key of Object.keys(rawFreq)) {
    const platformKey = toCanonicalPlatform(String(key));
    if (!platformSet.has(platformKey)) {
      throw new StrategyContextValidationError(
        `posting_frequency key "${key}" must exist in platforms array`
      );
    }
    const val = Number(rawFreq[key]);
    if (!Number.isFinite(val) || val < 0 || val > POSTING_FREQUENCY_MAX) {
      throw new StrategyContextValidationError(
        `posting_frequency "${key}" must be between 0 and ${POSTING_FREQUENCY_MAX}`
      );
    }
    posting_frequency[platformKey] = val;
  }

  // Ensure every platform has a posting_frequency entry (default 0)
  for (const p of platforms) {
    if (!(p in posting_frequency)) {
      posting_frequency[p] = 0;
    }
  }

  // Remove platforms with zero posting frequency (return only active platforms)
  const activePlatforms = platforms.filter((p) => (posting_frequency[p] ?? 0) > 0);
  const activePostingFrequency: Record<string, number> = {};
  for (const p of activePlatforms) {
    activePostingFrequency[p] = posting_frequency[p]!;
  }

  if (activePlatforms.length === 0) {
    throw new StrategyContextValidationError('At least one platform must have posting_frequency > 0');
  }

  const result: StrategyContext = {
    strategy_schema_version: CURRENT_STRATEGY_SCHEMA_VERSION as 1,
    duration_weeks,
    platforms: activePlatforms,
    posting_frequency: activePostingFrequency,
  };

  if (migrated.content_mix != null && isRecord(migrated.content_mix)) {
    const content_mix: Record<string, number> = {};
    let sum = 0;
    for (const [k, v] of Object.entries(migrated.content_mix)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) {
        content_mix[String(k)] = n;
        sum += n;
      } else if (Number.isFinite(n) && n < 0) {
        throw new StrategyContextValidationError(`content_mix "${k}" must be >= 0`);
      }
    }
    if (sum > 100) {
      throw new StrategyContextValidationError('content_mix sum must be <= 100');
    }
    if (Object.keys(content_mix).length > 0 && sum > 0) {
      const scale = 100 / sum;
      const normalized: Record<string, number> = {};
      const keys = Object.keys(content_mix);
      let roundedSum = 0;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        const raw = content_mix[key]! * scale;
        const rounded = i === keys.length - 1 ? 100 - roundedSum : Math.round(raw);
        normalized[key] = Math.max(0, rounded);
        roundedSum += normalized[key]!;
      }
      result.content_mix = normalized;
    }
  }

  if (typeof migrated.campaign_goal === 'string' && migrated.campaign_goal.trim()) {
    result.campaign_goal = migrated.campaign_goal.trim();
  }
  if (typeof migrated.target_audience === 'string' && migrated.target_audience.trim()) {
    result.target_audience = migrated.target_audience.trim();
  }

  return deepFreeze(result);
}
