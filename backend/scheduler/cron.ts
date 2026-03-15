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
import {
  runLeadThreadRecomputeWorker,
  runLeadThreadRecomputeQueueCleanup,
} from '../workers/leadThreadRecomputeWorker';
import { runConversationMemoryWorker } from '../workers/conversationMemoryWorker';
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

const CRON_INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_SECONDS || '60') * 1000;
const LEAD_THREAD_QUEUE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const LEAD_THREAD_RECOMPUTE_BASE_MS = 5 * 1000; // 5 seconds
const LEAD_THREAD_RECOMPUTE_JITTER_MS = 2 * 1000; // 0-2 seconds jitter
const CONVERSATION_MEMORY_WORKER_INTERVAL_MS = 10 * 1000; // 10 seconds
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
const CONNECTOR_TOKEN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours (G5.4)
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
let lastScheduledLeadRunHour = -1;

let cronInterval: NodeJS.Timeout | null = null;

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
      try {
        const result = await fn();
        const hasActivity = logFields.some((f) => (result[f] ?? 0) > 0);
        if (hasActivity) {
          const parts = logFields.map((f) => `${f}=${result[f] ?? 0}`).join(' ');
          console.log(`[${label}] ${parts}`);
        }
      } catch (err: any) {
        console.warn(`[${label}] worker error`, err?.message);
      }
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
  console.log('[startup] cron scheduler started');
  console.log(`⏰ Starting cron scheduler (interval: ${CRON_INTERVAL_MS / 1000}s)...`);

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
  await runSchedulerCycle();

  // Then run on interval
  cronInterval = setInterval(async () => {
    await runSchedulerCycle();
  }, CRON_INTERVAL_MS);

  // All recurring workers — defined once via scheduleWorker(fn, intervalMs, label, logFields, jitterMs)
  scheduleWorker(
    () => runLeadThreadRecomputeWorker() as any,
    LEAD_THREAD_RECOMPUTE_BASE_MS, 'leadThreadRecompute',
    ['processed', 'errors', 'retriesExhausted'],
    LEAD_THREAD_RECOMPUTE_JITTER_MS
  );
  scheduleWorker(
    () => runConversationMemoryWorker() as any,
    CONVERSATION_MEMORY_WORKER_INTERVAL_MS, 'conversationMemory',
    ['processed', 'errors']
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
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Run one scheduler cycle
 */
async function runSchedulerCycle() {
  const startTime = Date.now();
  console.log(`\n🔄 Running scheduler cycle at ${new Date().toISOString()}`);

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
  if (Date.now() - lastOpportunitySlotsRun >= OPPORTUNITY_SLOTS_INTERVAL_MS) {
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
  if (Date.now() - lastGovernanceAuditRun >= GOVERNANCE_AUDIT_INTERVAL_MS) {
    lastGovernanceAuditRun = Date.now();
    try {
      await runAllCompanyAudits();
      console.log('✅ Governance audit completed');
    } catch (error: any) {
      console.error('❌ Governance audit error:', error.message);
    }
  }

  // Run auto-optimization once per day (Stage 37)
  if (Date.now() - lastAutoOptimizationRun >= AUTO_OPTIMIZATION_INTERVAL_MS) {
    lastAutoOptimizationRun = Date.now();
    try {
      await runAutoOptimizationForEligibleCampaigns();
    } catch (error: any) {
      console.error('❌ Auto-optimization error:', error.message);
    }
  }

  // Scheduled lead detection at 07:00 and 18:00 (twice daily)
  const now = new Date();
  const currentHour = now.getHours();
  if ((currentHour === 7 || currentHour === 18) && lastScheduledLeadRunHour !== currentHour) {
    lastScheduledLeadRunHour = currentHour;
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
  if (Date.now() - lastLeadThreadQueueCleanupRun >= LEAD_THREAD_QUEUE_CLEANUP_INTERVAL_MS) {
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
  if (Date.now() - lastEngagementPollingEnqueue >= ENGAGEMENT_POLLING_INTERVAL_MS) {
    lastEngagementPollingEnqueue = Date.now();
    try {
      await enqueueEngagementPolling();
    } catch (error: any) {
      console.error('❌ Engagement polling enqueue error:', error.message);
    }
  }

  // Enqueue intelligence polling every 2 hours (external API → signal store)
  if (Date.now() - lastIntelligencePollingEnqueue >= INTELLIGENCE_POLLING_INTERVAL_MS) {
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
  if (Date.now() - lastSignalClusteringRun >= SIGNAL_CLUSTERING_INTERVAL_MS) {
    lastSignalClusteringRun = Date.now();
    try {
      const result = await runSignalClustering();
      if (result.signals_processed > 0) {
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
  if (Date.now() - lastSignalIntelligenceRun >= SIGNAL_INTELLIGENCE_INTERVAL_MS) {
    lastSignalIntelligenceRun = Date.now();
    try {
      const result = await runSignalIntelligenceEngine();
      if (result.clusters_processed > 0) {
        console.log(
          `✅ Signal intelligence: ${result.clusters_processed} clusters, ${result.records_upserted} records`
        );
      }
    } catch (error: any) {
      console.error('❌ Signal intelligence engine error:', error.message);
    }
  }

  // Run strategic theme engine every hour (intelligence → theme cards)
  if (Date.now() - lastStrategicThemeRun >= STRATEGIC_THEME_INTERVAL_MS) {
    lastStrategicThemeRun = Date.now();
    try {
      const result = await runStrategicThemeEngine();
      if (result.themes_created > 0) {
        console.log(
          `✅ Strategic themes: ${result.themes_created} created, ${result.themes_skipped} skipped`
        );
      }
    } catch (error: any) {
      console.error('❌ Strategic theme engine error:', error.message);
    }
  }

  // Run campaign opportunity engine every hour (themes → campaign opportunities)
  if (Date.now() - lastCampaignOpportunityRun >= CAMPAIGN_OPPORTUNITY_INTERVAL_MS) {
    lastCampaignOpportunityRun = Date.now();
    try {
      const result = await runCampaignOpportunityEngine();
      if (result.opportunities_created > 0) {
        console.log(
          `✅ Campaign opportunities: ${result.opportunities_created} created (${result.themes_processed} themes)`
        );
      }
    } catch (error: any) {
      console.error('❌ Campaign opportunity engine error:', error.message);
    }
  }

  // Run content opportunity engine every 2 hours (themes → content_opportunities)
  if (Date.now() - lastContentOpportunityRun >= CONTENT_OPPORTUNITY_INTERVAL_MS) {
    lastContentOpportunityRun = Date.now();
    try {
      const result = await runContentOpportunityEngine();
      if (result.opportunities_created > 0) {
        console.log(
          `✅ Content opportunities: ${result.opportunities_created} created (${result.themes_processed} themes)`
        );
      }
    } catch (error: any) {
      console.error('❌ Content opportunity engine error:', error.message);
    }
  }

  // Run narrative engine every 4 hours (content_opportunities → campaign_narratives)
  if (Date.now() - lastNarrativeEngineRun >= NARRATIVE_ENGINE_INTERVAL_MS) {
    lastNarrativeEngineRun = Date.now();
    try {
      const result = await runNarrativeEngine();
      if (result.narratives_created > 0) {
        console.log(
          `✅ Campaign narratives: ${result.narratives_created} created (${result.opportunities_processed} opportunities)`
        );
      }
    } catch (error: any) {
      console.error('❌ Narrative engine error:', error.message);
    }
  }

  // Run community post engine every 3 hours (narratives → community_posts)
  if (Date.now() - lastCommunityPostRun >= COMMUNITY_POST_INTERVAL_MS) {
    lastCommunityPostRun = Date.now();
    try {
      const result = await runCommunityPostEngine();
      if (result.posts_created > 0) {
        console.log(
          `✅ Community posts: ${result.posts_created} created (${result.narratives_processed} narratives)`
        );
      }
    } catch (error: any) {
      console.error('❌ Community post engine error:', error.message);
    }
  }

  // Run thread engine every 3 hours (community_posts → community_threads)
  if (Date.now() - lastThreadEngineRun >= THREAD_ENGINE_INTERVAL_MS) {
    lastThreadEngineRun = Date.now();
    try {
      const result = await runThreadEngine();
      if (result.threads_created > 0) {
        console.log(
          `✅ Community threads: ${result.threads_created} created (${result.posts_processed} posts)`
        );
      }
    } catch (error: any) {
      console.error('❌ Thread engine error:', error.message);
    }
  }

  // Run engagement capture every 30 minutes (community_posts → engagement_signals)
  if (Date.now() - lastEngagementCaptureRun >= ENGAGEMENT_CAPTURE_INTERVAL_MS) {
    lastEngagementCaptureRun = Date.now();
    try {
      const result = await runEngagementCapture();
      if (result.signals_created > 0) {
        console.log(
          `✅ Engagement capture: ${result.signals_created} signals (${result.posts_processed} posts)`
        );
      }
    } catch (error: any) {
      console.error('❌ Engagement capture error:', error.message);
    }
  }

  // Run feedback intelligence engine every 6 hours (engagement_signals → feedback_intelligence)
  if (Date.now() - lastFeedbackIntelligenceRun >= FEEDBACK_INTELLIGENCE_INTERVAL_MS) {
    lastFeedbackIntelligenceRun = Date.now();
    try {
      const result = await runFeedbackIntelligenceEngine();
      if (result.insights_created > 0) {
        console.log(
          `✅ Feedback intelligence: ${result.insights_created} insights (${result.signals_analyzed} signals)`
        );
      }
    } catch (error: any) {
      console.error('❌ Feedback intelligence engine error:', error.message);
    }
  }

  // Run company trend relevance every 6 hours (theme–company scoring)
  if (Date.now() - lastCompanyTrendRelevanceRun >= COMPANY_TREND_RELEVANCE_INTERVAL_MS) {
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
  if (Date.now() - lastPerformanceIngestionRun >= PERFORMANCE_INGESTION_INTERVAL_MS) {
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
  if (Date.now() - lastPerformanceAggregationRun >= PERFORMANCE_AGGREGATION_INTERVAL_MS) {
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
  if (Date.now() - lastCampaignHealthEvaluationRun >= CAMPAIGN_HEALTH_EVALUATION_INTERVAL_MS) {
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
  if (Date.now() - lastDailyIntelligenceRun >= DAILY_INTELLIGENCE_INTERVAL_MS) {
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
  if (Date.now() - lastIntelligenceEventCleanupRun >= INTELLIGENCE_EVENT_CLEANUP_INTERVAL_MS) {
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
  if (Date.now() - lastEngagementDigestRun >= ENGAGEMENT_DIGEST_INTERVAL_MS) {
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
  if (Date.now() - lastEngagementSignalSchedulerRun >= ENGAGEMENT_SIGNAL_SCHEDULER_INTERVAL_MS) {
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
  if (Date.now() - lastEngagementOpportunityScannerRun >= ENGAGEMENT_OPPORTUNITY_SCANNER_INTERVAL_MS) {
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
  if (Date.now() - lastConnectorTokenRefreshRun >= CONNECTOR_TOKEN_REFRESH_INTERVAL_MS) {
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
  if (Date.now() - lastEngagementSignalArchiveRun >= ENGAGEMENT_SIGNAL_ARCHIVE_INTERVAL_MS) {
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
}

// Start cron if this file is run directly
if (require.main === module) {
  startCron().catch((err) => {
    console.error('Failed to start cron:', err);
    process.exit(1);
  });
}

export { startCron, runSchedulerCycle };

