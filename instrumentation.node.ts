/**
 * Next.js Instrumentation Hook — Node.js runtime only
 *
 * Next.js 14.1+ loads `instrumentation.node.ts` exclusively in the Node.js
 * runtime. The Edge runtime never sees this file, so it is safe to import
 * Redis, IORedis, workers, cron, and any other Node-only modules here.
 *
 * Runs when the server starts. Auto-starts workers when enabled.
 *
 * Workers are DISABLED by default so the app (home page, etc.) loads reliably.
 * Set ENABLE_AUTO_WORKERS=1 to auto-start workers (requires Redis).
 *
 * Cron execution is handled by Vercel cron routes.
 */

export async function register() {
  // ── Fail-fast: VERIFICATION_SECRET must be set before serving requests ──
  // Domain-ownership tokens are HMAC'd with this secret. If it's missing the
  // first INSERT or verify call would 500 mid-request — louder to crash now.
  try {
    const { assertMockPlatformsAllowed } = await import('./backend/services/mockGuard');
    assertMockPlatformsAllowed('startup');
    const { getVerificationSecret } = await import('./backend/services/verificationSecret');
    getVerificationSecret();
    const { assertExecutionEngineSchemaReady } = await import('./backend/jobs/startupSchemaCheck');
    await assertExecutionEngineSchemaReady();
    const { assertExecutionObservabilityReady } = await import('./backend/jobs/observabilityCheck');
    assertExecutionObservabilityReady();
  } catch (err) {
    console.error('STARTUP_INVARIANT_FAILED', {
      message: (err as Error)?.message ?? String(err),
    });
    // Hard exit — Next.js' supervisor will restart and surface the failure.
    process.exit(1);
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
    const { REDIS_URL } = await import('./backend/config/env');
    const redisUrl  = REDIS_URL;
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
    await startWorkers();
  } catch (err) {
    console.error('[startup] workers failed to start:', (err as Error)?.message ?? err);
  }
}
