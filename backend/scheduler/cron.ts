/**
 * Cron Scheduler Entry Point
 * 
 * Background process that runs every 60 seconds (or configurable interval)
 * to find scheduled posts due for publishing and enqueue them in BullMQ.
 * 
 * In production, this should be replaced with:
 * - Vercel Cron Jobs (for Vercel deployments)
 * - systemd timer (for Linux servers)
 * - Kubernetes CronJob (for K8s)
 * - Cloud Scheduler (GCP) / EventBridge (AWS)
 * 
 * Run: npm run start:cron
 * Or: node -r ts-node/register backend/scheduler/cron.ts
 * 
 * Environment Variables:
 * - SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required)
 * - REDIS_URL (required)
 * - CRON_INTERVAL_SECONDS=60 (optional, default 60)
 */

import { validateCronEnv } from '../utils/validateEnv';
import { CronGuard } from '../utils/cronGuard';
import { cronInstr } from '../utils/cronInstrumentation';
import { shutdownAdminRuntimeConfig, getCronAdminConfig, shouldRunCronJob } from '../services/adminRuntimeConfig';
import {
  warmIntentContext,
  triggerIntentJobs,
  recordUserActivity,
  shutdownIntentExecutionRedis,
} from '../services/intentExecutionService';

// Fail fast if required env vars are missing
validateCronEnv();
import { calibrateThresholds } from '../services/confidenceCalibrator';
import {
  findDuePostsAndEnqueue,
  enqueueEngagementPolling,
  enqueueIntelligencePolling,
  enqueueScheduledLeadDetection,
  runSignalClustering,
  runSignalIntelligenceEngine,
  runStrategicThemeEngine,
  runCampaignOpportunityEngine,
  runContentOpportunityEngine,
  runNarrativeEngine,
  runCommunityPostEngine,
  runThreadEngine,
  runEngagementCapture,
  runFeedbackIntelligenceEngine,
  runCompanyTrendRelevance,
} from './schedulerService';
import { runOpportunitySlotsScheduler } from '../services/opportunitySlotsScheduler';
import { runAllCompanyAudits } from '../jobs/governanceAuditJob';
import { runAutoOptimizationForEligibleCampaigns } from '../jobs/autoOptimizationJob';
import { runPerformanceIngestion } from '../jobs/performanceIngestionJob';
import { runPerformanceAggregation } from '../jobs/performanceAggregationJob';
import { runCampaignHealthEvaluation } from '../jobs/campaignHealthEvaluationJob';
import { runEngagementSignalScheduler } from '../jobs/engagementSignalScheduler';
import { archiveOldSignals } from '../jobs/engagementSignalArchiveJob';
import { runEngagementOpportunityScanner } from '../jobs/engagementOpportunityScanner';
import { runDailyIntelligence } from '../schedulers/intelligenceScheduler';
import { runIntelligenceEventCleanup } from '../jobs/intelligenceEventCleanup';
import { runConnectorTokenRefreshJob } from '../jobs/connectorTokenRefreshJob';
import { runLeadThreadRecomputeQueueCleanup } from '../workers/leadThreadRecomputeWorker';
import {
  getLeadThreadRecomputeQueue,
  getConversationMemoryRebuildQueue,
} from '../queue/bullmqClient';
import { runResponsePerformanceEvaluationWorker } from '../workers/responsePerformanceEvaluationWorker';
import { runReplyIntelligenceAggregationWorker } from '../workers/replyIntelligenceAggregationWorker';
import { runEngagementOpportunityDetectionWorker } from '../workers/engagementOpportunityDetectionWorker';
import { runConversationTriageWorker } from '../workers/conversationTriageWorker';
import { runResponseStrategyLearningWorker } from '../workers/responseStrategyLearningWorker';
import { runEngagementDigestWorker } from '../workers/engagementDigestWorker';
import { runOpportunityLearningWorker } from '../workers/opportunityLearningWorker';
import { runInfluencerLearningWorker } from '../workers/influencerLearningWorker';
import { runInsightLearningWorker } from '../workers/insightLearningWorker';
import { runBuyerIntentLearningWorker } from '../workers/buyerIntentLearningWorker';

const CRON_INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_SECONDS || '900') * 1000; // default 15 min
const LEAD_THREAD_QUEUE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
// Safety-net enqueue intervals — cron fires a BullMQ drain job periodically as
// a fallback for any rows that the event-driven path missed (e.g. Redis hiccup).
const LEAD_THREAD_RECOMPUTE_SAFETYNET_MS = 5 * 60 * 1000; // 5 minutes
const CONVERSATION_MEMORY_SAFETYNET_MS   = 5 * 60 * 1000; // 5 minutes
const RESPONSE_PERFORMANCE_EVAL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const REPLY_INTELLIGENCE_AGGREGATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const ENGAGEMENT_OPPORTUNITY_DETECTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONVERSATION_TRIAGE_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const RESPONSE_STRATEGY_LEARNING_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const OPPORTUNITY_LEARNING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INFLUENCER_LEARNING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INSIGHT_LEARNING_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BUYER_INTENT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OPPORTUNITY_SLOTS_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const GOVERNANCE_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const AUTO_OPTIMIZATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const ENGAGEMENT_POLLING_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const INTELLIGENCE_POLLING_INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 hours
const SIGNAL_CLUSTERING_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const SIGNAL_INTELLIGENCE_INTERVAL_MS = 60 * 60 * 1000; // every hour
const STRATEGIC_THEME_INTERVAL_MS = 60 * 60 * 1000; // every hour
const CAMPAIGN_OPPORTUNITY_INTERVAL_MS = 60 * 60 * 1000; // every hour
const CONTENT_OPPORTUNITY_INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 hours
const NARRATIVE_ENGINE_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
const COMMUNITY_POST_INTERVAL_MS = 3 * 60 * 60 * 1000; // every 3 hours
const THREAD_ENGINE_INTERVAL_MS = 3 * 60 * 60 * 1000; // every 3 hours
const ENGAGEMENT_CAPTURE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const FEEDBACK_INTELLIGENCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const COMPANY_TREND_RELEVANCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const PERFORMANCE_INGESTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const PERFORMANCE_AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const CAMPAIGN_HEALTH_EVALUATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const DAILY_INTELLIGENCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 3 AM daily (0 3 * * *)
const INTELLIGENCE_EVENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const ENGAGEMENT_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const ENGAGEMENT_SIGNAL_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const ENGAGEMENT_SIGNAL_ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly
const ENGAGEMENT_OPPORTUNITY_SCANNER_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
const CONNECTOR_TOKEN_REFRESH_INTERVAL_MS      = 6 * 60 * 60 * 1000;  // every 6 hours
const CONFIDENCE_CALIBRATION_INTERVAL_MS       = 7 * 24 * 60 * 60 * 1000; // weekly

