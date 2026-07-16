/**
 * Worker /metrics endpoint (POP-OBS-001) — the worker health server now also
 * serves Prometheus metrics using the SAME exporter, token, and header
 * convention as pages/api/observability/metrics.ts. This verifies the auth
 * contract (dark 404 / 401 / 405 / 200) and that /health is unchanged.
 */
import http from 'http';
import { startHealthServer } from '../../workers/healthServer';

describe('worker /metrics endpoint', () => {
  let server: http.Server;
  let port: number;
  const OLD = process.env.OBSERVABILITY_EXPORT_TOKEN;

  beforeAll(async () => {
    process.env.OBSERVABILITY_EXPORT_TOKEN = 'test-token-xyz';
    server = startHealthServer(0); // ephemeral port
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    server.close();
    if (OLD === undefined) delete process.env.OBSERVABILITY_EXPORT_TOKEN;
    else process.env.OBSERVABILITY_EXPORT_TOKEN = OLD;
  });

  const call = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    fetch(`http://127.0.0.1:${port}${path}`, { method, headers });

  test('200 + prometheus content-type with a valid Bearer token', async () => {
    const r = await call('/metrics', { authorization: 'Bearer test-token-xyz' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toContain('text');
    expect(r.headers.get('cache-control')).toBe('no-store');
    await r.text(); // body renders without throwing
  });

  test('200 via the x-metrics-secret header (same as the API)', async () => {
    const r = await call('/metrics', { 'x-metrics-secret': 'test-token-xyz' });
    expect(r.status).toBe(200);
  });

  test('401 on a wrong token', async () => {
    const r = await call('/metrics', { authorization: 'Bearer nope' });
    expect(r.status).toBe(401);
  });

  test('405 on a non-GET method', async () => {
    const r = await call('/metrics', { authorization: 'Bearer test-token-xyz' }, 'POST');
    expect(r.status).toBe(405);
  });

  test('404 (dark) when OBSERVABILITY_EXPORT_TOKEN is unset — identical to the API', async () => {
    const saved = process.env.OBSERVABILITY_EXPORT_TOKEN;
    delete process.env.OBSERVABILITY_EXPORT_TOKEN;
    const r = await call('/metrics', { authorization: 'Bearer anything' });
    expect(r.status).toBe(404);
    process.env.OBSERVABILITY_EXPORT_TOKEN = saved;
  });

  test('/health is unchanged (still 200 with status ok)', async () => {
    const r = await call('/health');
    expect(r.status).toBe(200);
    const j = (await r.json()) as { status: string };
    expect(j.status).toBe('ok');
  });
});
