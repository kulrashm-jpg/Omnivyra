/** Part 1/2 of usageProtection.ts — verbatim split (barrel preserved; importers unchanged). */
/**
 * Redis usage protection — three-tier graceful degradation.
 * 🔒 NODE RUNTIME ONLY — enforced at module load
 *
 * Monitors two independent usage axes every 60 s and uses the higher of the
 * two to set the protection level:
 *
 *   Memory axis  — used_memory / maxmemory  (from INFO memory)
 *   Requests axis — daily commands processed / configured limit
 *                   (from INFO stats total_commands_processed)
 *
 * Protection levels (driven by max of the two axes):
 *   normal   (< 70%)   full operation
 *   warning  (70–85%)  structured WARN log + admin alert key written to Redis
 *   throttle (85–95%)  queue fan-out capped to 50%, cron intervals doubled
 *   critical (≥ 95%)   non-essential queues blocked → overflow buffer;
 *                       non-essential cron jobs skipped entirely
 *
 * Overflow buffer (task 2 — no silent job loss):
 *   Blocked queue jobs are held in a per-queue in-memory ring buffer
 *   (capped at REDIS_OVERFLOW_CAP_PER_QUEUE, default 200).
 *   When the level recovers to normal, registered drain callbacks flush the
 *   buffer back into the real queues via their original addBulk path.
 *
 * Recovery (task 3):
 *   On any level→normal transition, the module:
 *     1. Logs a structured "system_recovered" INFO event.
 *     2. Writes a recovery admin alert key (6 h TTL).
 *     3. Fires all registered drain callbacks.
 *     4. Resets all per-elevation impact counters.
 *
 * Impact reporting (task 4):
 *   getUsageStatus().impact exposes:
 *     blockedQueues, fanOutReductionPct, totalJobsBlocked,
 *     totalJobsOverflowed, overflowByQueue,
 *     totalCronSkipped, skippedCronJobs, longDeferredCronJobs
 *
 * Anti-starvation (task 5):
 *   - Under throttle, the 2× interval multiplier is derived from the live
 *     level and resets immediately when the level drops — no accumulation.
 *   - Under critical, non-essential jobs are blocked.  Jobs deferred for
 *     more than CRITICAL_STARVATION_WARN_MS (default 4 h) are surfaced in
 *     impact.longDeferredCronJobs so an operator can investigate.
 *   - Recovery callbacks are idempotent; overflow is drained exactly once.
 *
 * Env vars:
 *   REDIS_MAX_BYTES                — fallback maxmemory (bytes); default 256 MB
 *   UPSTASH_DAILY_REQUEST_LIMIT    — daily command cap; default 5,000,000
 *   REDIS_OVERFLOW_CAP_PER_QUEUE   — max buffered jobs per queue; default 200
 */

// 🔴 ENFORCE: This module requires Node.js runtime
import { enforceNodeRuntime } from '@/lib/runtime/guard';
enforceNodeRuntime('lib/redis/usageProtection');

import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { recordPollingMetricsUpdate } from '@/lib/redis/healthMetrics';
import { config, envIsExplicit } from '@/config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────


export type UsageLevel = 'normal' | 'warning' | 'throttle' | 'critical';

export interface MemoryUsage {
  usedBytes: number;
  maxBytes:  number;
  usagePct:  number;  // 0–100
}

export interface RequestUsage {
  dailyUsed:  number;
  dailyLimit: number;
  usagePct:   number;  // 0–100
  resetAt:    string;  // ISO — next UTC midnight
}

export interface ProtectionImpact {
  /** Queues currently gated out (empty when level < critical). */
  blockedQueues:       string[];
  /** % reduction applied to bulk job fan-out (0 | 50 | 100). */
  fanOutReductionPct:  number;
  /** Jobs sent to the overflow buffer since level was last elevated. */
  totalJobsBlocked:    number;
  /** Jobs dropped because the overflow buffer was full (truly lost — not recoverable). */
  totalJobsDropped:    number;
  /** Jobs currently sitting in the overflow buffer (not yet drained). */
  totalJobsOverflowed: number;
  /** Per-queue overflow buffer depth. */
  overflowByQueue:     Record<string, number>;
  /** Cron job runs skipped since level was last elevated. */
  totalCronSkipped:    number;
  /** Distinct cron job keys skipped during the current elevated period. */
  skippedCronJobs:     string[];
  /**
   * Cron job keys blocked under critical for longer than
   * CRITICAL_STARVATION_WARN_MS without a recovery — need operator attention.
   */
  longDeferredCronJobs: string[];
}

