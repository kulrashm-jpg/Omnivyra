/**
 * User-Intent Driven Execution Service
 *
 * Answers one question before every cron job: "Is there a real business reason
 * to run this job right now?"  When the answer is no, the job is skipped and
 * the saving is recorded.
 *
 * ── Part 1 — Feature execution flags ──────────────────────────────────────
 * Per-company `CompanyExecutionFlags` maps three high-level features to groups
 * of intelligence job types.  A job whose feature flag is disabled for ALL
 * active companies is never triggered.
 *
 * ── Part 2 — User-intent triggers ─────────────────────────────────────────
 * `triggerIntentJobs(event, companyId)` writes short-lived Redis keys that
 * cause the affected job types to bypass their normal interval on the next
 * cron cycle and run immediately at high priority.
 *
 * ── Part 3 — Smart cron scheduler ─────────────────────────────────────────
 * `getIntentGate(jobKey)` is called synchronously by `shouldRunCronJob()`.
 * It reads a context object warmed once per cycle by `warmIntentContext()` and
 * returns whether the job should run plus a `frequencyMultiplier` that stretches
 * the effective interval to the minimum configured by any active company.
 *
 * ── Part 4 — Inactive company skip ────────────────────────────────────────
 * `recordUserActivity(companyId)` updates a Redis sorted-set score.
 * During context warm, `hasAnyActiveCompany` is false when every company's
 * last activity is > 24 h ago.  Non-critical jobs are gated on this flag.
 *
 * ── Part 5 — Priority queue ────────────────────────────────────────────────
 * Intent triggers carry a priority tier (high / medium / low) that maps to
 * the appropriate BullMQ queue so user-driven work always executes before
 * background insights.
 *
 * ── Part 6 — Redis savings tracking ───────────────────────────────────────
 * `recordIntentSkip(jobKey, reason)` accumulates in-memory counters.
 * `flushSavings()` (called inside warmIntentContext) writes deltas to Redis
 * hashes and periodically upserts to the `intent_savings_log` Supabase table.
 *
 * ── Integration ────────────────────────────────────────────────────────────
 * • `cron.ts`            — calls `warmIntentContext()` once per cycle
 * • `adminRuntimeConfig` — calls `getIntentGate()` + `recordIntentSkip()` in
 *                           `shouldRunCronJob()`
 * • API route handlers   — call `recordUserActivity()` and
 *                           `triggerIntentJobs()` on user actions
 */

import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyExecutionFlags {
  insights: {
    market_trends:        boolean;
    competitor_tracking:  boolean;
    ai_recommendations:   boolean;
  };
  frequency: {
    /** Minimum cadence for insight-related jobs ('1h' | '2h' | '8h'). */
    insights: '1h' | '2h' | '8h';
  };
}

export type IntentEvent =
  | 'company_created'    // triggers enrichment + initial signal ingestion
  | 'campaign_started'   // triggers AI generation pipeline
  | 'user_active'        // nudge engagement polling + signal clustering
  | 'post_scheduled';    // ensures publish pipeline is awake

export type SkipReason =
  | 'feature_disabled'
  | 'no_active_companies'
  | 'company_inactive'
  | 'frequency_not_elapsed';

export interface IntentGateResult {
  /** Whether the job should run. */
  allowed:             boolean;
  reason:              SkipReason | null;
  /**
   * Multiplier applied to the job's hardcoded base interval.
   * 1.0 = no change; >1.0 = slower cadence (e.g. 4.0 = every 4× longer).
   * Ignored when allowed = false.
   */
  frequencyMultiplier: number;
  /**
   * True when a user-triggered intent flag is set for this job.
   * shouldRunCronJob() bypasses the interval check and runs immediately.
   */
  immediateRun:        boolean;
}