// ── Publish safety-net scheduler ─────────────────────────────────────────────
// Posts are now enqueued with a BullMQ `delay` at the moment they are scheduled
// (see enqueueScheduledPostAt in schedulerService.ts), so this loop is a
// safety net only — it catches posts that were scheduled before this change,
// posts whose BullMQ job was lost due to a Redis flush, or posts rescheduled
// while the cron process was down.
//
// 4-hour tick is sufficient: a missed post is at most 4 hours late, which is
// an acceptable SLA for the recovery path.  During off-hours the effective
// interval is already 6 hours so we unify both to 4 h.
const BASE_TICK_MS          = 4 * 60 * 60 * 1000;  // safety-net check every 4 hours
const OFF_HOURS_INTERVAL_MS = 4 * 60 * 60 * 1000;  // same — no distinction needed

interface SchedulerPrefs {
  interval_minutes: number;
  timezone: string;
  working_start: number; // 0–23 local hour
  working_end: number;   // 0–23 local hour
}
let _schedulerPrefs: SchedulerPrefs | null = null;
let _prefsCachedAt    = 0;
let _lastPublishCycleRun = 0;

/** Returns the local hour (0-23) in the given IANA timezone. */
function localHour(tz: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
      10,
    );
  } catch {
    return new Date().getHours();
  }
}

/**
 * Loads company scheduler prefs from DB, cached for 5 minutes.
 * Falls back to CRON_INTERVAL_MS / UTC 9-18 when no row exists.
 */
async function loadSchedulerPrefs(): Promise<SchedulerPrefs> {
  if (_schedulerPrefs && Date.now() - _prefsCachedAt < 5 * 60 * 1000) return _schedulerPrefs;
  try {
    const { supabase: db } = await import('../db/supabaseClient');
    const { data } = await db
      .from('company_scheduler_prefs')
      .select('interval_minutes, timezone, working_start, working_end')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    _schedulerPrefs = data ?? {
      interval_minutes: Math.round(CRON_INTERVAL_MS / 60_000),
      timezone: 'UTC',
      working_start: 9,
      working_end: 18,
    };
  } catch {
    _schedulerPrefs = {
      interval_minutes: Math.round(CRON_INTERVAL_MS / 60_000),
      timezone: 'UTC',
      working_start: 9,
      working_end: 18,
    };
  }
  _prefsCachedAt = Date.now();
  return _schedulerPrefs!;
}

/**
 * Returns true when the publish cycle should fire.
 * Working hours  → use company's configured interval.
 * Off hours      → use max(configured interval, 6 hours) — runs ~twice per night.
 */
async function shouldRunPublishCycle(): Promise<boolean> {
  const prefs = await loadSchedulerPrefs();
  const h      = localHour(prefs.timezone);
  const inWork = h >= prefs.working_start && h < prefs.working_end;
  const effectiveMs = inWork
    ? prefs.interval_minutes * 60_000
    : Math.max(prefs.interval_minutes * 60_000, OFF_HOURS_INTERVAL_MS);
  return Date.now() - _lastPublishCycleRun >= effectiveMs;
}

let lastOpportunitySlotsRun = 0;
let lastGovernanceAuditRun = 0;
let lastAutoOptimizationRun = 0;
let lastEngagementPollingEnqueue = 0;
let lastIntelligencePollingEnqueue = 0;
let lastSignalClusteringRun = 0;
let lastSignalIntelligenceRun = 0;
let lastStrategicThemeRun = 0;
let lastCampaignOpportunityRun = 0;
let lastContentOpportunityRun = 0;
let lastNarrativeEngineRun = 0;
let lastCommunityPostRun = 0;
let lastThreadEngineRun = 0;
let lastEngagementCaptureRun = 0;
let lastFeedbackIntelligenceRun = 0;
let lastCompanyTrendRelevanceRun = 0;
let lastPerformanceIngestionRun = 0;
let lastPerformanceAggregationRun = 0;
let lastCampaignHealthEvaluationRun = 0;
let lastDailyIntelligenceRun = 0;
let lastIntelligenceEventCleanupRun = 0;
let lastEngagementDigestRun = 0;
let lastEngagementSignalSchedulerRun = 0;
let lastEngagementSignalArchiveRun = 0;
let lastEngagementOpportunityScannerRun = 0;
let lastConnectorTokenRefreshRun = 0;
let lastLeadThreadQueueCleanupRun = 0;
let lastConfidenceCalibrationRun = 0;
let lastScheduledLeadRunHour = -1;
let lastScheduledLeadRunMs   = 0;   // timestamp for shouldRunCronJob

let cronInterval: NodeJS.Timeout | null = null;
const cronGuard = new CronGuard();

// Active worker timers — tracked so they can be cleared on shutdown
const workerTimers: NodeJS.Timeout[] = [];

/**
 * Generic recurring worker scheduler.
 * Runs `fn` immediately, then reschedules with `intervalMs` delay (+ optional jitter).
 * Errors are caught and logged; the worker always reschedules.
 *
 * @param fn        Async worker function. Return value logged when non-zero.
 * @param intervalMs  Base delay between runs.
 * @param label     Log prefix.
 * @param logFields Fields from the result to include in the success log (truthy-checked).
 * @param jitterMs  Optional extra jitter added to each interval (default 0).
 */
