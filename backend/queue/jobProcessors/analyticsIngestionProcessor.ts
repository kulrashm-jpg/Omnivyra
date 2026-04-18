/**
 * Analytics Ingestion Processor
 *
 * Handles two job types on the 'analytics-ingestion' queue:
 *
 *   { type: 'daily-growth' }
 *     Triggered by cron at 02:00 UTC. Fetches follower/impression snapshots
 *     for all active social accounts.
 *
 *   { type: 'post-polls' }
 *     Triggered at +15 min and +24 h after every successful publish.
 *     Processes pending post_analytics_polls rows.
 */

import type { Job } from 'bullmq';
import { runDailyGrowthIngestion, runPendingPostPolls } from '../../jobs/analyticsIngestionJob';

export type AnalyticsIngestionJobData =
  | { type: 'daily-growth' }
  | { type: 'post-polls'; batchSize?: number };

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

  console.warn('[analyticsIngestionProcessor] Unknown job type:', (job.data as any).type);
}
