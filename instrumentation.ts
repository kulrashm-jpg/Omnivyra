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