function scheduleWorker(
  fn: () => Promise<Record<string, number>>,
  intervalMs: number,
  label: string,
  logFields: string[],
  jitterMs = 0
): void {
  const tick = () => {
    const delay = intervalMs + Math.random() * jitterMs;
    const timer = setTimeout(async () => {
      let hadError = false;
      try {
        // BUG#20 fix: warm admin config cache before each tick so shouldRunCronJob()
        // and per-activity overrides read a fresh value, not cold/stale cache.
        await getCronAdminConfig().catch(() => { /* non-fatal */ });
        const result = await fn();
        const hasActivity = logFields.some((f) => (result[f] ?? 0) > 0);
        if (hasActivity) {
          const parts = logFields.map((f) => `${f}=${result[f] ?? 0}`).join(' ');
          console.log(`[${label}] ${parts}`);
        }
      } catch (err: any) {
        hadError = true;
        console.warn(`[${label}] worker error`, err?.message);
      }
      cronInstr.workerExecuted(label, hadError);
      tick();
    }, delay);
    workerTimers.push(timer);
  };
  tick();
}

/**
 * Start the cron scheduler
 */
async function startCron() {
  console.log('[cron] starting scheduler loop');
  console.log(`[cron] base tick: ${BASE_TICK_MS / 1000}s | default working-hours interval: ${CRON_INTERVAL_MS / 1000}s`);

  // ── Restore last-run timestamps from Redis (survives restarts) ─────────────
  const saved = await cronGuard.load();
  if (Object.keys(saved).length > 0) {
    lastOpportunitySlotsRun             = saved.opportunitySlots            ?? 0;
    lastGovernanceAuditRun              = saved.governanceAudit             ?? 0;
    lastAutoOptimizationRun             = saved.autoOptimization            ?? 0;
    lastEngagementPollingEnqueue        = saved.engagementPolling           ?? 0;
    lastIntelligencePollingEnqueue      = saved.intelligencePolling         ?? 0;
    lastSignalClusteringRun             = saved.signalClustering            ?? 0;
    lastSignalIntelligenceRun           = saved.signalIntelligence          ?? 0;
    lastStrategicThemeRun               = saved.strategicTheme              ?? 0;
    lastCampaignOpportunityRun          = saved.campaignOpportunity         ?? 0;
    lastContentOpportunityRun           = saved.contentOpportunity          ?? 0;
    lastNarrativeEngineRun              = saved.narrativeEngine             ?? 0;
    lastCommunityPostRun                = saved.communityPost               ?? 0;
    lastThreadEngineRun                 = saved.threadEngine                ?? 0;
    lastEngagementCaptureRun            = saved.engagementCapture           ?? 0;
    lastFeedbackIntelligenceRun         = saved.feedbackIntelligence        ?? 0;
    lastCompanyTrendRelevanceRun        = saved.companyTrendRelevance       ?? 0;
    lastPerformanceIngestionRun         = saved.performanceIngestion        ?? 0;
    lastPerformanceAggregationRun       = saved.performanceAggregation      ?? 0;
    lastCampaignHealthEvaluationRun     = saved.campaignHealthEvaluation    ?? 0;
    lastDailyIntelligenceRun            = saved.dailyIntelligence           ?? 0;
    lastIntelligenceEventCleanupRun     = saved.intelligenceEventCleanup    ?? 0;
    lastEngagementDigestRun             = saved.engagementDigest            ?? 0;
    lastEngagementSignalSchedulerRun    = saved.engagementSignalScheduler   ?? 0;
    lastEngagementSignalArchiveRun      = saved.engagementSignalArchive     ?? 0;
    lastEngagementOpportunityScannerRun = saved.engagementOpportunityScanner ?? 0;
    lastConnectorTokenRefreshRun        = saved.connectorTokenRefresh       ?? 0;
    lastLeadThreadQueueCleanupRun       = saved.leadThreadQueueCleanup      ?? 0;
    console.info('[cron-guard] last-run timestamps restored — tasks will respect their intervals on startup');
  }

  // First execution: run intelligence polling immediately (don't wait 2 hours)
  if (!lastIntelligencePollingEnqueue) {
    lastIntelligencePollingEnqueue = Date.now();
    try {
      const result = await enqueueIntelligencePolling();
      console.log(`[intelligence] polling jobs enqueued`, { count: result.enqueued });
    } catch (error: any) {
      console.error('❌ Intelligence polling enqueue error (startup):', error.message);
    }
  }

  // Run full scheduler cycle immediately on startup
  _lastPublishCycleRun = Date.now();
  await runSchedulerCycle();

  // Base tick fires every 15 min; the cycle only runs when the working-hours
  // interval (or off-hours 6-hour gap) has elapsed.
  cronInterval = setInterval(async () => {
    if (await shouldRunPublishCycle()) {
      _lastPublishCycleRun = Date.now();
      await runSchedulerCycle();
    }
  }, BASE_TICK_MS);

  // All recurring workers — defined once via scheduleWorker(fn, intervalMs, label, logFields, jitterMs)
  // Safety-net: enqueue a BullMQ drain job every 5 min in case the event-driven
  // path missed any rows (e.g. transient Redis error). The worker process in
  // main.ts does the actual work — cron only fires the trigger.
  scheduleWorker(
    async () => {
      await getLeadThreadRecomputeQueue().add('recompute', {}, { jobId: 'drain', delay: 200 });
      return {};
    },
    LEAD_THREAD_RECOMPUTE_SAFETYNET_MS, 'leadThreadRecompute-safetynet',
    []
  );
  scheduleWorker(
    async () => {
      await getConversationMemoryRebuildQueue().add('rebuild', {}, { jobId: 'drain', delay: 200 });
      return {};
    },
    CONVERSATION_MEMORY_SAFETYNET_MS, 'conversationMemory-safetynet',
    []
  );
  scheduleWorker(
    () => runResponsePerformanceEvaluationWorker() as any,
    RESPONSE_PERFORMANCE_EVAL_INTERVAL_MS, 'responsePerformanceEval',
    ['closed', 'errors']
  );
  scheduleWorker(
    () => runReplyIntelligenceAggregationWorker() as any,
    REPLY_INTELLIGENCE_AGGREGATION_INTERVAL_MS, 'replyIntelligenceAggregation',
    ['processed', 'upserted', 'errors']
  );
  scheduleWorker(
    () => runEngagementOpportunityDetectionWorker() as any,
    ENGAGEMENT_OPPORTUNITY_DETECTION_INTERVAL_MS, 'engagementOpportunityDetection',
    ['processed', 'opportunities', 'errors']
  );
  scheduleWorker(
    () => runConversationTriageWorker() as any,
    CONVERSATION_TRIAGE_INTERVAL_MS, 'conversationTriage',
    ['processed', 'errors']
  );
  scheduleWorker(
    () => runResponseStrategyLearningWorker() as any,
    RESPONSE_STRATEGY_LEARNING_INTERVAL_MS, 'responseStrategyLearning',
    ['processed', 'upserted', 'errors']
  );
  scheduleWorker(
    () => runOpportunityLearningWorker() as any,
    OPPORTUNITY_LEARNING_INTERVAL_MS, 'opportunityLearning',
    ['processed', 'errors']
  );
  scheduleWorker(
    () => runInfluencerLearningWorker() as any,
    INFLUENCER_LEARNING_INTERVAL_MS, 'influencerLearning',
    ['organizations_processed', 'influencers_upserted', 'errors']
  );
  scheduleWorker(
    () => runInsightLearningWorker() as any,
    INSIGHT_LEARNING_INTERVAL_MS, 'insightLearning',
    ['organizations_processed', 'insights_created', 'errors']
  );
  scheduleWorker(
    () => runBuyerIntentLearningWorker() as any,
    BUYER_INTENT_INTERVAL_MS, 'buyerIntentLearning',
    ['organizations_processed', 'accounts_upserted', 'errors']
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n Received ${signal}. Shutting down cron...`);
    if (cronInterval) {
      clearInterval(cronInterval);
      cronInterval = null;
    }
    // Clear all worker timers registered via scheduleWorker()
    for (const t of workerTimers) clearTimeout(t);
    workerTimers.length = 0;
    // Close Redis clients
    cronGuard.shutdown();
    cronInstr.shutdown();
    shutdownAdminRuntimeConfig();
    shutdownIntentExecutionRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Run one scheduler cycle
 */
async function runSchedulerCycle() {
  // ── Distributed lock: skip cycle if another instance is already running ─────
  const lockAcquired = await cronGuard.tryAcquireLock(cronInstr.instanceId);
  if (!lockAcquired) {
    console.warn('[cron] lock held by another instance — skipping cycle');
    return;
  }

  // Warm cron admin-config cache so shouldRunCronJob() reads current overrides
  await getCronAdminConfig();
  // Warm intent context: loads company feature flags, active-company state,
  // consumes any pending user-triggered job flags, and flushes savings counters.
  await warmIntentContext();

  const startTime = Date.now();
  console.log(`\n🔄 Running scheduler cycle at ${new Date().toISOString()}`);

  // ── Instrumentation: snapshot timestamps before any job runs ───────────────
  cronInstr.cycleStart();
  const _snap = {
    opportunitySlots:             lastOpportunitySlotsRun,
    governanceAudit:              lastGovernanceAuditRun,
    autoOptimization:             lastAutoOptimizationRun,
    engagementPolling:            lastEngagementPollingEnqueue,
    intelligencePolling:          lastIntelligencePollingEnqueue,
    signalClustering:             lastSignalClusteringRun,
    signalIntelligence:           lastSignalIntelligenceRun,
    strategicTheme:               lastStrategicThemeRun,
    campaignOpportunity:          lastCampaignOpportunityRun,
    contentOpportunity:           lastContentOpportunityRun,
    narrativeEngine:              lastNarrativeEngineRun,
    communityPost:                lastCommunityPostRun,
    threadEngine:                 lastThreadEngineRun,
    engagementCapture:            lastEngagementCaptureRun,
    feedbackIntelligence:         lastFeedbackIntelligenceRun,
    companyTrendRelevance:        lastCompanyTrendRelevanceRun,
    performanceIngestion:         lastPerformanceIngestionRun,
    performanceAggregation:       lastPerformanceAggregationRun,
    campaignHealthEvaluation:     lastCampaignHealthEvaluationRun,
    dailyIntelligence:            lastDailyIntelligenceRun,
    intelligenceEventCleanup:     lastIntelligenceEventCleanupRun,
    engagementDigest:             lastEngagementDigestRun,
    engagementSignalScheduler:    lastEngagementSignalSchedulerRun,
    engagementSignalArchive:      lastEngagementSignalArchiveRun,
    engagementOpportunityScanner: lastEngagementOpportunityScannerRun,
    connectorTokenRefresh:        lastConnectorTokenRefreshRun,
    leadThreadQueueCleanup:       lastLeadThreadQueueCleanupRun,
    confidenceCalibration:        lastConfidenceCalibrationRun,
    scheduledLeadHour:            lastScheduledLeadRunHour,
  };

  try {
    const result = await findDuePostsAndEnqueue();
    const duration = Date.now() - startTime;

    console.log(
      `✅ Scheduler cycle completed in ${duration}ms. ` +
      `Found ${result.found} due posts, ` +
      `created ${result.created} new jobs, ` +
      `skipped ${result.skipped} posts`
    );
  } catch (error: any) {
    console.error('❌ Scheduler cycle error:', error.message);
    // Don't throw - continue running on next interval
  }

  // Run opportunity slots task once per day
  if (shouldRunCronJob("opportunitySlots", OPPORTUNITY_SLOTS_INTERVAL_MS, lastOpportunitySlotsRun)) {
    lastOpportunitySlotsRun = Date.now();
    try {
      const opp = await runOpportunitySlotsScheduler();
      console.log(
        `✅ Opportunity slots: reopened ${opp.reopened}, companies ${opp.companiesProcessed}, types ${opp.typesProcessed}` +
        (opp.errors.length ? `; ${opp.errors.length} error(s)` : '')
      );
      if (opp.errors.length) {
        opp.errors.forEach((e) => console.warn('Opportunity slots:', e));
      }
    } catch (error: any) {
      console.error('❌ Opportunity slots scheduler error:', error.message);
    }
  }

  // Run governance audit once per day (Stage 28)
  if (shouldRunCronJob("governanceAudit", GOVERNANCE_AUDIT_INTERVAL_MS, lastGovernanceAuditRun)) {
    lastGovernanceAuditRun = Date.now();
    try {
      await runAllCompanyAudits();
      console.log('✅ Governance audit completed');
    } catch (error: any) {
      console.error('❌ Governance audit error:', error.message);
    }
  }

  // Run auto-optimization once per day (Stage 37)
  if (shouldRunCronJob("autoOptimization", AUTO_OPTIMIZATION_INTERVAL_MS, lastAutoOptimizationRun)) {
    lastAutoOptimizationRun = Date.now();
    try {
      await runAutoOptimizationForEligibleCampaigns();
    } catch (error: any) {
      console.error('❌ Auto-optimization error:', error.message);
    }
  }

  // Scheduled lead detection at 07:00 and 18:00 (twice daily)
  // BUG#19 fix: gate behind shouldRunCronJob so Redis usage protection + admin
  // overrides can throttle or disable it like every other job.
  const now = new Date();
  const currentHour = now.getHours();
  const LEAD_DETECTION_INTERVAL_MS = 6 * 3600 * 1000;  // 6 hours between runs
  if (
    (currentHour === 7 || currentHour === 18) &&
    lastScheduledLeadRunHour !== currentHour &&
    shouldRunCronJob('scheduledLeadDetection', LEAD_DETECTION_INTERVAL_MS, lastScheduledLeadRunMs)
  ) {
    lastScheduledLeadRunHour = currentHour;
    lastScheduledLeadRunMs   = Date.now();
    try {
      const result = await enqueueScheduledLeadDetection();
      if (result.enqueued > 0 || result.errors.length > 0) {
        console.log(`[scheduledLeadDetection] enqueued=${result.enqueued} errors=${result.errors.length}`);
        if (result.errors.length > 0) {
          result.errors.slice(0, 3).forEach((e) => console.warn('Scheduled lead:', e));
        }
      }
    } catch (error: any) {
      console.error('❌ Scheduled lead detection error:', error.message);
    }
  } else if (currentHour !== 7 && currentHour !== 18) {
    lastScheduledLeadRunHour = -1;
  }

  // Lead thread queue cleanup every 10 minutes (orphan rows)
  if (shouldRunCronJob("leadThreadQueueCleanup", LEAD_THREAD_QUEUE_CLEANUP_INTERVAL_MS, lastLeadThreadQueueCleanupRun)) {
    lastLeadThreadQueueCleanupRun = Date.now();
    try {
      const result = await runLeadThreadRecomputeQueueCleanup();
      if (result.deleted > 0) {
        console.log(`[leadThreadRecompute] cleanup deleted ${result.deleted} orphan queue rows`);
      }
    } catch (err: any) {
      console.warn('[leadThreadRecompute] cleanup error', err?.message);
    }
  }

  // Enqueue engagement polling every 10 minutes (ingestion only; no evaluation changes)
  if (shouldRunCronJob("engagementPolling", ENGAGEMENT_POLLING_INTERVAL_MS, lastEngagementPollingEnqueue)) {
    lastEngagementPollingEnqueue = Date.now();
    try {
      await enqueueEngagementPolling();
    } catch (error: any) {
      console.error('❌ Engagement polling enqueue error:', error.message);
    }
  }

  // Enqueue intelligence polling every 2 hours (external API → signal store)
  if (shouldRunCronJob("intelligencePolling", INTELLIGENCE_POLLING_INTERVAL_MS, lastIntelligencePollingEnqueue)) {
    lastIntelligencePollingEnqueue = Date.now();
    try {
      const result = await enqueueIntelligencePolling();
      console.log(`[intelligence] polling jobs enqueued`, { count: result.enqueued });
      if (result.enqueued > 0) {
        console.log(`✅ Intelligence polling enqueued: ${result.enqueued} jobs`);
      }
    } catch (error: any) {
      console.error('❌ Intelligence polling enqueue error:', error.message);
    }
  }

  // Run signal clustering every 30 minutes (group similar signals into clusters)
  if (shouldRunCronJob("signalClustering", SIGNAL_CLUSTERING_INTERVAL_MS, lastSignalClusteringRun)) {
    lastSignalClusteringRun = Date.now();
    try {
      const result = await runSignalClustering();
      if (!('skipped' in result) && result.signals_processed > 0) {
        console.log(
          `✅ Signal clustering: ${result.signals_processed} signals, ` +
            `${result.clusters_created} created, ${result.clusters_updated} updated`
        );
      }
    } catch (error: any) {
      console.error('❌ Signal clustering error:', error.message);
    }
  }

  // Run signal intelligence engine every hour (clusters → actionable intelligence)
  if (shouldRunCronJob("signalIntelligence", SIGNAL_INTELLIGENCE_INTERVAL_MS, lastSignalIntelligenceRun)) {
    lastSignalIntelligenceRun = Date.now();
    try {
      const result = await runSignalIntelligenceEngine();
      if (!('skipped' in result) && result.clusters_processed > 0) {
        console.log(
          `✅ Signal intelligence: ${result.clusters_processed} clusters, ${result.records_upserted} records`
        );
      }
    } catch (error: any) {
      console.error('❌ Signal intelligence engine error:', error.message);
    }
  }

  // Run strategic theme engine every hour (intelligence → theme cards)
  if (shouldRunCronJob("strategicTheme", STRATEGIC_THEME_INTERVAL_MS, lastStrategicThemeRun)) {
    lastStrategicThemeRun = Date.now();
    try {
      const result = await runStrategicThemeEngine();
      if (!('skipped' in result) && result.themes_created > 0) {
        console.log(
          `✅ Strategic themes: ${result.themes_created} created, ${result.themes_skipped} skipped`
        );
      }
    } catch (error: any) {
      console.error('❌ Strategic theme engine error:', error.message);
    }
  }

  // Run campaign opportunity engine every hour (themes → campaign opportunities)
  if (shouldRunCronJob("campaignOpportunity", CAMPAIGN_OPPORTUNITY_INTERVAL_MS, lastCampaignOpportunityRun)) {
    lastCampaignOpportunityRun = Date.now();
    try {
      const result = await runCampaignOpportunityEngine();
      if (!('skipped' in result) && result.opportunities_created > 0) {
        console.log(
          `✅ Campaign opportunities: ${result.opportunities_created} created (${result.themes_processed} themes)`
        );
      }
    } catch (error: any) {
      console.error('❌ Campaign opportunity engine error:', error.message);
    }
  }

  // Run content opportunity engine every 2 hours (themes → content_opportunities)
  if (shouldRunCronJob("contentOpportunity", CONTENT_OPPORTUNITY_INTERVAL_MS, lastContentOpportunityRun)) {
    lastContentOpportunityRun = Date.now();
    try {
      const result = await runContentOpportunityEngine();
      if (!('skipped' in result) && result.opportunities_created > 0) {
        console.log(
          `✅ Content opportunities: ${result.opportunities_created} created (${result.themes_processed} themes)`
        );
      }
    } catch (error: any) {
      console.error('❌ Content opportunity engine error:', error.message);
    }
  }

  // Run narrative engine every 4 hours (content_opportunities → campaign_narratives)
  if (shouldRunCronJob("narrativeEngine", NARRATIVE_ENGINE_INTERVAL_MS, lastNarrativeEngineRun)) {
    lastNarrativeEngineRun = Date.now();
    try {
      const result = await runNarrativeEngine();
      if (!('skipped' in result) && result.narratives_created > 0) {
        console.log(
          `✅ Campaign narratives: ${result.narratives_created} created (${result.opportunities_processed} opportunities)`
        );
      }
    } catch (error: any) {
      console.error('❌ Narrative engine error:', error.message);
    }
  }

  // Run community post engine every 3 hours (narratives → community_posts)
  if (shouldRunCronJob("communityPost", COMMUNITY_POST_INTERVAL_MS, lastCommunityPostRun)) {
    lastCommunityPostRun = Date.now();
    try {
      const result = await runCommunityPostEngine();
      if (!('skipped' in result) && result.posts_created > 0) {
        console.log(
          `✅ Community posts: ${result.posts_created} created (${result.narratives_processed} narratives)`
        );
      }
    } catch (error: any) {
      console.error('❌ Community post engine error:', error.message);
    }
  }

  // Run thread engine every 3 hours (community_posts → community_threads)
  if (shouldRunCronJob("threadEngine", THREAD_ENGINE_INTERVAL_MS, lastThreadEngineRun)) {
    lastThreadEngineRun = Date.now();
    try {
      const result = await runThreadEngine();
      if (!('skipped' in result) && result.threads_created > 0) {
        console.log(
          `✅ Community threads: ${result.threads_created} created (${result.posts_processed} posts)`
        );
      }
    } catch (error: any) {
      console.error('❌ Thread engine error:', error.message);
    }
  }

  // Run engagement capture every 30 minutes (community_posts → engagement_signals)
  if (shouldRunCronJob("engagementCapture", ENGAGEMENT_CAPTURE_INTERVAL_MS, lastEngagementCaptureRun)) {
    lastEngagementCaptureRun = Date.now();
    try {
      const result = await runEngagementCapture();
      if (!('skipped' in result) && result.signals_created > 0) {
        console.log(
          `✅ Engagement capture: ${result.signals_created} signals (${result.posts_processed} posts)`
        );
      }
    } catch (error: any) {
      console.error('❌ Engagement capture error:', error.message);
    }
  }

  // Run feedback intelligence engine every 6 hours (engagement_signals → feedback_intelligence)
  if (shouldRunCronJob("feedbackIntelligence", FEEDBACK_INTELLIGENCE_INTERVAL_MS, lastFeedbackIntelligenceRun)) {
    lastFeedbackIntelligenceRun = Date.now();
    try {
      const result = await runFeedbackIntelligenceEngine();
      if (!('skipped' in result) && result.insights_created > 0) {
        console.log(
          `✅ Feedback intelligence: ${result.insights_created} insights (${result.signals_analyzed} signals)`
        );
      }
    } catch (error: any) {
      console.error('❌ Feedback intelligence engine error:', error.message);
    }
  }

  // Run company trend relevance every 6 hours (theme–company scoring)
  if (shouldRunCronJob("companyTrendRelevance", COMPANY_TREND_RELEVANCE_INTERVAL_MS, lastCompanyTrendRelevanceRun)) {
    lastCompanyTrendRelevanceRun = Date.now();
    try {
      const result = await runCompanyTrendRelevance();
      if (result.total_themes_scored > 0) {
        console.log(
          `✅ Company trend relevance: ${result.companies_processed} companies, ${result.total_themes_scored} theme scores`
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 5).forEach((e) => console.warn('Company trend relevance:', e));
      }
    } catch (error: any) {
      console.error('❌ Company trend relevance error:', error.message);
    }
  }

  // Run performance ingestion every 6 hours (content_analytics → campaign_performance_signals)
  if (shouldRunCronJob("performanceIngestion", PERFORMANCE_INGESTION_INTERVAL_MS, lastPerformanceIngestionRun)) {
    lastPerformanceIngestionRun = Date.now();
    try {
      const result = await runPerformanceIngestion();
      if (result.signalsInserted > 0) {
        console.log(
          `✅ Performance ingestion: ${result.signalsInserted} signals, ${result.postsProcessed} posts`
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e) => console.warn('Performance ingestion:', e));
      }
    } catch (error: any) {
      console.error('❌ Performance ingestion error:', error.message);
    }
  }

  // Run performance aggregation once per day (signals → company aggregates)
  if (shouldRunCronJob("performanceAggregation", PERFORMANCE_AGGREGATION_INTERVAL_MS, lastPerformanceAggregationRun)) {
    lastPerformanceAggregationRun = Date.now();
    try {
      const result = await runPerformanceAggregation();
      if (result.themesUpdated > 0 || result.platformsUpdated > 0 || result.contentTypesUpdated > 0) {
        console.log(
          `✅ Performance aggregation: ${result.companiesProcessed} companies, ` +
            `${result.themesUpdated} themes, ${result.platformsUpdated} platforms, ${result.contentTypesUpdated} content types`
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e) => console.warn('Performance aggregation:', e));
      }
    } catch (error: any) {
      console.error('❌ Performance aggregation error:', error.message);
    }
  }

  // Run campaign health evaluation once per day (design + execution → suggestions)
  if (shouldRunCronJob("campaignHealthEvaluation", CAMPAIGN_HEALTH_EVALUATION_INTERVAL_MS, lastCampaignHealthEvaluationRun)) {
    lastCampaignHealthEvaluationRun = Date.now();
    try {
      const result = await runCampaignHealthEvaluation();
      if (result.campaigns_evaluated > 0 || result.reports_stored > 0) {
        console.log(
          `✅ Campaign health evaluation: ${result.campaigns_evaluated} evaluated, ${result.reports_stored} reports stored`
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e) => console.warn('Campaign health evaluation:', e));
      }
    } catch (error: any) {
      console.error('❌ Campaign health evaluation error:', error.message);
    }
  }

  // Run daily intelligence (Campaign Health + Strategic Insights + Opportunity Detection) once per day
  if (shouldRunCronJob("dailyIntelligence", DAILY_INTELLIGENCE_INTERVAL_MS, lastDailyIntelligenceRun)) {
    lastDailyIntelligenceRun = Date.now();
    try {
      const result = await runDailyIntelligence();
      if (result.campaigns_processed > 0) {
        console.log(
          `✅ Daily intelligence: ${result.campaigns_processed} campaigns, ${result.execution_time_ms}ms`
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e) => console.warn('Daily intelligence:', e));
      }
    } catch (error: any) {
      console.error('❌ Daily intelligence error:', error.message);
    }
  }

  // Run intelligence event cleanup once per day (delete events older than 180 days)
  if (shouldRunCronJob("intelligenceEventCleanup", INTELLIGENCE_EVENT_CLEANUP_INTERVAL_MS, lastIntelligenceEventCleanupRun)) {
    lastIntelligenceEventCleanupRun = Date.now();
    try {
      const result = await runIntelligenceEventCleanup();
      if (result.events_deleted > 0 || result.errors.length > 0) {
        console.log(
          `✅ Intelligence event cleanup: ${result.events_deleted} events deleted (older than ${result.cutoff_timestamp})` +
            (result.errors.length ? `; ${result.errors.length} error(s)` : '')
        );
      }
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e) => console.warn('Intelligence event cleanup:', e));
      }
    } catch (error: any) {
      console.error('❌ Intelligence event cleanup error:', error.message);
    }
  }

  // Run engagement digest once per day (daily summary per organization)
  if (shouldRunCronJob("engagementDigest", ENGAGEMENT_DIGEST_INTERVAL_MS, lastEngagementDigestRun)) {
    lastEngagementDigestRun = Date.now();
    try {
      const result = await runEngagementDigestWorker();
      if (result.processed > 0 || result.errors > 0) {
        console.log(
          `✅ Engagement digest: processed=${result.processed} organizations, errors=${result.errors}`
        );
      }
    } catch (error: any) {
      console.error('❌ Engagement digest error:', error.message);
    }
  }

  // Run engagement signal collection every 15 minutes (LinkedIn, Twitter, community)
  if (shouldRunCronJob("engagementSignalScheduler", ENGAGEMENT_SIGNAL_SCHEDULER_INTERVAL_MS, lastEngagementSignalSchedulerRun)) {
    lastEngagementSignalSchedulerRun = Date.now();
    try {
      const result = await runEngagementSignalScheduler();
      if (result.activities_processed > 0 || (result.linkedin_count + result.twitter_count + result.community_count) > 0) {
        console.log(
          `✅ Engagement signal collection: ${result.activities_processed} activities, LI=${result.linkedin_count} TW=${result.twitter_count} CM=${result.community_count}`
        );
      }
      if (result.errors.length > 0) {
        console.warn(`[engagementSignalScheduler] ${result.errors.length} errors`);
      }
    } catch (error: any) {
      console.error('❌ Engagement signal scheduler error:', error.message);
    }
  }

  // Run engagement opportunity scanner every 4 hours (signals → opportunity_radar)
  if (shouldRunCronJob("engagementOpportunityScanner", ENGAGEMENT_OPPORTUNITY_SCANNER_INTERVAL_MS, lastEngagementOpportunityScannerRun)) {
    lastEngagementOpportunityScannerRun = Date.now();
    try {
      const scanResult = await runEngagementOpportunityScanner();
      if (scanResult.signals_processed > 0 || scanResult.opportunities_inserted > 0) {
        console.log(
          `✅ Engagement opportunity scanner: ${scanResult.signals_processed} signals, ` +
            `${scanResult.opportunities_inserted} opportunities inserted`
        );
      }
      if (scanResult.processing_errors.length > 0) {
        scanResult.processing_errors.slice(0, 3).forEach((e) => console.warn('[engagementOpportunityScanner]', e));
      }
    } catch (error: any) {
      console.error('❌ Engagement opportunity scanner error:', error.message);
    }
  }

  // Run connector token refresh every 6 hours (G5.4 - community_ai_platform_tokens)
  if (shouldRunCronJob("connectorTokenRefresh", CONNECTOR_TOKEN_REFRESH_INTERVAL_MS, lastConnectorTokenRefreshRun)) {
    lastConnectorTokenRefreshRun = Date.now();
    try {
      const result = await runConnectorTokenRefreshJob();
      if (result.refreshed > 0 || result.errors > 0) {
        console.log(
          `✅ Connector token refresh: ${result.refreshed} refreshed, ${result.skipped} skipped, ${result.errors} errors`
        );
      }
    } catch (error: any) {
      console.error('❌ Connector token refresh error:', error.message);
    }
  }

  // Archive signals older than 180 days (nightly)
  if (shouldRunCronJob("engagementSignalArchive", ENGAGEMENT_SIGNAL_ARCHIVE_INTERVAL_MS, lastEngagementSignalArchiveRun)) {
    lastEngagementSignalArchiveRun = Date.now();
    try {
      const result = await archiveOldSignals();
      if (result.archived > 0) {
        console.log(`✅ Engagement signal archive: ${result.archived} signals archived`);
      }
      if (result.errors.length > 0) {
        console.warn(`[engagementSignalArchive] ${result.errors.join(', ')}`);
      }
    } catch (error: any) {
      console.error('❌ Engagement signal archive error:', error.message);
    }
  }

  // Calibrate confidence thresholds weekly (campaign planner edge case #3)
  if (shouldRunCronJob("confidenceCalibration", CONFIDENCE_CALIBRATION_INTERVAL_MS, lastConfidenceCalibrationRun)) {
    lastConfidenceCalibrationRun = Date.now();
    try {
      const thresholds = await calibrateThresholds();
      console.log('[confidenceCalibrator] calibration complete', thresholds);
    } catch (error: any) {
      console.error('❌ Confidence calibration error:', error.message);
    }
  }

  // ── Instrumentation: detect which jobs fired by comparing timestamps ────────
  const _after: Record<string, number> = {
    opportunitySlots:             lastOpportunitySlotsRun,
    governanceAudit:              lastGovernanceAuditRun,
    autoOptimization:             lastAutoOptimizationRun,
    engagementPolling:            lastEngagementPollingEnqueue,
    intelligencePolling:          lastIntelligencePollingEnqueue,
    signalClustering:             lastSignalClusteringRun,
    signalIntelligence:           lastSignalIntelligenceRun,
    strategicTheme:               lastStrategicThemeRun,
    campaignOpportunity:          lastCampaignOpportunityRun,
    contentOpportunity:           lastContentOpportunityRun,
    narrativeEngine:              lastNarrativeEngineRun,
    communityPost:                lastCommunityPostRun,
    threadEngine:                 lastThreadEngineRun,
    engagementCapture:            lastEngagementCaptureRun,
    feedbackIntelligence:         lastFeedbackIntelligenceRun,
    companyTrendRelevance:        lastCompanyTrendRelevanceRun,
    performanceIngestion:         lastPerformanceIngestionRun,
    performanceAggregation:       lastPerformanceAggregationRun,
    campaignHealthEvaluation:     lastCampaignHealthEvaluationRun,
    dailyIntelligence:            lastDailyIntelligenceRun,
    intelligenceEventCleanup:     lastIntelligenceEventCleanupRun,
    engagementDigest:             lastEngagementDigestRun,
    engagementSignalScheduler:    lastEngagementSignalSchedulerRun,
    engagementSignalArchive:      lastEngagementSignalArchiveRun,
    engagementOpportunityScanner: lastEngagementOpportunityScannerRun,
    connectorTokenRefresh:        lastConnectorTokenRefreshRun,
    leadThreadQueueCleanup:       lastLeadThreadQueueCleanupRun,
    confidenceCalibration:        lastConfidenceCalibrationRun,
    scheduledLeadHour:            lastScheduledLeadRunHour,
  };
  const _triggered = Object.keys(_after).filter(k => _after[k] !== (_snap as Record<string, number>)[k]);
  cronInstr.cycleEnd(_triggered);

  // ── Persist last-run timestamps to Redis (survives restarts) ───────────────
  void cronGuard.save({
    opportunitySlots:             lastOpportunitySlotsRun,
    governanceAudit:              lastGovernanceAuditRun,
    autoOptimization:             lastAutoOptimizationRun,
    engagementPolling:            lastEngagementPollingEnqueue,
    intelligencePolling:          lastIntelligencePollingEnqueue,
    signalClustering:             lastSignalClusteringRun,
    signalIntelligence:           lastSignalIntelligenceRun,
    strategicTheme:               lastStrategicThemeRun,
    campaignOpportunity:          lastCampaignOpportunityRun,
    contentOpportunity:           lastContentOpportunityRun,
    narrativeEngine:              lastNarrativeEngineRun,
    communityPost:                lastCommunityPostRun,
    threadEngine:                 lastThreadEngineRun,
    engagementCapture:            lastEngagementCaptureRun,
    feedbackIntelligence:         lastFeedbackIntelligenceRun,
    companyTrendRelevance:        lastCompanyTrendRelevanceRun,
    performanceIngestion:         lastPerformanceIngestionRun,
    performanceAggregation:       lastPerformanceAggregationRun,
    campaignHealthEvaluation:     lastCampaignHealthEvaluationRun,
    dailyIntelligence:            lastDailyIntelligenceRun,
    intelligenceEventCleanup:     lastIntelligenceEventCleanupRun,
    engagementDigest:             lastEngagementDigestRun,
    engagementSignalScheduler:    lastEngagementSignalSchedulerRun,
    engagementSignalArchive:      lastEngagementSignalArchiveRun,
    engagementOpportunityScanner: lastEngagementOpportunityScannerRun,
    connectorTokenRefresh:        lastConnectorTokenRefreshRun,
    leadThreadQueueCleanup:       lastLeadThreadQueueCleanupRun,
    confidenceCalibration:        lastConfidenceCalibrationRun,
  });

  // Release distributed lock now that cycle is complete
  void cronGuard.releaseLock(cronInstr.instanceId);
}

// Start cron if this file is run directly
if (require.main === module) {
  startCron().catch((err) => {
    console.error('Failed to start cron:', err);
    process.exit(1);
  });
}

export { startCron, runSchedulerCycle };

