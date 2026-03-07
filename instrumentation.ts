/**
 * Next.js Instrumentation Hook
 *
 * Runs when the server starts. Auto-starts workers and cron scheduler so the
 * intelligence pipeline runs without manual npm run start:workers / start:cron.
 *
 * Set DISABLE_AUTO_WORKERS=1 to skip (e.g. when using separate worker/cron processes).
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  if (process.env.DISABLE_AUTO_WORKERS === '1' || process.env.DISABLE_AUTO_WORKERS === 'true') {
    return;
  }

  const { startWorkers } = await import('./backend/queue/startWorkers');
  const { startCron } = await import('./backend/scheduler/cron');

  await startWorkers();
  // Start cron in background so server becomes ready quickly
  startCron().catch((err) => console.error('[startup] cron failed:', err));
}
