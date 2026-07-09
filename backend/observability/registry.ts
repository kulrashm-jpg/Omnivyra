/**
 * HARDEN-001 — In-process metrics registry.
 *
 * A tiny, dependency-free, FAIL-SAFE store for counters, gauges, histograms and
 * "top-N" leaderboards. Everything is bounded (cardinality + reservoir caps) so
 * it can never leak memory, and every public method is wrapped so a failure in
 * metrics recording can never break application execution.
 *
 * This is intentionally a process-local aggregation layer (no network, no
 * Redis). A future dashboard reads getObservabilitySnapshot(); a future exporter
 * can scrape the same accessors.
 */
import { observabilityConfig } from './config';

export type Labels = Record<string, string | number | boolean | null | undefined>;

interface HistogramSeries {
  count: number;
  sum: number;
  min: number;
  max: number;
  /** Bounded reservoir for percentile estimation. */
  samples: number[];
  /** Reservoir write cursor once full (reservoir sampling). */
  seen: number;
}

interface TopEntry {
  key: string;
  value: number;
  labels: Labels;
  at: number;
}

/** Serialize a name + sorted labels into a stable series key. */
function seriesKey(name: string, labels?: Labels): string {
  if (!labels) return name;
  const parts: string[] = [];
  for (const k of Object.keys(labels).sort()) {
    const v = labels[k];
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

class MetricsRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, HistogramSeries>();
  private tops = new Map<string, TopEntry[]>();
  private labelsByKey = new Map<string, { name: string; labels?: Labels }>();
  private droppedSeries = 0;
  readonly startedAt = Date.now();

  private atCapacity(): boolean {
    const total = this.counters.size + this.gauges.size + this.histograms.size;
    return total >= observabilityConfig.maxSeries;
  }

  private remember(key: string, name: string, labels?: Labels): void {
    if (!this.labelsByKey.has(key)) this.labelsByKey.set(key, { name, labels });
  }

  incr(name: string, value = 1, labels?: Labels): void {
    try {
      const key = seriesKey(name, labels);
      if (!this.counters.has(key) && this.atCapacity()) { this.droppedSeries++; return; }
      this.counters.set(key, (this.counters.get(key) ?? 0) + value);
      this.remember(key, name, labels);
    } catch { /* fail-safe */ }
  }

  gauge(name: string, value: number, labels?: Labels): void {
    try {
      const key = seriesKey(name, labels);
      if (!this.gauges.has(key) && this.atCapacity()) { this.droppedSeries++; return; }
      this.gauges.set(key, value);
      this.remember(key, name, labels);
    } catch { /* fail-safe */ }
  }

  observe(name: string, value: number, labels?: Labels): void {
    try {
      if (!Number.isFinite(value)) return;
      const key = seriesKey(name, labels);
      let h = this.histograms.get(key);
      if (!h) {
        if (this.atCapacity()) { this.droppedSeries++; return; }
        h = { count: 0, sum: 0, min: value, max: value, samples: [], seen: 0 };
        this.histograms.set(key, h);
        this.remember(key, name, labels);
      }
      h.count += 1;
      h.sum += value;
      if (value < h.min) h.min = value;
      if (value > h.max) h.max = value;
      const cap = observabilityConfig.histogramSamples;
      if (h.samples.length < cap) {
        h.samples.push(value);
      } else {
        // Reservoir sampling — keeps an unbiased fixed-size sample.
        const j = Math.floor(Math.random() * (h.seen + 1));
        if (j < cap) h.samples[j] = value;
      }
      h.seen += 1;
    } catch { /* fail-safe */ }
  }

  /** Track a value in a bounded, sorted-desc "top-N" leaderboard. */
  top(board: string, value: number, key: string, labels: Labels = {}): void {
    try {
      if (!Number.isFinite(value)) return;
      const n = observabilityConfig.topN;
      let list = this.tops.get(board);
      if (!list) { list = []; this.tops.set(board, list); }
      if (list.length >= n && value <= (list[list.length - 1]?.value ?? -Infinity)) return;
      list.push({ key, value, labels, at: Date.now() });
      list.sort((a, b) => b.value - a.value);
      if (list.length > n) list.length = n;
    } catch { /* fail-safe */ }
  }

  // ── Accessors (read-only; used by snapshot) ─────────────────────────────────

  counterEntries(): Array<{ series: string; name: string; labels?: Labels; value: number }> {
    return Array.from(this.counters.entries()).map(([series, value]) => ({
      series, value, ...(this.labelsByKey.get(series) ?? { name: series }),
    }));
  }

  gaugeEntries(): Array<{ series: string; name: string; labels?: Labels; value: number }> {
    return Array.from(this.gauges.entries()).map(([series, value]) => ({
      series, value, ...(this.labelsByKey.get(series) ?? { name: series }),
    }));
  }

  histogramEntries(): Array<{
    series: string; name: string; labels?: Labels;
    count: number; sum: number; min: number; max: number; avg: number;
    p50: number; p95: number; p99: number;
  }> {
    return Array.from(this.histograms.entries()).map(([series, h]) => {
      const sorted = [...h.samples].sort((a, b) => a - b);
      const pct = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
      return {
        series,
        ...(this.labelsByKey.get(series) ?? { name: series }),
        count: h.count, sum: h.sum, min: h.min, max: h.max,
        avg: h.count ? h.sum / h.count : 0,
        p50: pct(50), p95: pct(95), p99: pct(99),
      };
    });
  }

  topBoard(board: string): TopEntry[] {
    return (this.tops.get(board) ?? []).slice();
  }

  meta(): { startedAt: number; series: number; droppedSeries: number } {
    return {
      startedAt: this.startedAt,
      series: this.counters.size + this.gauges.size + this.histograms.size,
      droppedSeries: this.droppedSeries,
    };
  }

  /** Test seam only. */
  reset(): void {
    this.counters.clear(); this.gauges.clear(); this.histograms.clear();
    this.tops.clear(); this.labelsByKey.clear(); this.droppedSeries = 0;
  }
}

/** Process-wide singleton (survives module reloads within a process). */
const g = globalThis as unknown as { __umniverseMetricsRegistry__?: MetricsRegistry };
export const registry: MetricsRegistry = g.__umniverseMetricsRegistry__ ?? (g.__umniverseMetricsRegistry__ = new MetricsRegistry());
export type { MetricsRegistry };
