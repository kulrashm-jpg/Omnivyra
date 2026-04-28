/**
 * Next.js Instrumentation Hook — Node.js runtime only
 *
 * Next.js 14.1+ loads `instrumentation.node.ts` exclusively in the Node.js
 * runtime. The Edge runtime never sees this file, so it is safe to import
 * Redis, IORedis, workers, cron, and any other Node-only modules here.
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
  // Validate email transport env at boot. Throws if any SES_SMTP_* /
  // EMAIL_FROM var is missing so production deploys fail fast instead of
  // silently no-op'ing send paths until the first user-triggered email.
  // Idempotent — emailService.sendEmailSMTP also calls it per-send as a
  // belt-and-suspenders guard.
  try {
    const { validateEmailEnv } = await import('./backend/config/validateEnv');
    validateEmailEnv();
  } catch (err) {
    // Fail loud in production, warn in dev so local work doesn't require
    // SES credentials just to render pages that don't send mail.
    const message = (err as Error)?.message ?? String(err);
    if (process.env.NODE_ENV === 'production') {
      console.error('[startup] email env validation FAILED:', message);
      throw err;
    }
    console.warn('[startup] email env validation (non-prod):', message);
  }

  const monitoringFlag = process.env.ENABLE_REDIS_USAGE_MONITORING;
  const isProduction =
    process.env.OMNIVYRA_ENV === 'production' ||
    process.env.DRISHIQ_ENV === 'production' ||
    process.env.NODE_ENV === 'production';

  const redisMonitoringEnabled =
    monitoringFlag === '1' ||
    monitoringFlag === 'true' ||
    (monitoringFlag === undefined && isProduction);

  // ── Optional: start Redis usage-protection polling ─────────────────────────
  // Defaults ON in production and OFF in non-production, unless overridden with
  // ENABLE_REDIS_USAGE_MONITORING=1|true or =0|false.
  // This can run regardless of ENABLE_AUTO_WORKERS when enabled.
  // A minimal IORedis client is created here (separate from the BullMQ client)
  // so bullmqClient.ts is NOT imported (which would start workers).
  if (redisMonitoringEnabled) {
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
    // because instrumentation must not block Next.js startup.
    } catch (err) {
      // Non-fatal — monitoring is best-effort
      console.warn('[startup] Redis usage monitoring failed to start:', (err as Error)?.message);
    }
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
