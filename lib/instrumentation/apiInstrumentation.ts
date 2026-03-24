/**
 * API layer instrumentation — tracks request counts, latency, and errors
 * for Next.js API routes (Vercel) and Express-style handlers (Railway).
 *
 * Usage — wrap any Next.js API handler:
 *
 *   export default withApiTracking('my-endpoint', handler);
 *
 * Or record manually from inside a handler:
 *
 *   recordApiCall('/api/campaigns/list', latencyMs, res.statusCode);
 */

import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';

// ── State ─────────────────────────────────────────────────────────────────────

interface EndpointStats {
  calls:    number;
  errors4xx: number;
  errors5xx: number;
  latencies: number[];  // rolling 100 samples
}

const endpointMap = new Map<string, EndpointStats>();
const requestTimeline: number[] = [];  // rolling 60s timestamps
const OPS_WINDOW = 60_000;
let totalCalls  = 0;
let total4xx    = 0;
let total5xx    = 0;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiMetrics {
  totalCalls:     number;
  callsPerMin:    number;
  errors4xx:      number;
  errors5xx:      number;
  errorRate:      number;             // 0–1
  avgLatencyMs:   number | null;
  p95LatencyMs:   number | null;
  topEndpoints:   Array<{ endpoint: string; calls: number; avgLatencyMs: number | null }>;
}

// ── Recording ─────────────────────────────────────────────────────────────────

export function recordApiCall(endpoint: string, latencyMs: number, statusCode: number): void {
  totalCalls++;

  const now = Date.now();
  requestTimeline.push(now);
  let i = 0;
  while (i < requestTimeline.length && requestTimeline[i] < now - OPS_WINDOW) i++;
  if (i > 0) requestTimeline.splice(0, i);

  if (statusCode >= 500)       total5xx++;
  else if (statusCode >= 400)  total4xx++;

  let stats = endpointMap.get(endpoint);
  if (!stats) {
    stats = { calls: 0, errors4xx: 0, errors5xx: 0, latencies: [] };
    endpointMap.set(endpoint, stats);
  }
  stats.calls++;
  if (statusCode >= 500) stats.errors5xx++;
  else if (statusCode >= 400) stats.errors4xx++;
  stats.latencies.push(latencyMs);
  if (stats.latencies.length > 100) stats.latencies.shift();
}

// ── Next.js handler wrapper ───────────────────────────────────────────────────

export function withApiTracking(
  endpoint: string,
  handler: NextApiHandler,
): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = Date.now();

    // Capture status code by intercepting res.end
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let capturedStatus = 200;

    const capture = (fn: (...a: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        capturedStatus = res.statusCode || 200;
        recordApiCall(endpoint, Date.now() - start, capturedStatus);
        return fn(...args);
      };

    res.json = capture(originalJson) as typeof res.json;
    res.send = capture(originalSend) as typeof res.send;

    try {
      await handler(req, res);
    } catch (err) {
      recordApiCall(endpoint, Date.now() - start, 500);
      throw err;
    }
  };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

export function getApiMetrics(): ApiMetrics {
  // Collect all latency samples for global stats
  const allLatencies: number[] = [];
  for (const stats of endpointMap.values()) {
    allLatencies.push(...stats.latencies);
  }
  allLatencies.sort((a, b) => a - b);

  const avgLatencyMs = allLatencies.length === 0 ? null
    : Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);

  const topEndpoints = [...endpointMap.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 10)
    .map(([endpoint, s]) => ({
      endpoint,
      calls: s.calls,
      avgLatencyMs: s.latencies.length === 0 ? null
        : Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length),
    }));

  return {
    totalCalls,
    callsPerMin:  requestTimeline.filter(t => t >= Date.now() - OPS_WINDOW).length,
    errors4xx:    total4xx,
    errors5xx:    total5xx,
    errorRate:    totalCalls === 0 ? 0 : (total4xx + total5xx) / totalCalls,
    avgLatencyMs,
    p95LatencyMs: percentile(allLatencies, 0.95),
    topEndpoints,
  };
}

export function resetApiMetrics(): void {
  endpointMap.clear();
  requestTimeline.length = 0;
  totalCalls = 0; total4xx = 0; total5xx = 0;
}
