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
  // ── Fail-fast: VERIFICATION_SECRET must be set before serving requests ──
  // Domain-ownership tokens are HMAC'd with this secret. If it's missing the
  // first INSERT or verify call would 500 mid-request — louder to crash now.
  try {
    const { getVerificationSecret } = await import('./backend/services/verificationSecret');
    getVerificationSecret();
  } catch (err) {
    console.error('VERIFICATION_SECRET_MISSING', {
      message: (err as Error)?.message ?? String(err),
    });
    // Hard exit — Next.js' supervisor will restart and surface the failure.
    process.exit(1);
  }

  // ── Phase 17: thread-runtime persistence boot wiring ──
  // Idempotent inside the helper. Memory mode is default + no-op.
  // Supabase mode runs a connectivity smoke test and HARD-FAILS (process.exit)
  // if registration / smoke test fails — per Phase 17 spec, no silent downgrade.
  try {
    const { bootstrapThreadRuntimeExecutionStore } = await import(
      './backend/services/orchestration/persistence/bootstrapExecutionStore'
    );
    await bootstrapThreadRuntimeExecutionStore({ processKind: 'nextjs_server' });
  } catch (err) {
    // Memory mode never throws. Supabase mode invokes the configured fatal
    // handler (process.exit) and never returns. Anything reaching this catch
    // is an unexpected runtime error worth surfacing without crashing memory boot.
    console.error('[thread-runtime.persistence] unexpected register error:', (err as Error)?.message ?? err);
  }

  // ── Phase 22A: distributed runtime wiring ──
  // Env-gated via ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1 inside
  // maybeStartDistributedRuntime. Default: skipped, so this is a no-op
  // unless operators opted in. The activation governor runs FIRST and
  // hard-fails when any precondition is unmet (no silent downgrade).
  try {
    const { wireDistributedRuntime } = await import(
      './backend/services/orchestration/distributed/bootWireDistributedRuntime'
    );
    await wireDistributedRuntime({ processKind: 'nextjs_server' });
  } catch (err) {
    if (err instanceof Error && err.name === 'DistributedRuntimeActivationError') {
      // Activation governor refused — surface for the supervisor.
      throw err;
    }
    console.error('[distributed-runtime] wire error:', (err as Error)?.message ?? err);
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
  if (!enableWorkers) return;

  try {
    const { startWorkers } = await import('./backend/queue/startWorkers');
    const { startCron } = await import('./backend/scheduler/cron');

    await startWorkers();
    startCron().catch((err) => {
      console.error('[startup] cron failed:', err);
    });
  } catch (err) {
    console.error('[startup] workers failed to start:', (err as Error)?.message ?? err);
  }
}