export interface AdvisoryCounters {
  /** DB SELECT calls recorded today (advisory only). */
  dbReadsToday:   number;
  /** DB write calls (INSERT/UPSERT/UPDATE/DELETE) recorded today (advisory only). */
  dbWritesToday:  number;
  /** LLM tokens consumed today (advisory only). */
  llmTokensToday: number;
  /** Configured daily read limit — 0 means unlimited / not configured. */
  dbMaxReads:     number;
  /** Configured daily write limit — 0 means unlimited / not configured. */
  dbMaxWrites:    number;
  /** Configured daily LLM token limit — 0 means unlimited / not configured. */
  llmMaxTokens:   number;
}

export interface RedisUsageStatus {
  level:        UsageLevel;
  /** True once at least one poll has completed — false means level='normal' is the uninitialised default, not a real reading. */
  initialized:  boolean;
  /** Memory pressure axis. */
  memory:       MemoryUsage;
  /** Request-rate pressure axis. */
  requests:     RequestUsage;
  /** Max of memory.usagePct and requests.usagePct — drives the level. */
  effectivePct: number;
  checkedAt:    string;
  impact:       ProtectionImpact;
  /** Advisory counters for DB and LLM operations (never affect protection level). */
  advisory:     AdvisoryCounters;
}

/** A single job entry held in the overflow buffer. */
export interface OverflowEntry {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts?: any;
}

export type DrainCallback = (queueName: string, jobs: OverflowEntry[]) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants / thresholds
// ─────────────────────────────────────────────────────────────────────────────

// Alert (warning) fires at 60% so that with the 5,000,000/day cap the first
// alert lands at 3,000,000 commands. Throttle/critical remain a protective ramp
// toward the cap (4.25M / 4.75M).
export const WARN_PCT     = 0.60;
export const THROTTLE_PCT = 0.85;
export const CRITICAL_PCT = 0.95;

/** Alert written to Redis at most once per this window (prevents write storms). */
export const NOTIFY_COOLDOWN_MS = 5 * 60_000;

/** Jobs blocked under critical for this long appear in longDeferredCronJobs. */
export const CRITICAL_STARVATION_WARN_MS = 4 * 60 * 60_000;  // 4 hours

// ─────────────────────────────────────────────────────────────────────────────
// Non-essential classification
// ─────────────────────────────────────────────────────────────────────────────

/** Always allowed regardless of usage level. */
export const CRITICAL_QUEUES = new Set(['posting', 'publish']);

/**
 * Cron job keys that are skipped at critical and slowed at throttle.
 * Keys must match those passed to shouldRunCronJob() in cron.ts.
 */
export const NON_ESSENTIAL_CRON_JOBS = new Set([
  'signalClustering',
  'signalIntelligence',
  'strategicTheme',
  'campaignOpportunity',
  'contentOpportunity',
  'narrativeEngine',
  'communityPost',
  'threadEngine',
  'engagementCapture',
  'feedbackIntelligence',
  'companyTrendRelevance',
  'performanceIngestion',
  'performanceAggregation',
  'campaignHealthEvaluation',
  'dailyIntelligence',
  'intelligenceEventCleanup',
  'engagementDigest',
  'engagementSignalScheduler',
  'engagementSignalArchive',
  'engagementOpportunityScanner',
  'opportunitySlots',
  'governanceAudit',
  'autoOptimization',
  'replyIntelligenceAggregation',
  'responsePerformanceEval',
  'responseStrategyLearning',
  'opportunityLearning',
  'influencerLearning',
  'insightLearning',
  'buyerIntentLearning',
  'confidenceCalibration',
  'engagementPolling',
  'intelligencePolling',
]);

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────

