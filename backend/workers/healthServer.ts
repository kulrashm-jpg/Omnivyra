/**
 * Minimal HTTP health server for Railway health checks.
 * Railway pings GET /health to determine if the container is alive.
 * Must respond within the healthcheckTimeout (30s) or Railway restarts the pod.
 */

import http from 'http';
import { renderPrometheusText, PROMETHEUS_CONTENT_TYPE } from '../observability';

let _startedAt = Date.now();

/**
 * Same token contract as pages/api/observability/metrics.ts — a Bearer token
 * or `x-metrics-secret` header, checked against OBSERVABILITY_EXPORT_TOKEN.
 * Reused verbatim so the worker scrape target authenticates identically to
 * the API target; no separate auth scheme.
 */
function presentedMetricsToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const secret = req.headers['x-metrics-secret'];
  if (typeof secret === 'string' && secret.trim()) return secret.trim();
  return undefined;
}

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
    const path = (req.url || '').split('?')[0];

    // Prometheus scrape target (F-02, worker side) — the SAME exporter, registry,
    // token, header convention, and output format as the API endpoint
    // (pages/api/observability/metrics.ts). This exposes the worker process's
    // in-process HARDEN-001 registry; it does not create a second registry.
    // Dark by default: 404 when OBSERVABILITY_EXPORT_TOKEN is unset — identical
    // to the API and indistinguishable from a missing route.
    if (path === '/metrics') {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
      const expected = process.env.OBSERVABILITY_EXPORT_TOKEN;
      if (!expected) { res.writeHead(404); res.end(); return; }
      if (presentedMetricsToken(req) !== expected) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const body = renderPrometheusText();
        res.writeHead(200, { 'Content-Type': PROMETHEUS_CONTENT_TYPE, 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (err) {
        // The exporter is fail-safe by contract; guard anyway so a scrape can
        // never take the worker down.
        res.writeHead(500);
        res.end();
      }
      return;
    }

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
