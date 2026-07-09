/**
 * HARDEN-001 — Observability snapshot.
 *
 * Aggregates the in-process registry into a compact, dashboard-friendly JSON
 * shape. Read-only; safe to call anytime. Future dashboards consume this via
 * the super-admin observability endpoint.
 */
import { registry } from './registry';
import { M, BOARD } from './metrics';
import { observabilityConfig } from './config';

function histBy(nameFilter: (name: string) => boolean) {
  return registry.histogramEntries().filter((h) => nameFilter(h.name));
}

function avgOf(name: string): { avg: number; p95: number; count: number } {
  const rows = registry.histogramEntries().filter((h) => h.name === name);
  const count = rows.reduce((s, r) => s + r.count, 0);
  const sum = rows.reduce((s, r) => s + r.sum, 0);
  const p95 = rows.length ? Math.max(...rows.map((r) => r.p95)) : 0;
  return { avg: count ? sum / count : 0, p95, count };
}

export interface ObservabilitySnapshot {
  generatedAt: string;
  uptimeMs: number;
  config: { enabled: boolean; dbSampleRate: number; slowApiMs: number; slowDbMs: number; slowAiMs: number };
  meta: { series: number; droppedSeries: number };
  averages: {
    apiLatencyMs: number; apiP95Ms: number; apiRequests: number;
    dbLatencyMs: number; dbP95Ms: number; dbQueries: number;
    aiLatencyMs: number; aiP95Ms: number; aiCalls: number;
    externalLatencyMs: number;
  };
  leaderboards: {
    slowEndpoints: Array<{ route: string; ms: number; labels: Record<string, unknown> }>;
    slowQueries: Array<{ query: string; ms: number; labels: Record<string, unknown> }>;
    expensiveJobs: Array<{ queue: string; ms: number }>;
    largestPayloads: Array<{ route: string; bytes: number }>;
    errorEndpoints: Array<{ route: string; labels: Record<string, unknown> }>;
    retryEndpoints: Array<{ route: string }>;
    slowAi: Array<{ providerModel: string; ms: number }>;
  };
  cache: { hits: number; misses: number; hitRatio: number; invalidations: number };
  system: { rssBytes: number; heapUsedBytes: number; cpuPercent: number; eventLoopLagMs: number };
  errors: { apiErrors: number; dbErrors: number; aiErrors: number; apiTimeouts: number };
  histograms: ReturnType<typeof registry.histogramEntries>;
  counters: ReturnType<typeof registry.counterEntries>;
}

function counterTotal(name: string): number {
  return registry.counterEntries().filter((c) => c.name === name).reduce((s, c) => s + c.value, 0);
}
function gaugeLast(name: string): number {
  const g = registry.gaugeEntries().find((x) => x.name === name);
  return g ? g.value : 0;
}

export function getObservabilitySnapshot(): ObservabilitySnapshot {
  const api = avgOf(M.api.duration);
  const db = avgOf(M.db.duration);
  const ai = avgOf(M.ai.duration);
  const ext = avgOf(M.ext.duration);
  const meta = registry.meta();
  const hits = counterTotal(M.cache.hit);
  const misses = counterTotal(M.cache.miss);

  return {
    generatedAt: new Date().toISOString(),
    uptimeMs: Date.now() - meta.startedAt,
    config: {
      enabled: observabilityConfig.enabled,
      dbSampleRate: observabilityConfig.dbSampleRate,
      slowApiMs: observabilityConfig.slowApiMs,
      slowDbMs: observabilityConfig.slowDbMs,
      slowAiMs: observabilityConfig.slowAiMs,
    },
    meta: { series: meta.series, droppedSeries: meta.droppedSeries },
    averages: {
      apiLatencyMs: round(api.avg), apiP95Ms: round(api.p95), apiRequests: counterTotal(M.api.requests),
      dbLatencyMs: round(db.avg), dbP95Ms: round(db.p95), dbQueries: counterTotal(M.db.queries),
      aiLatencyMs: round(ai.avg), aiP95Ms: round(ai.p95), aiCalls: counterTotal(M.ai.calls),
      externalLatencyMs: round(ext.avg),
    },
    leaderboards: {
      slowEndpoints: registry.topBoard(BOARD.slowApi).map((e) => ({ route: e.key, ms: round(e.value), labels: e.labels as Record<string, unknown> })),
      slowQueries: registry.topBoard(BOARD.slowDb).map((e) => ({ query: e.key, ms: round(e.value), labels: e.labels as Record<string, unknown> })),
      expensiveJobs: registry.topBoard(BOARD.expensiveJob).map((e) => ({ queue: e.key, ms: round(e.value) })),
      largestPayloads: registry.topBoard(BOARD.largestPayload).map((e) => ({ route: e.key, bytes: Math.round(e.value) })),
      errorEndpoints: registry.topBoard(BOARD.errorApi).map((e) => ({ route: e.key, labels: e.labels as Record<string, unknown> })),
      retryEndpoints: registry.topBoard(BOARD.retryApi).map((e) => ({ route: e.key })),
      slowAi: registry.topBoard(BOARD.slowAi).map((e) => ({ providerModel: e.key, ms: round(e.value) })),
    },
    cache: {
      hits, misses,
      hitRatio: hits + misses > 0 ? round(hits / (hits + misses), 4) : 0,
      invalidations: counterTotal(M.cache.invalidation),
    },
    system: {
      rssBytes: gaugeLast(M.system.rss),
      heapUsedBytes: gaugeLast(M.system.heapUsed),
      cpuPercent: round(gaugeLast(M.system.cpuPct)),
      eventLoopLagMs: round(avgOf(M.system.loopLag).avg),
    },
    errors: {
      apiErrors: counterTotal(M.api.errors),
      dbErrors: counterTotal(M.db.errors),
      aiErrors: counterTotal(M.ai.errors),
      apiTimeouts: counterTotal(M.api.timeouts),
    },
    histograms: histBy(() => true),
    counters: registry.counterEntries(),
  };
}

function round(n: number, dp = 1): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
