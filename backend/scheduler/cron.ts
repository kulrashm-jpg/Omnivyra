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
  runSignalClustering,
  runSignalIntelligenceEngine,
  runStrategicThemeEngine,
  runCampaignOpportunityEngine,
  runCompanyTrendRelevance,
} from './schedulerService';
import { runOpportunitySlotsScheduler } from '../services/opportunitySlotsScheduler';
import { runAllCompanyAudits } from '../jobs/governanceAuditJob';
import { runAutoOptimizationForEligibleCampaigns } from '../jobs/autoOptimizationJob';
import { runPerformanceIngestion } from '../jobs/performanceIngestionJob';
import { runPerformanceAggregation } from '../jobs/performanceAggregationJob';

const CRON_INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_SECONDS || '60') * 1000;
const OPPORTUNITY_SLOTS_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const GOVERNANCE_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const AUTO_OPTIMIZATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const ENGAGEMENT_POLLING_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const INTELLIGENCE_POLLING_INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 hours
const SIGNAL_CLUSTERING_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const SIGNAL_INTELLIGENCE_INTERVAL_MS = 60 * 60 * 1000; // every hour
const STRATEGIC_THEME_INTERVAL_MS = 60 * 60 * 1000; // every hour
const CAMPAIGN_OPPORTUNITY_INTERVAL_MS = 60 * 60 * 1000; // every hour
const COMPANY_TREND_RELEVANCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const PERFORMANCE_INGESTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const PERFORMANCE_AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
let lastOpportunitySlotsRun = 0;
let lastGovernanceAuditRun = 0;
let lastAutoOptimizationRun = 0;
let lastEngagementPollingEnqueue = 0;
let lastIntelligencePollingEnqueue = 0;
let lastSignalClusteringRun = 0;
let lastSignalIntelligenceRun = 0;
let lastStrategicThemeRun = 0;
let lastCampaignOpportunityRun = 0;
let lastCompanyTrendRelevanceRun = 0;
let lastPerformanceIngestionRun = 0;
let lastPerformanceAggregationRun = 0;

let cronInterval: NodeJS.Timeout | null = null;

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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down cron...`);
    if (cronInterval) {
      clearInterval(cronInterval);
      cronInterval = null;
    }
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
}

// Start cron if this file is run directly
if (require.main === module) {
  startCron().catch((err) => {
    console.error('Failed to start cron:', err);
    process.exit(1);
  });
}

export { startCron, runSchedulerCycle };

