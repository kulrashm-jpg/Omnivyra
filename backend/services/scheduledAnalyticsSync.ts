/**
 * Scheduled Google Analytics (GA4) and Search Console (GSC) sync — the one entry point both existing
 * schedulers call: the worker's in-process cron tick (backend/scheduler/cron.ts) and the daily
 * Vercel-cron → `analytics-ingestion` queue job (backend/queue/jobProcessors/analyticsIngestionProcessor.ts).
 * No new scheduler.
 *
 * Windows (dated, so each run has its own idempotency key in ingestion_runs):
 *   GA4  last GA4_WINDOW_DAYS days through today.
 *   GSC  Search Console data lags ~3 days. The window ends GSC_DELAY_DAYS ago and starts at the
 *        company's own watermark (the end date of its last completed GSC run) minus a revision
 *        lookback — so a missed day or a failed run is caught up by the next one — never earlier
 *        than GSC_MAX_BACKFILL_DAYS (bounded backfill). A company that never synced gets the full
 *        bounded backfill.
 * Minimum interval: a company whose last completed run of that source is newer than the source's
 * minimum interval is skipped ("recently_synced"), so the two schedulers firing on the same day do one
 * import, not two.
 *
 * The platform's own website company keeps its dedicated pipeline (omnivyraGscAnalyticsService,
 * own tables and watermark): the scheduled GSC pass routes it there instead of the tenant pipeline,
 * exactly as the post-connect import does.
 *
 * Tenant isolation: every run is per company, with that company's own integration, property and
 * token (resolved inside runIngestionForCompany); one company's failure is recorded for it alone.
 */
import { runIngestionForAllCompanies, type MultiCompanyIngestionSummary } from './ingestionScheduler';
import { getLatestCompletedRun } from './ingestionRunService';

export const GA4_WINDOW_DAYS = 7;
export const GA4_MIN_INTERVAL_HOURS = 5;
export const GSC_DELAY_DAYS = 3;
export const GSC_LOOKBACK_DAYS = 7;
export const GSC_MAX_BACKFILL_DAYS = 90;
export const GSC_MIN_INTERVAL_HOURS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

export type LastRun = { completedAt: string | null; window: { startDate?: string; endDate?: string } | null } | null;

/** GA4: the last GA4_WINDOW_DAYS days through today (UTC). Pure. */
export function planGa4Window(now: Date): { startDate: string; endDate: string } {
  return { startDate: isoDay(now.getTime() - GA4_WINDOW_DAYS * DAY_MS), endDate: isoDay(now.getTime()) };
}

/** GSC: from the watermark (minus the revision lookback) to the reporting delay, bounded. Pure. */
export function planGscWindow(now: Date, lastRun: LastRun): { startDate: string; endDate: string; mode: 'backfill' | 'incremental' } {
  const endDate = isoDay(now.getTime() - GSC_DELAY_DAYS * DAY_MS);
  const floor = dayMs(endDate) - (GSC_MAX_BACKFILL_DAYS - 1) * DAY_MS;
  const watermark = lastRun?.window?.endDate
    ?? (lastRun?.completedAt ? isoDay(Date.parse(lastRun.completedAt) - GSC_DELAY_DAYS * DAY_MS) : null);
  if (!watermark || !Number.isFinite(dayMs(watermark))) return { startDate: isoDay(floor), endDate, mode: 'backfill' };
  const fromWatermark = dayMs(watermark) - (GSC_LOOKBACK_DAYS - 1) * DAY_MS;
  const fromLookback = dayMs(endDate) - (GSC_LOOKBACK_DAYS - 1) * DAY_MS;
  return { startDate: isoDay(Math.max(floor, Math.min(fromWatermark, fromLookback))), endDate, mode: 'incremental' };
}

/** Skip when the last completed run is newer than the minimum interval. Pure. */
export function syncedRecently(now: Date, lastRun: LastRun, minIntervalHours: number): boolean {
  const at = lastRun?.completedAt ? Date.parse(lastRun.completedAt) : NaN;
  return Number.isFinite(at) && now.getTime() - at < minIntervalHours * 60 * 60 * 1000;
}

async function lastCompletedRun(companyId: string, source: 'ga4' | 'gsc'): Promise<LastRun> {
  const run = await getLatestCompletedRun(companyId, source);
  if (!run) return null;
  const record = run as unknown as { completed_at?: string | null; cursor_payload?: { window?: { startDate?: string; endDate?: string } } | null };
  return { completedAt: record.completed_at ?? null, window: record.cursor_payload?.window ?? null };
}

export type ScheduledSyncDeps = {
  now?: () => Date;
  runAll?: typeof runIngestionForAllCompanies;
  lastRun?: (companyId: string, source: 'ga4' | 'gsc') => Promise<LastRun>;
  platformCompanyId?: () => Promise<string | null>;
  runPlatformGsc?: () => Promise<unknown>;
};

export async function runScheduledAnalyticsSync(
  source: 'ga4' | 'gsc',
  options: { startDate?: string; endDate?: string } = {},
  deps: ScheduledSyncDeps = {},
): Promise<MultiCompanyIngestionSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const runAll = deps.runAll ?? runIngestionForAllCompanies;
  const lastRun = deps.lastRun ?? lastCompletedRun;

  if (source === 'ga4') {
    // An explicit window (the queued daily job carries one) is honoured; otherwise the standard one.
    const window = options.startDate && options.endDate ? { startDate: options.startDate, endDate: options.endDate } : planGa4Window(now);
    return runAll({
      sources: ['ga4'],
      planFor: async (companyId) => (syncedRecently(now, await lastRun(companyId, 'ga4'), GA4_MIN_INTERVAL_HOURS)
        ? { skip: 'recently_synced' }
        : { overrides: { ga4: window } }),
    });
  }

  const platformId = deps.platformCompanyId
    ? await deps.platformCompanyId()
    : await import('./omnivyraWebsiteCompanyService').then((m) => m.resolveOmnivyraWebsiteCompany()).then((c) => c?.id ?? null).catch(() => null);
  let platformRan = false;
  const summary = await runAll({
    sources: ['gsc'],
    planFor: async (companyId) => {
      if (platformId && companyId === platformId) {
        platformRan = true;
        return { skip: 'platform_pipeline' };
      }
      const previous = await lastRun(companyId, 'gsc');
      if (syncedRecently(now, previous, GSC_MIN_INTERVAL_HOURS)) return { skip: 'recently_synced' };
      const { startDate, endDate } = planGscWindow(now, previous);
      return { overrides: { gsc: { startDate, endDate } } };
    },
  });
  if (platformRan) {
    try {
      const runPlatform = deps.runPlatformGsc
        ?? (async () => (await import('./omnivyraGscAnalyticsService')).runOmnivyraGscIngestion());
      await runPlatform();
    } catch (error) {
      console.error('[scheduled-gsc][platform-ingestion-failed]', { message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) });
    }
  }
  return summary;
}
