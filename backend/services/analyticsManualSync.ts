/**
 * Manual "Sync now" for Google Analytics (GA4) and Search Console (GSC), queued on the existing
 * `analytics-ingestion` queue and run by the worker — never as unawaited work inside a Vercel request.
 *
 *   Request   POST /api/analytics/force-sync → enqueueManualSync → 202 { status: queued|running|... }
 *   Worker    analytics-manual-sync → runManualSyncJob → runIngestionForCompany(force, dated window)
 *   Status    GET  /api/analytics/force-sync → getManualSyncStatus (the job's real state)
 *
 * Duplicates: the job id is (source, company, window). While that job is waiting, delayed or running,
 * another request returns it instead of adding a second one; a finished job is kept for an hour
 * (status reads), and a failed one is replaced when the user retries.
 * Retries: a run that does not succeed throws, so BullMQ retries it (3 attempts, exponential backoff).
 * Re-running a window is safe: imports upsert, and the run is per window in ingestion_runs.
 * Queue outage: the caller gets `queue_unavailable` (HTTP 503) — nothing runs in the request and
 * nothing is reported as synced.
 * Success is only ever reported from the finished job's own result; the last successful sync time
 * survives a failed run (data_source_status keeps last_synced_at).
 * Isolation: the company id comes from the authorised request; the job imports only that company's data.
 */
import { UnrecoverableError, type Queue } from 'bullmq';
import { planGa4Window, planGscWindow } from './scheduledAnalyticsSync';

export type ManualSource = 'ga4' | 'gsc';
export type ManualSyncWindow = { startDate: string; endDate: string };
export type ManualSyncState = 'queued' | 'running' | 'completed' | 'failed' | 'none' | 'queue_unavailable';

export type ManualSyncJobData = { type: 'analytics-manual-sync'; companyId: string; source: ManualSource; startDate: string; endDate: string };
export type ManualSyncResult = { success: boolean; skipped: boolean; reason: string | null; recordsWritten: number | null; error: string | null };

/** GSC: the bounded 90-day window (as on first connect); GA4: the last 7 days. Pure. */
export function manualSyncWindow(source: ManualSource, now: Date): ManualSyncWindow {
  if (source === 'gsc') {
    const { startDate, endDate } = planGscWindow(now, null);
    return { startDate, endDate };
  }
  return planGa4Window(now);
}

export function manualSyncJobId(companyId: string, source: ManualSource, window: ManualSyncWindow): string {
  return `manual-sync-${source}-${companyId}-${window.startDate}-${window.endDate}`;
}

const stateOf = (s: string): ManualSyncState =>
  s === 'active' ? 'running'
    : s === 'waiting' || s === 'delayed' || s === 'prioritized' || s === 'waiting-children' ? 'queued'
      : s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'none';

type QueueLike = Pick<Queue, 'getJob'> & Parameters<typeof import('../middleware/queueBackpressure').safeEnqueue>[0];
export type ManualSyncDeps = { now?: () => Date; getQueue?: () => Promise<QueueLike> };

async function defaultQueue(): Promise<QueueLike> {
  const { getContentQueue } = await import('../queue/contentGenerationQueues');
  return getContentQueue('analytics-ingestion');
}

export type ManualSyncTicket = {
  status: ManualSyncState;
  jobId: string;
  window: ManualSyncWindow;
  duplicate: boolean;
  result?: ManualSyncResult | null;
  error?: string | null;
};

