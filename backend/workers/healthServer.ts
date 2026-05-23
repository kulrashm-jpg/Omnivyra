/**
 * Minimal HTTP health server for Railway health checks.
 * Railway pings GET /health to determine if the container is alive.
 * Must respond within the healthcheckTimeout (30s) or Railway restarts the pod.
 */

import http from 'http';

let _startedAt = Date.now();

// Cron status reporter. Workers continue running even if cron init
// fails (the comment in main.ts:272 explicitly documents this as a
// non-fatal failure mode). But the failure was previously SILENT —
// token-refresh stops, posts fail 2 hours later, operator has no
// signal. Exposing the degraded state in the health response gives
// operators an immediate signal without crash-looping the pod.
type CronStatus = 'ok' | 'degraded' | 'initializing';
let _cronStatus: CronStatus = 'initializing';
let _cronDegradedReason: string | null = null;

/**
 * Worker-side setter for cron health. Called by main.ts from the
 * startCron() failure handler. Idempotent — successive calls overwrite.
 */
export function setCronStatus(status: CronStatus, reason?: string | null): void {
  _cronStatus = status;
  _cronDegradedReason = reason ?? null;
}

export function startHealthServer(port = 8080): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      // HTTP status remains 200 even when cron is degraded — Railway's
      // healthcheck only restarts on 5xx, and a crash-loop here would
      // hurt more than the degraded scheduler. Operators read the
      // cron_status field; alerts can be configured on it directly.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.floor((Date.now() - _startedAt) / 1000),
        cron_status: _cronStatus,
        cron_degraded_reason: _cronDegradedReason,
        ts:     Date.now(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.info(`[health] server listening on :${port}`);
  });

  server.on('error', (err) => {
    console.error('[health] server error:', err);
  });

  return server;
}
