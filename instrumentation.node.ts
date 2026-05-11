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

// ── TEMP DIAGNOSTIC: worker-bootstrap audit ──
import * as _diag_fs2 from 'fs';
import * as _diag_path2 from 'path';
function _diag(stage: string, extra?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n';
    _diag_fs2.appendFileSync(_diag_path2.join(process.cwd(), '.worker-bootstrap.log'), line);
  } catch { /* never throw from diagnostics */ }
}
_diag('instrumentation.node.ts:module-loaded', {
  pid: process.pid,
  NODE_ENV: process.env.NODE_ENV ?? 'unset',
  NEXT_RUNTIME: process.env.NEXT_RUNTIME ?? 'unset',
  ENABLE_AUTO_WORKERS: process.env.ENABLE_AUTO_WORKERS ?? 'unset',
  REDIS_URL_present: !!process.env.REDIS_URL,
  VERIFICATION_SECRET_present: !!process.env.VERIFICATION_SECRET,
});

export async function register() {
  _diag('instrumentation.node.ts:register-entered');
  // ── Fail-fast: VERIFICATION_SECRET must be set before serving requests ──
  // Domain-ownership tokens are HMAC'd with this secret. If it's missing the
  // first INSERT or verify call would 500 mid-request — louder to crash now.
  try {
    const { getVerificationSecret } = await import('./backend/services/verificationSecret');
    getVerificationSecret();
    _diag('instrumentation.node.ts:verification-secret-ok');
  } catch (err) {
    _diag('instrumentation.node.ts:verification-secret-MISSING', { error: err instanceof Error ? err.message : String(err) });
    console.error('VERIFICATION_SECRET_MISSING', {
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
  _diag('instrumentation.node.ts:worker-gate', {
    enableWorkers,
    raw_ENABLE_AUTO_WORKERS: process.env.ENABLE_AUTO_WORKERS ?? 'unset',
  });
  if (!enableWorkers) {
    _diag('instrumentation.node.ts:worker-gate-CLOSED-early-return');
    return;
  }

  try {
    _diag('instrumentation.node.ts:importing-startWorkers');
    const { startWorkers } = await import('./backend/queue/startWorkers');
    _diag('instrumentation.node.ts:imported-startWorkers');
    const { startCron } = await import('./backend/scheduler/cron');
    _diag('instrumentation.node.ts:imported-startCron');

    _diag('instrumentation.node.ts:awaiting-startWorkers');
    await startWorkers();
    _diag('instrumentation.node.ts:startWorkers-resolved');
    startCron().catch((err) => {
      _diag('instrumentation.node.ts:startCron-rejected', { error: err instanceof Error ? err.message : String(err) });
      console.error('[startup] cron failed:', err);
    });
    _diag('instrumentation.node.ts:startCron-dispatched');
  } catch (err) {
    _diag('instrumentation.node.ts:startup-block-THREW', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
    });
    console.error('[startup] workers failed to start:', (err as Error)?.message ?? err);
  }
  _diag('instrumentation.node.ts:register-exited');
}