export async function enqueueManualSync(companyId: string, source: ManualSource, deps: ManualSyncDeps = {}): Promise<ManualSyncTicket> {
  const window = manualSyncWindow(source, (deps.now ?? (() => new Date()))());
  const jobId = manualSyncJobId(companyId, source, window);
  try {
    const queue = await (deps.getQueue ?? defaultQueue)();
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = stateOf(await existing.getState());
      if (state === 'queued' || state === 'running') return { status: state, jobId, window, duplicate: true };
      if (state === 'completed') return { status: 'completed', jobId, window, duplicate: true, result: (existing.returnvalue as ManualSyncResult | undefined) ?? null };
      // A failed (or unknown) job is replaced so a retry actually runs.
      await existing.remove().catch(() => undefined);
    }
    const data: ManualSyncJobData = { type: 'analytics-manual-sync', companyId, source, startDate: window.startDate, endDate: window.endDate };
    // Through the shared backpressure gate (a full queue refuses rather than piling up work).
    const { safeEnqueue } = await import('../middleware/queueBackpressure');
    const added = await safeEnqueue(queue as Queue, 'analytics-ingestion', 'analytics-manual-sync', data, {
      jobId,
      priority: 1,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86_400 },
    });
    if (!added) return { status: 'queue_unavailable', jobId, window, duplicate: false, error: 'The sync queue is full; try again shortly.' };
    const queued = await queue.getJob(jobId);
    const state = queued ? stateOf(await queued.getState().catch(() => 'waiting')) : 'queued';
    return { status: state === 'none' ? 'queued' : state, jobId, window, duplicate: false };
  } catch (err) {
    return { status: 'queue_unavailable', jobId, window, duplicate: false, error: err instanceof Error ? err.message.slice(0, 160) : 'queue error' };
  }
}

/** The real state of today's manual sync job for this company and source. */
export async function getManualSyncStatus(companyId: string, source: ManualSource, deps: ManualSyncDeps = {}): Promise<ManualSyncTicket> {
  const window = manualSyncWindow(source, (deps.now ?? (() => new Date()))());
  const jobId = manualSyncJobId(companyId, source, window);
  try {
    const job = await (await (deps.getQueue ?? defaultQueue)()).getJob(jobId);
    if (!job) return { status: 'none', jobId, window, duplicate: false };
    const status = stateOf(await job.getState());
    return {
      status,
      jobId,
      window,
      duplicate: false,
      result: status === 'completed' ? ((job.returnvalue as ManualSyncResult | undefined) ?? null) : null,
      error: status === 'failed' ? String(job.failedReason ?? 'sync failed').slice(0, 200) : null,
    };
  } catch (err) {
    return { status: 'queue_unavailable', jobId, window, duplicate: false, error: err instanceof Error ? err.message.slice(0, 160) : 'queue error' };
  }
}

/**
 * Worker side. Throws when the run did not succeed, so BullMQ retries and the job ends `failed` with the
 * reason — never `completed` for a run that failed.
 */
export async function runManualSyncJob(
  data: ManualSyncJobData,
  deps: { runCompany?: typeof import('./ingestionScheduler').runIngestionForCompany } = {},
): Promise<ManualSyncResult> {
  const runCompany = deps.runCompany ?? (await import('./ingestionScheduler')).runIngestionForCompany;
  const window = { startDate: data.startDate, endDate: data.endDate };
  const summary = await runCompany({
    companyId: data.companyId,
    sources: [data.source],
    force: true,
    overrides: data.source === 'gsc' ? { gsc: window } : { ga4: window },
    reason: data.source === 'gsc' ? 'manual_gsc_force_sync' : 'manual_force_sync',
  });
  const r = summary.sources.find((s) => s.source === data.source);
  if (!r) throw new Error(`manual sync produced no ${data.source} result`);
  // Another run of this source is in progress for the company: not a failure, not a fresh sync.
  if (r.skipped && r.details?.reason === 'already_running') {
    return { success: true, skipped: true, reason: 'already_running', recordsWritten: null, error: null };
  }
  // Not connected / no property / no token: retrying cannot help — fail the job now.
  if (!r.success && r.missingIntegration) throw new UnrecoverableError((r.error ?? 'integration not ready').slice(0, 200));
  if (!r.success) throw new Error((r.error ?? 'sync failed').slice(0, 200));
  const written = Number(r.details?.metricsInserted ?? r.details?.sessionsInserted ?? r.details?.eventsInserted);
  return { success: true, skipped: false, reason: null, recordsWritten: Number.isFinite(written) ? written : null, error: null };
}
