/**
 * Runtime feature governance.
 *
 * Centralized registry of toggleable planner features with scoped rollout
 * by org, environment, instance, OR traffic-percentage. The registry lives
 * in Redis so an operator decision propagates to every instance without a
 * redeploy. Changes are appended to an audit stream for forensic review.
 *
 * Compared to `plannerRolloutMode`:
 *   - rollout-mode = coarse-grained, six staged profiles
 *   - feature governance = fine-grained, per-feature, per-scope toggles
 *
 * Both layers coexist: a feature's effective state is `mode_default AND NOT
 * forced_off AND (forced_on OR in_scope)`. Forced-off wins.
 *
 * Scopes:
 *   - global   : applies to everyone unless overridden
 *   - org      : matches when `orgId` equals
 *   - env      : matches when `process.env.NODE_ENV` equals
 *   - instance : matches when this instance's id matches
 *   - percent  : deterministic 0..100 bucket of `evaluationKey` (e.g. orgId)
 *
 * Evaluation order (first match wins):
 *   1. forced_off (any scope) → false
 *   2. forced_on  (any scope) → true
 *   3. percent_on (any scope, by bucket) → true
 *   4. default (registry default) → boolean
 */

import type IORedis from 'ioredis';
import { createHash, randomUUID } from 'crypto';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

const REGISTRY_KEY = 'planner:features:registry';
const AUDIT_STREAM = 'planner:features:audit';
const AUDIT_MAXLEN = 2000;
const CACHE_TTL_MS = 5_000;

const INSTANCE_ID = randomUUID();

export type FeatureScopeType = 'global' | 'org' | 'env' | 'instance' | 'percent';

export interface FeatureRule {
  /** Unique rule id (UUID). Audit entries reference this. */
  id: string;
  scopeType: FeatureScopeType;
  /** Org id when scopeType==='org'; env name when ==='env'; instance id when ==='instance'. */
  scopeValue?: string;
  /** Required when scopeType==='percent'. 0–100 inclusive. */
  percent?: number;
  /**
   * `'on'`     — feature enabled within this scope
   * `'off'`    — feature disabled within this scope (forced off wins over forced on)
   * `'default'`— no opinion; fall through to next rule
   */
  effect: 'on' | 'off' | 'default';
  /** Free-form note for the audit trail. */
  note?: string;
  created_at: number;
  created_by: string | null;
}

export interface FeatureEntry {
  key: string;
  description: string;
  default: boolean;
  rules: FeatureRule[];
  updated_at: number;
}

type Registry = Record<string, FeatureEntry>;

let _client: IORedis | null = null;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;
let _cache: { registry: Registry; cachedAt: number } | null = null;

function getRedisOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-features');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_features_redis_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function readRegistry(): Promise<Registry> {
  const now = Date.now();
  if (_cache && now - _cache.cachedAt < CACHE_TTL_MS) {
    return _cache.registry;
  }
  const client = getRedisOrNull();
  if (!client) return _cache?.registry ?? {};
  try {
    const raw = await client.get(REGISTRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Registry) : {};
    _cache = { registry: parsed, cachedAt: now };
    return parsed;
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_features_registry_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return _cache?.registry ?? {};
  }
}

