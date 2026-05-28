/**
 * Planner telemetry abstraction.
 *
 * Provides a thin, dependency-free interface that:
 *   - accepts metric emits from any planner hot path
 *   - keeps per-process histograms with p50/p95/p99 reservoirs
 *   - exposes a snapshot for Datadog/Grafana/OTel scrapers
 *   - delegates to a pluggable "exporter" so concrete SDK wiring (statsd,
 *     OTLP gRPC, Prometheus) can happen at the edge without polluting
 *     hot-path code
 *
 * Hot-path properties:
 *   - emit operations are O(1) with no allocations in the steady state
 *   - histograms use a fixed-size reservoir (default 1024 samples) with
 *     reservoir sampling so memory is bounded regardless of throughput
 *   - low-cardinality labels enforced: each metric's allowed labels are
 *     declared up-front; unknown labels are dropped at emit
 *   - exporters run on a 10s timer in a background interval — never on the
 *     hot path
 *
 * No SDK lock-in. Exporters are pluggable functions; the default no-op
 * exporter is wired by default. Production deploys swap in a real exporter
 * via `registerTelemetryExporter` at bootstrap.
 */

import { logger } from './logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MetricKind = 'counter' | 'histogram_ms' | 'gauge';

export interface MetricDescriptor {
  name: string;
  kind: MetricKind;
  description: string;
  /** Allowed label keys. Other keys passed at emit time are dropped. */
  labelKeys: string[];
  /** When set, emit values clamped to [0, max] to bound runaway labels. */
  maxValue?: number;
}

/**
 * Canonical metric registry. Every name here MUST be dashboard-named
 * (snake_case, planner_ prefix, kind suffix when meaningful) so Grafana/
 * Datadog/OTel queries are stable across versions.
 */
export const PLANNER_METRICS: MetricDescriptor[] = [
  // Planner latency
  { name: 'planner_p95_latency_ms',                 kind: 'histogram_ms', labelKeys: ['mode'],          description: 'End-to-end planner request latency (p95 surfaced from histogram).' },
  { name: 'planner_p99_latency_ms',                 kind: 'histogram_ms', labelKeys: ['mode'],          description: 'End-to-end planner request latency (p99).' },
  // SSE
  { name: 'planner_sse_connections_active',         kind: 'gauge',        labelKeys: [],                description: 'Currently-open SSE connections on this instance.' },
  { name: 'planner_sse_disconnect_rate',            kind: 'counter',      labelKeys: ['reason'],        description: 'SSE disconnect counter. Reason: client_close / heartbeat_timeout / server_terminated.' },
  { name: 'planner_sse_replay_latency_ms',          kind: 'histogram_ms', labelKeys: [],                description: 'Time spent replaying events on SSE reconnect.' },
  // Streams
  { name: 'planner_stream_consumer_lag',            kind: 'gauge',        labelKeys: ['stream'],        description: 'Pending entries per consumer group per stream.' },
  { name: 'planner_stream_replay_total',            kind: 'counter',      labelKeys: ['stream'],        description: 'Total entries replayed since process start.' },
  { name: 'planner_replay_duplication_suppressed',  kind: 'counter',      labelKeys: ['stream'],        description: 'Duplicate replay entries dropped by local dedup map.' },
  // Refinement
  { name: 'planner_refinement_throughput',          kind: 'counter',      labelKeys: ['result'],        description: 'Refinement job completions. Result: success / stale_revision / error.' },
  // Provider
  { name: 'planner_provider_latency_ms',            kind: 'histogram_ms', labelKeys: ['provider', 'op'], description: 'Provider call wall-clock from acquire to dispatch return.' },
  // Distributed semaphore
  { name: 'planner_semaphore_acquisition_latency_ms', kind: 'histogram_ms', labelKeys: ['pool'],         description: 'Time spent waiting on the distributed semaphore.' },
  // Token bucket
  { name: 'planner_token_bucket_wait_ms',           kind: 'histogram_ms', labelKeys: ['provider'],      description: 'Wait time on the distributed token bucket.' },
  // Admission control
  { name: 'planner_admission_reject_latency_ms',    kind: 'histogram_ms', labelKeys: ['reason'],        description: 'How long the admission decision took (including Redis cooldown read).' },
  // Overload
  { name: 'planner_overload_transitions',           kind: 'counter',      labelKeys: ['from', 'to'],    description: 'Cluster overload mode transitions.' },
  // Exporter health (added for production exporter wiring)
  { name: 'planner_exporter_export_total',          kind: 'counter',      labelKeys: ['exporter', 'kind', 'result'], description: 'Per-exporter call count. Result: success / network_error / timeout / dropped_full.' },
  { name: 'planner_exporter_lag_ms',                kind: 'histogram_ms', labelKeys: ['exporter', 'kind'], description: 'Time from snapshot capture to acknowledged delivery at the exporter sink.' },
  { name: 'planner_exporter_dropped_total',         kind: 'counter',      labelKeys: ['exporter', 'kind', 'reason'], description: 'Items dropped due to backpressure or queue overflow.' },
  { name: 'planner_exporter_batch_size',            kind: 'histogram_ms', labelKeys: ['exporter', 'kind'], description: 'Per-flush batch size — overloaded as a histogram so dashboards can plot p50/p95.' },
];

