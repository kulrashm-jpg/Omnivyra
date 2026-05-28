/**
 * Prometheus pull-style exporter.
 *
 * Unlike statsd / OTLP, Prometheus scrapes — the exporter holds the
 * latest snapshot in memory and serves it on demand via the
 * `/api/super-admin/planner-control/prometheus` endpoint.
 *
 * The exporter's job:
 *   - cache the most-recent snapshot
 *   - serialize to Prometheus text exposition format on read
 *   - never block on the producer side (snapshot replaces the cache atomically)
 *
 * Histograms are exposed as `_bucket` + `_count` + `_sum` series. We don't
 * have raw bucket counts (only p50/p95/p99 from reservoir), so we publish
 * the percentiles as `<name>{quantile="0.5"}` series — same shape as
 * Prometheus `summary` (not `histogram`).
 */

import type { TelemetrySnapshot, TelemetryExporter } from '../plannerTelemetry';

/* eslint-disable @typescript-eslint/no-explicit-any */

let _latest: TelemetrySnapshot | null = null;
let _lastFlushAt = 0;

function isEnabled(): boolean {
  return String(process.env.PROMETHEUS_EXPORTER_ENABLED ?? 'false').toLowerCase() === 'true';
}

export function buildPrometheusExporter(): TelemetryExporter | null {
  if (!isEnabled()) return null;
  return async (snapshot) => {
    _latest = snapshot;
    _lastFlushAt = Date.now();
  };
}

function labelsToProm(labels: string): string {
  if (!labels) return '';
  const parts = labels.split('|').filter(Boolean).map((kv) => {
    const eq = kv.indexOf('=');
    const k = eq >= 0 ? kv.slice(0, eq) : kv;
    const v = eq >= 0 ? kv.slice(eq + 1) : '';
    return `${k}="${v.replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(',')}}`;
}

function labelsToPromWith(labels: string, extra: string): string {
  const base = labels ? labels.split('|').filter(Boolean) : [];
  base.push(extra);
  return labelsToProm(base.join('|'));
}

/**
 * Serialize the cached snapshot to Prometheus exposition format. Returns
 * an empty string when no snapshot has been captured yet.
 */
export function renderPrometheusText(): string {
  if (!_latest) return '# planner snapshot not yet available\n';
  const out: string[] = [];
  // Each metric: emit `# HELP` + `# TYPE` once, then one line per
  // (label-set) tuple.
  const counterByName = new Map<string, Array<{ labels: string; value: number }>>();
  const gaugeByName = new Map<string, Array<{ labels: string; value: number }>>();
  const histByName = new Map<string, Array<{ labels: string; count: number; avg: number; p50: number; p95: number; p99: number; max: number }>>();

  for (const c of _latest.counters) {
    const list = counterByName.get(c.name) ?? [];
    list.push({ labels: c.labels, value: c.value });
    counterByName.set(c.name, list);
  }
  for (const g of _latest.gauges) {
    const list = gaugeByName.get(g.name) ?? [];
    list.push({ labels: g.labels, value: g.value });
    gaugeByName.set(g.name, list);
  }
  for (const h of _latest.histograms) {
    const list = histByName.get(h.name) ?? [];
    list.push({ labels: h.labels, count: h.count, avg: h.avg, p50: h.p50, p95: h.p95, p99: h.p99, max: h.max });
    histByName.set(h.name, list);
  }

  for (const [name, list] of counterByName) {
    out.push(`# HELP ${name} planner counter (delta per export window)`);
    out.push(`# TYPE ${name} counter`);
    for (const p of list) out.push(`${name}${labelsToProm(p.labels)} ${p.value}`);
  }
  for (const [name, list] of gaugeByName) {
    out.push(`# HELP ${name} planner gauge (latest value)`);
    out.push(`# TYPE ${name} gauge`);
    for (const p of list) out.push(`${name}${labelsToProm(p.labels)} ${p.value}`);
  }
  for (const [name, list] of histByName) {
    out.push(`# HELP ${name} planner latency summary`);
    out.push(`# TYPE ${name} summary`);
    for (const p of list) {
      out.push(`${name}${labelsToPromWith(p.labels, 'quantile=0.5')} ${p.p50}`);
      out.push(`${name}${labelsToPromWith(p.labels, 'quantile=0.95')} ${p.p95}`);
      out.push(`${name}${labelsToPromWith(p.labels, 'quantile=0.99')} ${p.p99}`);
      out.push(`${name}_max${labelsToProm(p.labels)} ${p.max}`);
      out.push(`${name}_sum${labelsToProm(p.labels)} ${p.avg * p.count}`);
      out.push(`${name}_count${labelsToProm(p.labels)} ${p.count}`);
    }
  }
  out.push(`# HELP planner_prometheus_snapshot_age_ms milliseconds since the cached snapshot was captured`);
  out.push(`# TYPE planner_prometheus_snapshot_age_ms gauge`);
  out.push(`planner_prometheus_snapshot_age_ms ${Date.now() - _lastFlushAt}`);
  return out.join('\n') + '\n';
}

/** Test-only: clear the cache so a fresh snapshot can be captured. */
export function __resetPrometheusForTests(): void {
  _latest = null;
  _lastFlushAt = 0;
}
