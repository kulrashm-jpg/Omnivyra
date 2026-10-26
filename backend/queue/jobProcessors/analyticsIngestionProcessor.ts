/**
 * Analytics Ingestion Processor
 *
 * Handles these job types on the 'analytics-ingestion' queue:
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
 *
 *   { type: 'gsc-all-companies' }
 *     Same daily trigger: Search Console sync for every company with an active GSC property, each
 *     from its own watermark (backend/services/scheduledAnalyticsSync.ts).
 *
 *   { type: 'analytics-post-connect-import', companyId, source }
 *     The first import after a company connects GA4 / GSC or selects a property.
 *
 *   { type: 'analytics-manual-sync', companyId, source, startDate, endDate }
 *     "Sync now" from the integrations page (backend/services/analyticsManualSync.ts).
 *
 *   { type: 'oauth-refresh' }
 *     Phase C — fold of the autonomous OAuth lifecycle sweep into the
 *     existing analytics-ingestion queue (Hobby plan has only 2 cron
 *     slots; a dedicated cron is a follow-up). Refreshes expiring tokens
 *     across social_accounts + analytics_integrations + meta_oauth_connections
 *     and writes canonical `connection_state`. See
 *     backend/services/integrations/oauthLifecycleScheduler.ts.
 */

import type { Job } from 'bullmq';
import { runDailyGrowthIngestion, runPendingPostPolls } from '../../jobs/analyticsIngestionJob';
import { runScheduledAnalyticsSync } from '../../services/scheduledAnalyticsSync';
import { runPostConnectImport } from '../../services/analyticsPostConnectImport';
import { runManualSyncJob, type ManualSyncJobData, type ManualSyncResult } from '../../services/analyticsManualSync';
import { runOAuthLifecycleSweep } from '../../services/integrations/oauthLifecycleScheduler';

export type AnalyticsIngestionJobData =
  | { type: 'daily-growth' }
  | { type: 'post-polls'; batchSize?: number }
  | { type: 'ga4-all-companies'; startDate?: string; endDate?: string }
  | { type: 'gsc-all-companies' }
  | { type: 'analytics-post-connect-import'; companyId: string; source: 'ga4' | 'gsc' }
  | ManualSyncJobData
  | { type: 'oauth-refresh' };

export async function processAnalyticsIngestionJob(job: Job<AnalyticsIngestionJobData>): Promise<void | ManualSyncResult> {
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

    const summary = await runScheduledAnalyticsSync('ga4', { startDate, endDate });
    console.log(
      `[analyticsIngestionProcessor][ga4-all-companies] attempted=${summary.attempted} imported=${summary.succeeded} skipped=${summary.skipped} failed=${summary.failed} window=${startDate}..${endDate}`,
    );
    return;
  }

  if (type === 'gsc-all-companies') {
    const summary = await runScheduledAnalyticsSync('gsc');
    console.log(
      `[analyticsIngestionProcessor][gsc-all-companies] attempted=${summary.attempted} imported=${summary.succeeded} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return;
  }

  if (type === 'analytics-post-connect-import') {
    // Queued by the OAuth callback / property selection (analyticsIntegrationServiceSync) so the import
    // runs on the worker, not as fire-and-forget work a serverless function may cut short.
    const { companyId, source } = job.data;
    if (typeof companyId !== 'string' || !companyId || (source !== 'ga4' && source !== 'gsc')) {
      console.warn('[analyticsIngestionProcessor][analytics-post-connect-import] invalid job data');
      return;
    }
    await runPostConnectImport(companyId, source);
    return;
  }

  if (type === 'analytics-manual-sync') {
    // "Sync now" from the integrations page. Throws on failure so BullMQ retries; the returned result
    // is what GET /api/analytics/force-sync reports once the job completes.
    const data = job.data as ManualSyncJobData;
    if (typeof data.companyId !== 'string' || !data.companyId || (data.source !== 'ga4' && data.source !== 'gsc') || !data.startDate || !data.endDate) {
      console.warn('[analyticsIngestionProcessor][analytics-manual-sync] invalid job data');
      return;
    }
    return runManualSyncJob(data);
  }

  if (type === 'oauth-refresh') {
    const summary = await runOAuthLifecycleSweep();
    console.log(
      `[analyticsIngestionProcessor][oauth-refresh] social.refreshed=${summary.social.refreshed} social.errors=${summary.social.errors} ga4.refreshed=${summary.ga4.refreshed} ga4.failed=${summary.ga4.failed} meta.checked=${summary.meta.connectionsChecked} states.written=${summary.states.written} states.failed=${summary.states.failed} duration=${summary.durationMs}ms`,
    );
    return;
  }

  console.warn('[analyticsIngestionProcessor] Unknown job type:', (job.data as any).type);
}
