/**
 * F-02 — Prometheus text exporter over the HARDEN-001 registry (Foundation
 * Batch A).
 *
 * Renders the existing in-process registry (counters / gauges / histograms)
 * in Prometheus exposition format 0.0.4 so an external scraper (Prometheus /
 * Grafana Agent / vmagent) can finally back the alert rules. This is a pure
 * READ of the registry accessors — it adds no recording paths and no new
 * metrics subsystem (per the Foundation Analysis: export HARDEN-001, never
 * build a sixth system).
 *
 * Naming: registry names are dot-separated (`api.request.duration_ms`);
 * Prometheus requires `[a-zA-Z_:][a-zA-Z0-9_:]*`, so dots and other invalid
 * characters become underscores (`api_request_duration_ms`). Histograms are
 * exported as summaries (quantiles come from the bounded reservoir).
 */
import { registry, type Labels } from './registry';

function sanitizeName(name: string): string {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_:]/g, '_');
  return /^[a-zA-Z_:]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function sanitizeLabelName(name: string): string {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function fmtLabels(labels?: Labels, extra?: Record<string, string>): string {
  const parts: string[] = [];
  if (labels) {
    for (const k of Object.keys(labels).sort()) {
      const v = labels[k];
      if (v === undefined || v === null) continue;
      parts.push(`${sanitizeLabelName(k)}="${escapeLabelValue(String(v))}"`);
    }
  }
  if (extra) {
    for (const k of Object.keys(extra)) {
      parts.push(`${sanitizeLabelName(k)}="${escapeLabelValue(extra[k])}"`);
    }
  }
  return parts.length ? `{${parts.join(',')}}` : '';
}

function fmtValue(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return String(value);
}

/**
 * Render the full registry as Prometheus exposition text (version 0.0.4).
 * Fail-safe: any per-series failure skips that series; a total failure
 * returns a minimal payload rather than throwing.
 */
export function renderPrometheusText(): string {
  const lines: string[] = [];
  const typed = new Set<string>();

  const typeLine = (name: string, type: 'counter' | 'gauge' | 'summary'): void => {
    if (typed.has(name)) return;
    typed.add(name);
    lines.push(`# TYPE ${name} ${type}`);
  };

  try {
    for (const entry of registry.counterEntries()) {
      try {
        const name = sanitizeName(entry.name);
        const value = fmtValue(entry.value);
        if (value === null) continue;
        typeLine(name, 'counter');
        lines.push(`${name}${fmtLabels(entry.labels)} ${value}`);
      } catch { /* skip series */ }
    }

    for (const entry of registry.gaugeEntries()) {
      try {
        const name = sanitizeName(entry.name);
        const value = fmtValue(entry.value);
        if (value === null) continue;
        typeLine(name, 'gauge');
        lines.push(`${name}${fmtLabels(entry.labels)} ${value}`);
      } catch { /* skip series */ }
    }

    for (const entry of registry.histogramEntries()) {
      try {
        const name = sanitizeName(entry.name);
        typeLine(name, 'summary');
        const quantiles: Array<[string, number]> = [
          ['0.5', entry.p50],
          ['0.95', entry.p95],
          ['0.99', entry.p99],
        ];
        for (const [q, v] of quantiles) {
          const value = fmtValue(v);
          if (value === null) continue;
          lines.push(`${name}${fmtLabels(entry.labels, { quantile: q })} ${value}`);
        }
        const sum = fmtValue(entry.sum);
        const count = fmtValue(entry.count);
        if (sum !== null) lines.push(`${name}_sum${fmtLabels(entry.labels)} ${sum}`);
        if (count !== null) lines.push(`${name}_count${fmtLabels(entry.labels)} ${count}`);
      } catch { /* skip series */ }
    }

    // Registry meta — lets a scraper see cold starts and cardinality pressure.
    const meta = registry.meta();
    typeLine('observability_process_start_time_seconds', 'gauge');
    lines.push(`observability_process_start_time_seconds ${Math.floor(meta.startedAt / 1000)}`);
    typeLine('observability_series', 'gauge');
    lines.push(`observability_series ${meta.series}`);
    typeLine('observability_dropped_series_total', 'counter');
    lines.push(`observability_dropped_series_total ${meta.droppedSeries}`);
  } catch {
    return '# metrics export failed (fail-safe)\n';
  }

  return lines.join('\n') + '\n';
}

/** Content type expected by Prometheus scrapers for text exposition. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
