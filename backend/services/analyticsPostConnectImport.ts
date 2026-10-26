/**
 * First import after a company connects Google Analytics (GA4) or Search Console (GSC), or selects a
 * property. Previously a fire-and-forget promise inside the OAuth callback / selection request: on
 * Vercel the function can be frozen once the response is sent, cutting the import short with no record.
 *
 * Now: queued as `analytics-post-connect-import` on the existing `analytics-ingestion` queue and run by
 * the worker (analyticsIngestionProcessor). The job id is per company + source + minute, so a double
 * click or a callback retry collapses into one job. Only if the queue cannot be reached does it fall
 * back to the previous in-process run (logged), so a Redis outage never drops the first import.
 *
 * Isolation: the company id comes from the verified OAuth state / the caller's authorised company, and
 * the import uses only that company's integration, property and token.
 */
export type PostConnectSource = 'ga4' | 'gsc';

/** The import itself (worker side, or the fallback). Never throws; logs the outcome. */
export async function runPostConnectImport(companyId: string, source: PostConnectSource): Promise<void> {
  const tag = source === 'ga4' ? '[GA-OAUTH]' : '[GSC-OAUTH]';
  try {
    if (source === 'gsc') {
      const { resolveOmnivyraWebsiteCompany } = await import('./omnivyraWebsiteCompanyService');
      const omnivyraCompany = await resolveOmnivyraWebsiteCompany().catch(() => null);
      if (omnivyraCompany?.id === companyId) {
        const { runOmnivyraGscIngestion } = await import('./omnivyraGscAnalyticsService');
        const result = await runOmnivyraGscIngestion({ forceBackfill: true });
        console.log('[GSC-OAUTH][initial-platform-ingestion] completed', {
          company_id: companyId,
          property_url: result.property_url,
          status: result.status,
          rows_ingested: result.rows_ingested,
          retries: result.retries,
        });
        return;
      }
    }

    const { runIngestionForCompany } = await import('./ingestionScheduler');
    const summary = source === 'ga4'
      ? await runIngestionForCompany({ companyId, sources: ['ga4'] })
      : await runIngestionForCompany({
        companyId,
        sources: ['gsc'],
        overrides: { gsc: (await import('./gscIngestionService')).buildGscHistoricalBackfillOverride() },
        force: true,
        reason: 'initial_gsc_90_day_backfill',
      });
    console.log(`${tag}[initial-ingestion] completed`, {
      company_id: companyId,
      sources: summary.sources.map((s) => ({ source: s.source, success: s.success, skipped: s.skipped ?? false, error: s.error ? s.error.slice(0, 200) : null })),
      ready: summary.ready,
    });
  } catch (err) {
    console.error(`${tag}[INITIAL_${source === 'ga4' ? 'GA' : 'GSC'}_INGESTION_FAILED]`, {
      company_id: companyId,
      message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
  }
}

export type EnqueueDeps = {
  enqueue?: (data: { type: 'analytics-post-connect-import'; companyId: string; source: PostConnectSource }, jobId: string) => Promise<{ id?: string | null } | null>;
  runInline?: (companyId: string, source: PostConnectSource) => Promise<void>;
  now?: () => number;
};

async function defaultEnqueue(data: { type: 'analytics-post-connect-import'; companyId: string; source: PostConnectSource }, jobId: string) {
  const [{ getContentQueue }, { safeEnqueue }] = await Promise.all([
    import('../queue/contentGenerationQueues'),
    import('../middleware/queueBackpressure'),
  ]);
  return safeEnqueue(getContentQueue('analytics-ingestion'), 'analytics-ingestion', 'analytics-post-connect-import', data, {
    jobId,
    priority: 1,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Queue the first import. Returns how it was dispatched. Never throws: the OAuth callback must not fail
 * because of an import problem.
 */
export async function schedulePostConnectImport(companyId: string, source: PostConnectSource, deps: EnqueueDeps = {}): Promise<'queued' | 'inline'> {
  const minute = Math.floor((deps.now ?? Date.now)() / 60_000);
  const jobId = `post-connect-${source}-${companyId}-${minute}`;
  try {
    const job = await (deps.enqueue ?? defaultEnqueue)({ type: 'analytics-post-connect-import', companyId, source }, jobId);
    if (job) return 'queued';
    console.warn('[analytics-post-connect-import] queue refused the job; importing in-process', { company_id: companyId, source });
  } catch (err) {
    console.warn('[analytics-post-connect-import] queue unavailable; importing in-process', {
      company_id: companyId,
      source,
      message: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
    });
  }
  void (deps.runInline ?? runPostConnectImport)(companyId, source);
  return 'inline';
}