export interface SavingsReport {
  date:                 string;  // 'YYYY-MM-DD'
  skippedJobsCount:     number;
  skippedRedisOpsEst:   number;
  byReason:             Record<SkipReason, number>;
  /** Human-readable summary for the dashboard. */
  summary:              string;
  /** Last 7 days (oldest first). */
  history:              Array<{ date: string; skippedJobs: number; skippedOps: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature → job key mapping
// ─────────────────────────────────────────────────────────────────────────────
//
// These are the cron.ts `shouldRunCronJob` key strings.
// Jobs not listed here are considered infrastructure / always-run.

const FEATURE_JOB_MAP: Record<string, string[]> = {
  'insights.market_trends': [
    'signalClustering',
    'signalIntelligence',
    'strategicTheme',
    'companyTrendRelevance',
    'engagementSignalScheduler',
    'engagementOpportunityScanner',
    'engagementCapture',
    'feedbackIntelligence',
    'engagementDigest',
  ],
  'insights.competitor_tracking': [
    'intelligencePolling',
    'engagementPolling',
  ],
  'insights.ai_recommendations': [
    'campaignOpportunity',
    'contentOpportunity',
    'narrativeEngine',
    'communityPost',
    'threadEngine',
    'dailyIntelligence',
    'campaignHealthEvaluation',
    'replyIntelligenceAggregation',
    'responsePerformanceEval',
    'responseStrategyLearning',
    'opportunityLearning',
    'influencerLearning',
    'insightLearning',
    'buyerIntentLearning',
  ],
};

// Reverse map: job key → feature path
const JOB_FEATURE_MAP = new Map<string, string>();
for (const [feature, jobs] of Object.entries(FEATURE_JOB_MAP)) {
  for (const job of jobs) JOB_FEATURE_MAP.set(job, feature);
}

// Jobs that skip the inactive-company gate — they must run regardless.
const ALWAYS_RUN_JOBS = new Set([
  'findDuePostsAndEnqueue',
  'conversationTriageWorker',
  'leadThreadQueueCleanup',
  'connectorTokenRefresh',
  'intelligenceEventCleanup',
  'engagementSignalArchive',
  'confidenceCalibration',
  'governanceAudit',      // compliance — run even on inactive orgs
  'performanceAggregation', // lightweight daily aggregate
]);

// Frequency tier → milliseconds
const FREQUENCY_MS: Record<string, number> = {
  '1h': 1   * 60 * 60_000,
  '2h': 2   * 60 * 60_000,
  '8h': 8   * 60 * 60_000,
};

// Estimated BullMQ Redis operations per full job lifecycle (add+active+complete)
const REDIS_OPS_PER_JOB = 20;

// ─────────────────────────────────────────────────────────────────────────────
// User-intent trigger → job types
// ─────────────────────────────────────────────────────────────────────────────

type TriggerPriority = 'high' | 'medium' | 'low';

interface IntentTrigger {
  jobKey:   string;
  priority: TriggerPriority;
}

// Maps user events to the job keys they should immediately activate.
const INTENT_TRIGGER_MAP: Record<IntentEvent, IntentTrigger[]> = {
  company_created: [
    { jobKey: 'intelligencePolling',      priority: 'high'   },
    { jobKey: 'signalClustering',         priority: 'high'   },
    { jobKey: 'strategicTheme',           priority: 'medium' },
    { jobKey: 'companyTrendRelevance',    priority: 'medium' },
  ],
  campaign_started: [
    { jobKey: 'campaignOpportunity',      priority: 'high'   },
    { jobKey: 'narrativeEngine',          priority: 'high'   },
    { jobKey: 'contentOpportunity',       priority: 'medium' },
    { jobKey: 'communityPost',            priority: 'medium' },
    { jobKey: 'campaignHealthEvaluation', priority: 'low'    },
  ],
  user_active: [
    { jobKey: 'engagementPolling',        priority: 'medium' },
    { jobKey: 'signalClustering',         priority: 'medium' },
  ],
  post_scheduled: [
    { jobKey: 'findDuePostsAndEnqueue',   priority: 'high'   },
    { jobKey: 'engagementCapture',        priority: 'low'    },
  ],
};

// BullMQ queue names by priority tier
const QUEUE_BY_PRIORITY: Record<TriggerPriority, string> = {
  high:   'posting',     // priority=1 in BullMQ
  medium: 'publish',     // default priority
  low:    'ai-heavy',    // priority=10 in BullMQ
};

// ─────────────────────────────────────────────────────────────────────────────
// Redis keys
// ─────────────────────────────────────────────────────────────────────────────

const KEYS = {
  companyConfigCache:   (id: string) => `omnivyra:intent:company_config:${id}`,
  allConfigsCache:      'omnivyra:intent:all_configs',
  companyActivity:      'omnivyra:intent:company_activity',       // sorted set
  triggerFlag:          (jobKey: string) => `omnivyra:intent:trigger:${jobKey}`,
  savingsHash:          (day: string) => `omnivyra:savings:daily:${day}`,
};

const CONFIG_CACHE_TTL_S  = 10 * 60;    // 10 minutes
const ACTIVITY_WINDOW_MS  = 24 * 60 * 60_000;
const TRIGGER_TTL_S       = 15 * 60;    // 15 minutes — one cron cycle
const SAVINGS_HASH_TTL_S  = 48 * 3600;  // 48 hours

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────

interface IntentContext {
  /** Any company had activity within the last 24 h. */
  hasAnyActiveCompany:   boolean;
  /**
   * Job keys that are enabled for at least one active company.
   * Feature-gated jobs absent from this set are skipped entirely.
   */
  enabledJobKeys:        Set<string>;
  /**
   * Minimum configured frequency (ms) per job key across all active companies
   * with that feature enabled.  Used to stretch the cron interval.
   */
  minFrequencyMs:        Map<string, number>;
  /** Job keys that have a user-triggered immediate-run flag (already consumed). */
  pendingTriggers:       Set<string>;
  warmedAt:              number;
}

let _ctx: IntentContext = {
  hasAnyActiveCompany: true,  // assume active until first warm — avoids cold-start blocking
  enabledJobKeys:      new Set(),
  minFrequencyMs:      new Map(),
  pendingTriggers:     new Set(),
  warmedAt:            0,
};

// Per-cycle savings accumulator (flushed to Redis during next warmIntentContext)
let _pendingSavings: {
  byReason: Partial<Record<SkipReason, number>>;
  ops:      number;
} = { byReason: {}, ops: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// Redis client (lazy, isolated from bullmqClient to avoid circular imports)
// ─────────────────────────────────────────────────────────────────────────────

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  _redis = new IORedis(url, {
    enableReadyCheck:     false,
    maxRetriesPerRequest: 1,
    connectTimeout:       2_000,
    commandTimeout:       1_500,
    lazyConnect:          true,
    retryStrategy:        () => null,
  });
  _redis.on('error', () => {});
  _redis.connect().catch(() => {});
  return _redis;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client (service-role, for config reads and savings log writes)
// ─────────────────────────────────────────────────────────────────────────────

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default flags (all enabled, 2h cadence)
// ─────────────────────────────────────────────────────────────────────────────

function defaultFlags(): CompanyExecutionFlags {
  return {
    insights: { market_trends: true, competitor_tracking: true, ai_recommendations: true },
    frequency: { insights: '2h' },
  };
}

function rowToFlags(row: Record<string, unknown>): CompanyExecutionFlags {
  return {
    insights: {
      market_trends:       Boolean(row.insights_market_trends       ?? true),
      competitor_tracking: Boolean(row.insights_competitor_tracking ?? true),
      ai_recommendations:  Boolean(row.insights_ai_recommendations  ?? true),
    },
    frequency: {
      insights: (['1h', '2h', '8h'].includes(row.frequency_insights as string)
        ? (row.frequency_insights as '1h' | '2h' | '8h')
        : '2h'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Company execution flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load execution flags for a single company.
 * Redis-cached (10 min). Falls back to defaults on any error.
 */
export async function getCompanyExecutionFlags(companyId: string): Promise<CompanyExecutionFlags> {
  try {
    const cached = await getRedis().get(KEYS.companyConfigCache(companyId));
    if (cached) return JSON.parse(cached) as CompanyExecutionFlags;
  } catch { /* ignore */ }

  try {
    const db = getDb();
    const { data } = await db
      .from('company_execution_config')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    const flags = data ? rowToFlags(data as Record<string, unknown>) : defaultFlags();

    // Cache for 10 minutes
    getRedis()
      .set(KEYS.companyConfigCache(companyId), JSON.stringify(flags), 'EX', CONFIG_CACHE_TTL_S)
      .catch(() => {});

    return flags;
  } catch {
    return defaultFlags();
  }
}

/**
 * Persist execution flags for a company (upsert).
 * Invalidates Redis cache immediately.
 */
export async function setCompanyExecutionFlags(
  companyId: string,
  flags:     Partial<CompanyExecutionFlags>,
  updatedBy: string = 'api',
): Promise<void> {
  const db = getDb();

  // Merge with existing to allow partial updates
  const existing = await getCompanyExecutionFlags(companyId);
  const merged: CompanyExecutionFlags = {
    insights: { ...existing.insights, ...flags.insights },
    frequency: { ...existing.frequency, ...flags.frequency },
  };

  await db.from('company_execution_config').upsert(
    {
      company_id:                   companyId,
      insights_market_trends:       merged.insights.market_trends,
      insights_competitor_tracking: merged.insights.competitor_tracking,
      insights_ai_recommendations:  merged.insights.ai_recommendations,
      frequency_insights:           merged.frequency.insights,
      updated_at:                   new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );

  // Invalidate cache
  getRedis().del(KEYS.companyConfigCache(companyId)).catch(() => {});
  getRedis().del(KEYS.allConfigsCache).catch(() => {});

  console.log(JSON.stringify({
    level:      'INFO',
    event:      'company_execution_flags_updated',
    company_id: companyId,
    flags:      merged,
    updated_by: updatedBy,
  }));
}

/** Load execution flags for ALL companies in a single DB query. */
async function loadAllCompanyConfigs(): Promise<Map<string, CompanyExecutionFlags>> {
  const out = new Map<string, CompanyExecutionFlags>();
  try {
    const cached = await getRedis().get(KEYS.allConfigsCache);
    if (cached) {
      const arr = JSON.parse(cached) as Array<{ id: string; flags: CompanyExecutionFlags }>;
      for (const { id, flags } of arr) out.set(id, flags);
      return out;
    }
  } catch { /* ignore */ }

  try {
    const db = getDb();
    const { data } = await db
      .from('company_execution_config')
      .select('company_id, insights_market_trends, insights_competitor_tracking, insights_ai_recommendations, frequency_insights');

    for (const row of data ?? []) {
      out.set(row.company_id, rowToFlags(row as Record<string, unknown>));
    }

    // Cache the full list
    const payload = JSON.stringify([...out.entries()].map(([id, flags]) => ({ id, flags })));
    getRedis().set(KEYS.allConfigsCache, payload, 'EX', CONFIG_CACHE_TTL_S).catch(() => {});
  } catch { /* fall back to empty map — warm will treat all as default */ }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 4 — User activity tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record that a company has had user activity right now.
 * Must be called from API route handlers on any meaningful user action.
 * (e.g. page load, create-post, run-campaign, view-dashboard)
 */
export async function recordUserActivity(companyId: string): Promise<void> {
  try {
    const now = Date.now();
    // Score = timestamp ms.  ZRANGEBYSCORE min score now-24h will find active companies.
    await getRedis().zadd(KEYS.companyActivity, now, companyId);
    // Prune members older than 30 days to keep the sorted set bounded
    await getRedis().zremrangebyscore(KEYS.companyActivity, '-inf', now - 30 * 24 * 60 * 60_000);
  } catch { /* best-effort */ }
}

/** Return all company IDs active within the last 24 hours. */
async function getActiveCompanyIds(): Promise<string[]> {
  try {
    const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
    return await getRedis().zrangebyscore(KEYS.companyActivity, cutoff, '+inf');
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 6 — Savings tracking
// ─────────────────────────────────────────────────────────────────────────────

/** Called synchronously when a job is skipped by the intent gate. */
export function recordIntentSkip(jobKey: string, reason: SkipReason): void {
  _pendingSavings.byReason[reason] = (_pendingSavings.byReason[reason] ?? 0) + 1;
  _pendingSavings.ops += REDIS_OPS_PER_JOB;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Flush accumulated savings counters to Redis. Called inside warmIntentContext. */
async function flushSavings(): Promise<void> {
  const totalJobs = Object.values(_pendingSavings.byReason).reduce((s, n) => s + n, 0);
  if (totalJobs === 0) return;

  const day    = todayUtc();
  const key    = KEYS.savingsHash(day);
  const redis  = getRedis();

  try {
    const pipeline = redis.pipeline();
    pipeline.hincrby(key, 'skipped_jobs', totalJobs);
    pipeline.hincrby(key, 'skipped_ops',  _pendingSavings.ops);
    for (const [reason, count] of Object.entries(_pendingSavings.byReason)) {
      if (count > 0) pipeline.hincrby(key, `reason:${reason}`, count);
    }
    pipeline.expire(key, SAVINGS_HASH_TTL_S);
    await pipeline.exec();
  } catch { /* best-effort */ }

  // Reset accumulator
  _pendingSavings = { byReason: {}, ops: 0 };
}

/** Load today's savings from Redis for the dashboard. */
export async function getSavingsReport(): Promise<SavingsReport> {
  const day = todayUtc();

  try {
    const [todayHash, ...historyHashes] = await Promise.all([
      getRedis().hgetall(KEYS.savingsHash(day)),
      // Last 7 days (not including today)
      ...[1, 2, 3, 4, 5, 6].map(n => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - n);
        return getRedis().hgetall(KEYS.savingsHash(d.toISOString().slice(0, 10)));
      }),
    ]);

    const parse = (h: Record<string, string> | null) => ({
      skippedJobs: parseInt(h?.skipped_jobs ?? '0', 10),
      skippedOps:  parseInt(h?.skipped_ops  ?? '0', 10),
    });

    const today    = parse(todayHash);
    const byReason = {} as Record<SkipReason, number>;

    for (const [k, v] of Object.entries(todayHash ?? {})) {
      if (k.startsWith('reason:')) {
        const r = k.slice(7) as SkipReason;
        byReason[r] = parseInt(v, 10);
      }
    }

    const opsStr = today.skippedOps >= 1_000
      ? `~${Math.round(today.skippedOps / 1_000)}k`
      : String(today.skippedOps);

    const history = [1, 2, 3, 4, 5, 6].map((n, i) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      const { skippedJobs, skippedOps } = parse(historyHashes[i]);
      return { date: d.toISOString().slice(0, 10), skippedJobs, skippedOps };
    }).reverse();

    return {
      date:               day,
      skippedJobsCount:   today.skippedJobs,
      skippedRedisOpsEst: today.skippedOps,
      byReason,
      summary: `Saved ${opsStr} Redis ops today by skipping ${today.skippedJobs} unused job runs`,
      history,
    };
  } catch {
    return {
      date: day, skippedJobsCount: 0, skippedRedisOpsEst: 0,
      byReason: {} as Record<SkipReason, number>,
      summary: 'Savings data unavailable',
      history: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — User-intent triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire intent triggers for a user action.  Sets short-lived Redis flags that
 * cause the relevant job types to run immediately on the next cron cycle,
 * bypassing their normal interval check.
 *
 * Call this from API route handlers when a user takes a meaningful action.
 *
 * @param event      What the user did
 * @param companyId  Which company's context
 */
export async function triggerIntentJobs(event: IntentEvent, companyId: string): Promise<void> {
  const triggers = INTENT_TRIGGER_MAP[event];
  if (!triggers?.length) return;

  // Also record activity so the company isn't considered inactive
  await recordUserActivity(companyId);

  const redis    = getRedis();
  const pipeline = redis.pipeline();

  for (const { jobKey, priority } of triggers) {
    // Store trigger with priority metadata; consumed by warmIntentContext
    const payload = JSON.stringify({ companyId, priority, ts: Date.now() });
    pipeline.set(KEYS.triggerFlag(jobKey), payload, 'EX', TRIGGER_TTL_S);
  }

  await pipeline.exec().catch(() => {});

  console.log(JSON.stringify({
    level:      'INFO',
    event:      'intent_jobs_triggered',
    intent:     event,
    company_id: companyId,
    jobs:       triggers.map(t => t.jobKey),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — Smart cron scheduler — context warm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Warm the intent context for the upcoming cron cycle.
 * Must be called once at the start of `runSchedulerCycle()` — before any
 * `shouldRunCronJob()` calls.  Async I/O is done here so that the subsequent
 * per-job gate checks are synchronous (zero latency on hot path).
 *
 * Also flushes any pending savings counters from the previous cycle.
 */
export async function warmIntentContext(): Promise<void> {
  // Flush previous-cycle savings first (before any new skips are recorded)
  await flushSavings();

  const enabledJobKeys  = new Set<string>();
  const minFrequencyMs  = new Map<string, number>();
  const pendingTriggers = new Set<string>();

  try {
    const redis = getRedis();

    // ── Active companies ────────────────────────────────────────────────────
    const activeIds = await getActiveCompanyIds();
    const hasAnyActiveCompany = activeIds.length > 0;

    // ── Company execution configs ───────────────────────────────────────────
    const allConfigs = await loadAllCompanyConfigs();

    // Build the set of enabled job keys and minimum frequency per job:
    // For each active company → check each feature flag → if enabled, mark
    // the associated job keys as enabled and track the minimum frequency.
    for (const companyId of activeIds) {
      const flags = allConfigs.get(companyId) ?? defaultFlags();
      const freqMs = FREQUENCY_MS[flags.frequency.insights] ?? FREQUENCY_MS['2h'];

      for (const [featurePath, jobKeys] of Object.entries(FEATURE_JOB_MAP)) {
        // Evaluate nested feature flag (e.g. 'insights.market_trends')
        const [section, key] = featurePath.split('.') as [keyof CompanyExecutionFlags, string];
        const featureEnabled  = (flags[section] as Record<string, boolean>)[key] ?? true;

        if (featureEnabled) {
          for (const jobKey of jobKeys) {
            enabledJobKeys.add(jobKey);
            // Track the minimum (most frequent = lowest ms) across companies
            const existing = minFrequencyMs.get(jobKey);
            if (existing === undefined || freqMs < existing) {
              minFrequencyMs.set(jobKey, freqMs);
            }
          }
        }
      }
    }

    // ── Consume pending intent-trigger flags ────────────────────────────────
    // Scan for all trigger keys, consume them (delete), add to pending set.
    // This guarantees each trigger fires at most once per warm cycle.
    const triggerKeys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(
        cursor, 'MATCH', 'omnivyra:intent:trigger:*', 'COUNT', 50,
      );
      cursor = next;
      triggerKeys.push(...found);
    } while (cursor !== '0');

    if (triggerKeys.length > 0) {
      // Delete all trigger keys atomically before reading (consume-first)
      await redis.del(...triggerKeys);
      for (const key of triggerKeys) {
        const jobKey = key.replace('omnivyra:intent:trigger:', '');
        pendingTriggers.add(jobKey);
        // Triggered jobs are always considered enabled regardless of feature flags
        enabledJobKeys.add(jobKey);
      }
    }

    _ctx = {
      hasAnyActiveCompany,
      enabledJobKeys,
      minFrequencyMs,
      pendingTriggers,
      warmedAt: Date.now(),
    };

    if (pendingTriggers.size > 0) {
      console.log(JSON.stringify({
        level:    'INFO',
        event:    'intent_triggers_consumed',
        jobs:     [...pendingTriggers],
        ts:       new Date().toISOString(),
      }));
    }

  } catch (err) {
    // Never block the cron cycle — use last known context
    console.warn('[intentExecution] warmIntentContext error:', (err as Error)?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — Smart scheduler gate (synchronous — reads warmed context)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous gate consulted by `shouldRunCronJob()` in adminRuntimeConfig.ts.
 *
 * Decision matrix:
 *  immediateRun  → true when a user-intent trigger was set for this job
 *  feature check → false if all active companies have this feature disabled
 *  activity gate → false for non-critical jobs when no company active in 24 h
 *  frequency     → returns a multiplier to stretch the base interval
 */
export function getIntentGate(jobKey: string): IntentGateResult {
  // Always-run jobs bypass all intent checks
  if (ALWAYS_RUN_JOBS.has(jobKey)) {
    return { allowed: true, reason: null, frequencyMultiplier: 1, immediateRun: false };
  }

  // User-triggered: run immediately, skip interval check
  if (_ctx.pendingTriggers.has(jobKey)) {
    return { allowed: true, reason: null, frequencyMultiplier: 0, immediateRun: true };
  }

  // No active companies in the last 24 h → skip all non-critical jobs
  if (!_ctx.hasAnyActiveCompany) {
    return { allowed: false, reason: 'no_active_companies', frequencyMultiplier: 1, immediateRun: false };
  }

  // Feature disabled for all active companies
  if (JOB_FEATURE_MAP.has(jobKey) && !_ctx.enabledJobKeys.has(jobKey)) {
    return { allowed: false, reason: 'feature_disabled', frequencyMultiplier: 1, immediateRun: false };
  }

  // The frequency multiplier is derived by shouldRunCronJob via getJobMinFrequencyMs(),
  // because only shouldRunCronJob knows the job's hardcoded base interval.
  // Here we always return 1 — the real stretching is applied at the call site.
  return { allowed: true, reason: null, frequencyMultiplier: 1, immediateRun: false };
}

/**
 * Return the minimum configured frequency (ms) for a job key across all
 * active companies with the relevant feature enabled.
 * Returns null when no config exists (use hardcoded base interval as-is).
 */
export function getJobMinFrequencyMs(jobKey: string): number | null {
  const ms = _ctx.minFrequencyMs.get(jobKey);
  return ms !== undefined ? ms : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for integration in adminRuntimeConfig.ts
// ─────────────────────────────────────────────────────────────────────────────

export { ALWAYS_RUN_JOBS, JOB_FEATURE_MAP };