async function writeRegistry(registry: Registry, audit: { action: string; actor: string | null; details: Record<string, unknown> }): Promise<void> {
  const client = getRedisOrNull();
  if (!client) {
    logger.warn('planner_features_registry_write_skipped_no_redis', { action: audit.action });
    return;
  }
  try {
    await client.set(REGISTRY_KEY, JSON.stringify(registry));
    await client.xadd(
      AUDIT_STREAM,
      'MAXLEN', '~', String(AUDIT_MAXLEN),
      '*',
      'ts', String(Date.now()),
      'action', audit.action,
      'actor', audit.actor ?? 'system',
      'details', JSON.stringify(audit.details),
      'request_id', getRequestContext().requestId ?? '',
    );
    // Invalidate local cache so the next read reflects the write.
    _cache = null;
    logger.info('planner_features_registry_updated', {
      action: audit.action,
      actor: audit.actor,
      details: audit.details,
    });
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_features_registry_write_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface RegisterFeatureInput {
  key: string;
  description: string;
  default: boolean;
  operatorId: string;
}

/** Register a new feature (or update its description / default if it already exists). */
export async function registerFeature(input: RegisterFeatureInput): Promise<FeatureEntry> {
  const registry = await readRegistry();
  const existing = registry[input.key];
  const entry: FeatureEntry = {
    key: input.key,
    description: input.description,
    default: input.default,
    rules: existing?.rules ?? [],
    updated_at: Date.now(),
  };
  registry[input.key] = entry;
  await writeRegistry(registry, {
    action: existing ? 'update_feature' : 'register_feature',
    actor: input.operatorId,
    details: { key: input.key, description: input.description, default: input.default },
  });
  return entry;
}

export interface AddRuleInput {
  featureKey: string;
  scopeType: FeatureScopeType;
  scopeValue?: string;
  percent?: number;
  effect: 'on' | 'off' | 'default';
  note?: string;
  operatorId: string;
}

/** Append a rule to a feature. Rules are evaluated in registration order. */
export async function addRule(input: AddRuleInput): Promise<FeatureEntry | null> {
  if (input.scopeType === 'percent' && (input.percent == null || input.percent < 0 || input.percent > 100)) {
    throw new Error('percent rules require percent in 0..100');
  }
  const registry = await readRegistry();
  const entry = registry[input.featureKey];
  if (!entry) return null;
  const rule: FeatureRule = {
    id: randomUUID(),
    scopeType: input.scopeType,
    scopeValue: input.scopeValue,
    percent: input.percent,
    effect: input.effect,
    note: input.note,
    created_at: Date.now(),
    created_by: input.operatorId,
  };
  entry.rules.push(rule);
  entry.updated_at = Date.now();
  await writeRegistry(registry, {
    action: 'add_rule',
    actor: input.operatorId,
    details: { feature_key: input.featureKey, rule },
  });
  return entry;
}

/** Remove a rule by id. Returns the updated entry or null if not found. */
export async function removeRule(
  featureKey: string,
  ruleId: string,
  operatorId: string,
): Promise<FeatureEntry | null> {
  const registry = await readRegistry();
  const entry = registry[featureKey];
  if (!entry) return null;
  const before = entry.rules.length;
  entry.rules = entry.rules.filter((r) => r.id !== ruleId);
  if (entry.rules.length === before) return entry;
  entry.updated_at = Date.now();
  await writeRegistry(registry, {
    action: 'remove_rule',
    actor: operatorId,
    details: { feature_key: featureKey, rule_id: ruleId },
  });
  return entry;
}

export interface EvaluationContext {
  orgId?: string | null;
  environment?: string;
  instanceId?: string;
  /** Stable key for percentage bucketing. Usually orgId. Defaults to a random
   *  but deterministic UUID per process (so a single instance sees a stable
   *  bucket — but DIFFERENT instances may bucket differently for the same
   *  request, which is intentional for "X% of instances" rollouts). For
   *  per-user/per-org bucketing, pass orgId. */
  evaluationKey?: string;
}

function percentBucket(key: string): number {
  // SHA1 first 8 hex → uint32 → mod 100. Stable across processes for the
  // same `key`.
  const hex = createHash('sha1').update(key).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

function ruleMatchesContext(rule: FeatureRule, ctx: EvaluationContext): boolean {
  switch (rule.scopeType) {
    case 'global':   return true;
    case 'org':      return !!(ctx.orgId && rule.scopeValue === ctx.orgId);
    case 'env':      return !!(rule.scopeValue && (ctx.environment ?? process.env.NODE_ENV) === rule.scopeValue);
    case 'instance': return !!(rule.scopeValue && (ctx.instanceId ?? INSTANCE_ID) === rule.scopeValue);
    case 'percent': {
      if (rule.percent == null) return false;
      const key = ctx.evaluationKey ?? ctx.orgId ?? INSTANCE_ID;
      return percentBucket(key) < rule.percent;
    }
  }
}

export interface EvaluationResult {
  key: string;
  enabled: boolean;
  matchingRuleId: string | null;
  reason: 'forced_off' | 'forced_on' | 'percent_on' | 'default_on' | 'default_off' | 'unknown_feature';
}

/** Evaluate a single feature for the given context. Cached registry read. */
export async function isFeatureEnabled(
  featureKey: string,
  ctx: EvaluationContext = {},
): Promise<EvaluationResult> {
  const registry = await readRegistry();
  const entry = registry[featureKey];
  if (!entry) {
    return { key: featureKey, enabled: false, matchingRuleId: null, reason: 'unknown_feature' };
  }
  // Pass 1: forced_off (highest precedence — safety override)
  for (const rule of entry.rules) {
    if (rule.effect === 'off' && ruleMatchesContext(rule, ctx)) {
      return { key: featureKey, enabled: false, matchingRuleId: rule.id, reason: 'forced_off' };
    }
  }
  // Pass 2: forced_on
  for (const rule of entry.rules) {
    if (rule.effect === 'on' && ruleMatchesContext(rule, ctx)) {
      // Distinguish percent-on from forced-on for telemetry.
      const reason = rule.scopeType === 'percent' ? 'percent_on' : 'forced_on';
      return { key: featureKey, enabled: true, matchingRuleId: rule.id, reason };
    }
  }
  // Fall through to registry default.
  return {
    key: featureKey,
    enabled: entry.default,
    matchingRuleId: null,
    reason: entry.default ? 'default_on' : 'default_off',
  };
}

/** Read the full registry (cached). For the control-plane UI. */
export async function listFeatures(): Promise<FeatureEntry[]> {
  const registry = await readRegistry();
  return Object.values(registry).sort((a, b) => a.key.localeCompare(b.key));
}

/** Read recent audit-stream entries. */
export async function readFeatureAuditTrail(limit: number = 50): Promise<Array<Record<string, string>>> {
  const client = getRedisOrNull();
  if (!client) return [];
  try {
    const entries = (await client.xrevrange(AUDIT_STREAM, '+', '-', 'COUNT', limit)) as Array<[string, string[]]>;
    return entries.map(([entryId, fields]) => {
      const obj: Record<string, string> = { entry_id: entryId };
      for (let i = 0; i + 1 < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
      return obj;
    });
  } catch {
    return [];
  }
}

export function __resetForTests(): void {
  _client = null;
  _cache = null;
  _failureCount = 0;
}
export const __INSTANCE_ID_FOR_TESTS__ = INSTANCE_ID;
