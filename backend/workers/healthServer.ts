/**
 * Minimal HTTP health server for Railway health checks.
 * Railway pings GET /health to determine if the container is alive.
 * Must respond within the healthcheckTimeout (30s) or Railway restarts the pod.
 */

import http from 'http';

let _startedAt = Date.now();

export function startHealthServer(port = 8080): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.floor((Date.now() - _startedAt) / 1000),
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
