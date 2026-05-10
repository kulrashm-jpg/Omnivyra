/**
 * Analytics Ingestion Processor
 *
 * Handles three job types on the 'analytics-ingestion' queue:
 *
 *   { type: 'daily-growth' }
 *     Triggered by cron at 02:00 UTC. Fetches follower/impression snapshots
 *     for all active social accounts.
 *
 *   { type: 'post-polls' }
 *     Triggered at +15 min and +24 h after every successful publish.
 *     Processes pending post_analytics_polls rows.
 *
 *   { type: 'ga4-all-companies', startDate, endDate }
 *     Triggered by /api/cron/analytics-ingestion to refresh GA4 canonical
 *     data for every company with an active GA4 integration. The worker
 *     can run for many minutes; the cron handler returns 200 immediately
 *     after enqueue so Vercel function timeouts don't truncate the work.
 */

import type { Job } from 'bullmq';
import { runDailyGrowthIngestion, runPendingPostPolls } from '../../jobs/analyticsIngestionJob';
import { runIngestionForAllCompanies } from '../../services/ingestionScheduler';

export type AnalyticsIngestionJobData =
  | { type: 'daily-growth' }
  | { type: 'post-polls'; batchSize?: number }
  | { type: 'ga4-all-companies'; startDate?: string; endDate?: string };

export async function processAnalyticsIngestionJob(job: Job<AnalyticsIngestionJobData>): Promise<void> {
  const { type } = job.data;

  if (type === 'daily-growth') {
    await runDailyGrowthIngestion();
    return;
  }

  if (type === 'post-polls') {
    const batchSize = job.data.batchSize ?? 50;
    await runPendingPostPolls(batchSize);
    return;
  }

  if (type === 'ga4-all-companies') {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDate = job.data.startDate ?? sevenDaysAgo;
    const endDate = job.data.endDate ?? today;

    const summary = await runIngestionForAllCompanies({
      sources: ['ga4'],
      overrides: { ga4: { startDate, endDate } },
    });
    console.log(
      `[analyticsIngestionProcessor][ga4-all-companies] attempted=${summary.attempted} succeeded=${summary.succeeded} failed=${summary.failed} window=${startDate}..${endDate}`,
    );
    return;
  }

  console.warn('[analyticsIngestionProcessor] Unknown job type:', (job.data as any).type);
}
