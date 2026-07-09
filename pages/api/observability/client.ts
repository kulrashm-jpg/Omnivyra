/**
 * POST /api/observability/client
 *
 * HARDEN-001A — ingest browser performance beacons (page load, route change,
 * render, LCP/FCP, interaction latency, long tasks, JS heap) into the in-process
 * observability registry. Fed by lib/observability/clientPerf.ts via sendBeacon.
 *
 * Purely additive telemetry: it only records aggregated metrics and never mutates
 * business state. It is unauthenticated by design (beacons fire before/around auth
 * and on page-hide) but is hardened against abuse — bounded batch size, strict
 * value validation, server-side route normalization (collapses ids → :id so
 * cardinality stays bounded), and a fail-safe body that never throws. It is inert
 * unless the `client` observability domain is enabled.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { recordClient } from '../../../backend/observability';
import { normalizeRoute } from '../../../backend/observability/apiObservability';

const MAX_SAMPLES = 100; // ignore anything beyond this per beacon (bounded work)
const VALID_KINDS = new Set([
  'pageLoad', 'routeChange', 'render', 'lcp', 'fcp', 'interaction', 'longTask', 'heapUsed',
  'activation', // PERF-002: time-to-authenticated-interactive
]);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const samples = Array.isArray(body?.samples) ? body.samples.slice(0, MAX_SAMPLES) : [];
    for (const s of samples) {
      if (!s || typeof s !== 'object') continue;
      const kind = String((s as { kind?: unknown }).kind ?? '');
      const value = Number((s as { value?: unknown }).value);
      if (!VALID_KINDS.has(kind) || !Number.isFinite(value)) continue;
      const rawRoute = (s as { route?: unknown }).route;
      const route = normalizeRoute(typeof rawRoute === 'string' ? rawRoute : undefined);
      recordClient({ kind: kind as Parameters<typeof recordClient>[0]['kind'], value, route });
    }
  } catch {
    // Never surface ingestion errors to the browser — this is best-effort telemetry.
  }
  // Always 204: the client neither reads nor retries on the response.
  return res.status(204).end();
}
