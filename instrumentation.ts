/**
 * Next.js Instrumentation Hook
 *
 * Runs when the server starts. Auto-starts workers and cron scheduler so the
 * intelligence pipeline runs without manual npm run start:workers / start:cron.
 *
 * Workers are DISABLED by default so the app (home page, etc.) loads reliably.
 * Set ENABLE_AUTO_WORKERS=1 to auto-start workers (requires Redis).
 *
 * Or run workers separately: npm run start:workers & npm run start:cron
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // ── Always: start Redis usage-protection polling ──────────────────────────
  // This runs regardless of ENABLE_AUTO_WORKERS so the daily command limit is
  // tracked and enforced even when workers are disabled.
  // A minimal IORedis client is created here (separate from the BullMQ client)
  // so bullmqClient.ts is NOT imported (which would start workers).
  try {
    const IORedis   = (await import('ioredis')).default;
    const { startUsageProtection } = await import('./lib/redis/usageProtection');
    const redisUrl  = process.env.REDIS_URL || 'redis://localhost:6379';
    let _monClient: InstanceType<typeof IORedis> | null = null;
    function getMonClient() {
      if (!_monClient) {
        _monClient = new IORedis(redisUrl, {
          enableReadyCheck:     false,
          maxRetriesPerRequest: 1,
          connectTimeout:       2_000,
          commandTimeout:       1_000,
          lazyConnect:          true,
          retryStrategy:        () => null,
        });
        _monClient.on('error', () => {});
        _monClient.connect().catch(() => {});
      }
      return _monClient;
    }
    startUsageProtection(getMonClient);
    // Do NOT await — monitoring is background. The promise is fire-and-forget here
    // because instrumentation.ts must not block Next.js startup. Workers that need
    // to wait for the first poll will await it via bullmqClient.ts on their own startup.
  } catch (err) {
    // Non-fatal — monitoring is best-effort
    console.warn('[startup] Redis usage monitoring failed to start:', (err as Error)?.message);
  }

  // Default: skip workers so Next.js app loads without BullMQ/Redis. Set ENABLE_AUTO_WORKERS=1 to enable.
  const enableWorkers =
    process.env.ENABLE_AUTO_WORKERS === '1' || process.env.ENABLE_AUTO_WORKERS === 'true';
  if (!enableWorkers) {
    return;
  }

  try {
    const { startWorkers } = await import('./backend/queue/startWorkers');
    const { startCron } = await import('./backend/scheduler/cron');

    await startWorkers();
    startCron().catch((err) => console.error('[startup] cron failed:', err));
  } catch (err) {
    console.error('[startup] workers failed to start:', (err as Error)?.message ?? err);
  }
}