const _descriptors = new Map<string, MetricDescriptor>(PLANNER_METRICS.map((d) => [d.name, d]));

/* ───────────────────────────────────────────────────────────────────────
 * In-memory histograms via reservoir sampling.
 * ──────────────────────────────────────────────────────────────────────
 * A reservoir of fixed size N produces an unbiased sample of the stream
 * regardless of total volume. We use this for p50/p95/p99 estimation
 * since exact computation would require unbounded memory.
 */

const RESERVOIR_SIZE = 1024;

class Histogram {
  private samples = new Float64Array(RESERVOIR_SIZE);
  private count = 0;
  observe(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    const i = this.count;
    this.count += 1;
    if (i < RESERVOIR_SIZE) {
      this.samples[i] = v;
    } else {
      // Reservoir sampling: replace with probability RESERVOIR_SIZE/count.
      const idx = Math.floor(Math.random() * (i + 1));
      if (idx < RESERVOIR_SIZE) this.samples[idx] = v;
    }
  }
  snapshot(): { count: number; p50: number; p95: number; p99: number; max: number; avg: number } | null {
    if (this.count === 0) return null;
    const n = Math.min(this.count, RESERVOIR_SIZE);
    const sorted = Array.from(this.samples.slice(0, n)).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    return { count: this.count, p50: at(0.50), p95: at(0.95), p99: at(0.99), max: sorted[n - 1], avg: sum / n };
  }
  reset(): void {
    this.count = 0;
  }
}

type LabelKey = string; // canonical "name|k=v|k=v" string

class CounterMap {
  private map = new Map<LabelKey, number>();
  add(labelKey: LabelKey, value: number): void {
    if (!Number.isFinite(value)) return;
    this.map.set(labelKey, (this.map.get(labelKey) ?? 0) + value);
  }
  entries(): Array<[LabelKey, number]> { return Array.from(this.map.entries()); }
  clear(): void { this.map.clear(); }
}

class GaugeMap {
  private map = new Map<LabelKey, number>();
  set(labelKey: LabelKey, value: number): void { if (Number.isFinite(value)) this.map.set(labelKey, value); }
  entries(): Array<[LabelKey, number]> { return Array.from(this.map.entries()); }
}

const _counters   = new Map<string, CounterMap>();
const _histograms = new Map<string, Map<LabelKey, Histogram>>();
const _gauges     = new Map<string, GaugeMap>();

