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

import { findDuePostsAndEnqueue, enqueueEngagementPolling } from './schedulerService';
import { runOpportunitySlotsScheduler } from '../services/opportunitySlotsScheduler';
import { runAllCompanyAudits } from '../jobs/governanceAuditJob';
import { runAutoOptimizationForEligibleCampaigns } from '../jobs/autoOptimizationJob';

const CRON_INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_SECONDS || '60') * 1000;
const OPPORTUNITY_SLOTS_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const GOVERNANCE_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const AUTO_OPTIMIZATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const ENGAGEMENT_POLLING_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
let lastOpportunitySlotsRun = 0;
let lastGovernanceAuditRun = 0;
let lastAutoOptimizationRun = 0;
let lastEngagementPollingEnqueue = 0;

let cronInterval: NodeJS.Timeout | null = null;

/**
 * Start the cron scheduler
 */
async function startCron() {
  console.log(`⏰ Starting cron scheduler (interval: ${CRON_INTERVAL_MS / 1000}s)...`);

  // Run immediately on startup
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
}

// Start cron if this file is run directly
if (require.main === module) {
  startCron().catch((err) => {
    console.error('Failed to start cron:', err);
    process.exit(1);
  });
}

export { startCron, runSchedulerCycle };