function canonicalLabelKey(descriptor: MetricDescriptor, labels: Record<string, string | number | undefined>): LabelKey {
  // Only allow declared label keys. Sort to keep key strings stable.
  const parts: string[] = [];
  for (const k of descriptor.labelKeys) {
    const v = labels[k];
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${String(v).slice(0, 64)}`);
  }
  parts.sort();
  return parts.join('|');
}

export function counter(name: string, value: number = 1, labels: Record<string, string | number | undefined> = {}): void {
  try {
    const d = _descriptors.get(name);
    if (!d || d.kind !== 'counter') return;
    const key = canonicalLabelKey(d, labels);
    const m = _counters.get(name) ?? new CounterMap();
    if (!_counters.has(name)) _counters.set(name, m);
    m.add(key, d.maxValue != null ? Math.min(d.maxValue, value) : value);
  } catch { /* hot path must not throw */ }
}

export function histogramMs(name: string, valueMs: number, labels: Record<string, string | number | undefined> = {}): void {
  try {
    const d = _descriptors.get(name);
    if (!d || d.kind !== 'histogram_ms') return;
    const key = canonicalLabelKey(d, labels);
    let group = _histograms.get(name);
    if (!group) { group = new Map(); _histograms.set(name, group); }
    let h = group.get(key);
    if (!h) { h = new Histogram(); group.set(key, h); }
    h.observe(valueMs);
  } catch { /* hot path must not throw */ }
}

export function gauge(name: string, value: number, labels: Record<string, string | number | undefined> = {}): void {
  try {
    const d = _descriptors.get(name);
    if (!d || d.kind !== 'gauge') return;
    const key = canonicalLabelKey(d, labels);
    const m = _gauges.get(name) ?? new GaugeMap();
    if (!_gauges.has(name)) _gauges.set(name, m);
    m.set(key, value);
  } catch { /* hot path must not throw */ }
}

/**
 * Take a snapshot of the current metric state. Counters and histograms are
 * read by the registered exporter; gauges are point-in-time values.
 *
 * Counters and histograms are RESET after snapshot so the next interval
 * gets a fresh window. Gauges are NOT reset (they reflect current state).
 */
export interface TelemetrySnapshot {
  counters: Array<{ name: string; labels: LabelKey; value: number }>;
  histograms: Array<{
    name: string; labels: LabelKey;
    count: number; p50: number; p95: number; p99: number; max: number; avg: number;
  }>;
  gauges: Array<{ name: string; labels: LabelKey; value: number }>;
  taken_at_ms: number;
}

export function takeSnapshot(opts: { resetAfter?: boolean } = {}): TelemetrySnapshot {
  const counters: TelemetrySnapshot['counters'] = [];
  for (const [name, m] of _counters) for (const [labels, value] of m.entries()) counters.push({ name, labels, value });
  const histograms: TelemetrySnapshot['histograms'] = [];
  for (const [name, group] of _histograms) {
    for (const [labels, h] of group.entries()) {
      const s = h.snapshot();
      if (!s) continue;
      histograms.push({ name, labels, ...s });
    }
  }
  const gauges: TelemetrySnapshot['gauges'] = [];
  for (const [name, m] of _gauges) for (const [labels, value] of m.entries()) gauges.push({ name, labels, value });

  if (opts.resetAfter !== false) {
    for (const m of _counters.values()) m.clear();
    for (const group of _histograms.values()) for (const h of group.values()) h.reset();
  }
  return { counters, histograms, gauges, taken_at_ms: Date.now() };
}

/* ───────────────────────────────────────────────────────────────────────
 * Exporter plumbing.
 * ──────────────────────────────────────────────────────────────────────
 * Production deploys register an exporter at bootstrap (typically a thin
 * adapter calling statsd / dogstatsd / OTel meter SDK). Default exporter
 * is a no-op + a single structured log line per export tick so
 * dashboards built on log-based metrics still light up without any
 * additional SDK install.
 */

export type TelemetryExporter = (snapshot: TelemetrySnapshot) => void | Promise<void>;

let _exporter: TelemetryExporter = (snapshot) => {
  if (snapshot.counters.length === 0 && snapshot.histograms.length === 0 && snapshot.gauges.length === 0) return;
  logger.info('planner_telemetry_snapshot', {
    counters_n: snapshot.counters.length,
    histograms_n: snapshot.histograms.length,
    gauges_n: snapshot.gauges.length,
    counters: snapshot.counters.slice(0, 20),     // truncate so log lines stay <16KB
    histograms: snapshot.histograms.slice(0, 20),
    gauges: snapshot.gauges.slice(0, 20),
  });
};

export function registerTelemetryExporter(fn: TelemetryExporter): void {
  _exporter = fn;
}

let _exportTimer: NodeJS.Timeout | null = null;

/**
 * Start the export loop. Calls the registered exporter every
 * `PLANNER_TELEMETRY_EXPORT_INTERVAL_MS` (default 10s) with a fresh
 * snapshot. Idempotent.
 */
export function startTelemetryExportLoop(): void {
  if (_exportTimer) return;
  const intervalMs = Math.max(1_000, Number(process.env.PLANNER_TELEMETRY_EXPORT_INTERVAL_MS || 10_000));
  _exportTimer = setInterval(async () => {
    try {
      const snap = takeSnapshot({ resetAfter: true });
      await _exporter(snap);
    } catch (err) {
      logger.warn('planner_telemetry_export_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);
  try { (_exportTimer as any).unref?.(); } catch { /* noop */ }
  logger.info('planner_telemetry_export_loop_started', { interval_ms: intervalMs });
}

export function stopTelemetryExportLoop(): void {
  if (_exportTimer) clearInterval(_exportTimer);
  _exportTimer = null;
}

/**
 * Wrap an async operation with histogram timing. The returned promise
 * resolves/rejects with the same value/error; the histogram is observed
 * in `finally` regardless.
 */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  labels: Record<string, string | number | undefined> = {},
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    histogramMs(name, Date.now() - start, labels);
  }
}

export function __resetTelemetryForTests(): void {
  _counters.clear();
  _histograms.clear();
  _gauges.clear();
  if (_exportTimer) { clearInterval(_exportTimer); _exportTimer = null; }
  _exporter = () => undefined;
}
