/**
 * OTLP/HTTP+JSON metrics exporter.
 *
 * Implements the OpenTelemetry OTLP/HTTP wire format (JSON encoding) so
 * any OTel-compatible backend works:
 *   - Self-hosted OpenTelemetry Collector
 *   - Datadog Agent's OTel receiver (POSTs to http://localhost:4318/v1/metrics)
 *   - Honeycomb / New Relic / Lightstep / Tempo / Mimir / etc.
 *
 * Why JSON over protobuf?
 *   - Zero dependencies — built-in fetch ships JSON natively
 *   - Spec-compliant: OTLP/HTTP supports both encodings
 *   - Slightly larger payload, but per-snapshot lag is identical and the
 *     batcher caps queue depth so memory stays bounded
 *
 * Reference: opentelemetry.io/docs/specs/otlp/#otlphttp
 */

import { logger } from '../logger';
import { ExporterBatcher, retryWithBackoff } from './exporterBase';
import type { TelemetrySnapshot, TelemetryExporter } from '../plannerTelemetry';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface OtlpMetricsConfig {
  endpoint: string;     // e.g. http://localhost:4318/v1/metrics
  serviceName: string;
  resourceAttrs: Record<string, string>;
  headers: Record<string, string>;
  timeoutMs: number;
}

function readConfig(): OtlpMetricsConfig | null {
  const endpoint = process.env.OTLP_METRICS_ENDPOINT;
  if (!endpoint) return null;
  const serviceName = process.env.OTEL_SERVICE_NAME || 'planner';
  const headerEnv = process.env.OTLP_HEADERS || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headerEnv) {
    for (const pair of headerEnv.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) headers[k.trim()] = v.trim();
    }
  }
  const resourceAttrs: Record<string, string> = {
    'service.name': serviceName,
    'deployment.environment': process.env.NODE_ENV || 'unknown',
  };
  return { endpoint, serviceName, resourceAttrs, headers, timeoutMs: 5_000 };
}

function parseLabelString(labels: string): Array<{ key: string; value: { stringValue: string } }> {
  if (!labels) return [];
  return labels.split('|').filter(Boolean).map((kv) => {
    const eq = kv.indexOf('=');
    const k = eq >= 0 ? kv.slice(0, eq) : kv;
    const v = eq >= 0 ? kv.slice(eq + 1) : '';
    return { key: k, value: { stringValue: v } };
  });
}

function nowNanos(): string {
  // OTLP timestamps are nanoseconds since epoch as STRING (JSON safe int).
  return String(BigInt(Date.now()) * 1_000_000n);
}

function snapshotToOtlpRequest(snapshot: TelemetrySnapshot, cfg: OtlpMetricsConfig): unknown {
  const ts = nowNanos();
  // Group instruments per metric name so multiple label-sets become
  // multiple `dataPoints` of one Metric.
  const counters = new Map<string, Array<{ labels: string; value: number }>>();
  const gauges = new Map<string, Array<{ labels: string; value: number }>>();
  const histograms = new Map<string, Array<{ labels: string; count: number; sum: number; p50: number; p95: number; p99: number; max: number }>>();

  for (const c of snapshot.counters) {
    const list = counters.get(c.name) ?? [];
    list.push({ labels: c.labels, value: c.value });
    counters.set(c.name, list);
  }
  for (const g of snapshot.gauges) {
    const list = gauges.get(g.name) ?? [];
    list.push({ labels: g.labels, value: g.value });
    gauges.set(g.name, list);
  }
  for (const h of snapshot.histograms) {
    const list = histograms.get(h.name) ?? [];
    list.push({ labels: h.labels, count: h.count, sum: h.avg * h.count, p50: h.p50, p95: h.p95, p99: h.p99, max: h.max });
    histograms.set(h.name, list);
  }

  const metrics: any[] = [];
  for (const [name, list] of counters) {
    metrics.push({
      name,
      sum: {
        dataPoints: list.map((p) => ({
          attributes: parseLabelString(p.labels),
          timeUnixNano: ts,
          asDouble: p.value,
        })),
        aggregationTemporality: 1, // DELTA
        isMonotonic: true,
      },
    });
  }
  for (const [name, list] of gauges) {
    metrics.push({
      name,
      gauge: {
        dataPoints: list.map((p) => ({
          attributes: parseLabelString(p.labels),
          timeUnixNano: ts,
          asDouble: p.value,
        })),
      },
    });
  }
  for (const [name, list] of histograms) {
    metrics.push({
      name,
      summary: {
        dataPoints: list.map((p) => ({
          attributes: parseLabelString(p.labels),
          timeUnixNano: ts,
          count: p.count,
          sum: p.sum,
          quantileValues: [
            { quantile: 0.5,  value: p.p50 },
            { quantile: 0.95, value: p.p95 },
            { quantile: 0.99, value: p.p99 },
            { quantile: 1.0,  value: p.max },
          ],
        })),
      },
    });
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: Object.entries(cfg.resourceAttrs).map(([k, v]) => ({ key: k, value: { stringValue: v } })),
      },
      scopeMetrics: [{
        scope: { name: 'planner', version: '1' },
        metrics,
      }],
    }],
  };
}

export function buildOtlpMetricsExporter(): TelemetryExporter | null {
  const cfg = readConfig();
  if (!cfg) return null;

  const batcher = new ExporterBatcher<TelemetrySnapshot>({
    exporterName: 'otlp_http',
    kind: 'metrics',
    maxQueueSize: 128,
    flushBatchSize: 1, // each snapshot is already aggregated
    flushIntervalMs: 5_000,
    flush: async (snapshots) => {
      for (const snapshot of snapshots) {
        const body = JSON.stringify(snapshotToOtlpRequest(snapshot, cfg));
        const sent = await retryWithBackoff(async () => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), cfg.timeoutMs);
          try {
            // ssrf-ok: cfg.endpoint is an operator-configured OTLP collector
            const res = await fetch(cfg.endpoint, {
              method: 'POST',
              headers: cfg.headers,
              body,
              signal: controller.signal,
            });
            if (!res.ok && res.status !== 202 && res.status !== 204) {
              const text = await res.text().catch(() => '');
              throw new Error(`OTLP metrics HTTP ${res.status}: ${text.slice(0, 200)}`);
            }
            return true;
          } finally {
            clearTimeout(t);
          }
        }, {
          maxAttempts: 3,
          isRetryable: (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            // Retry on 5xx, 429, network errors. Not on 4xx (config error).
            return /HTTP 5\d\d/.test(msg) || /HTTP 429/.test(msg) || msg.toLowerCase().includes('network') || msg.includes('ETIMEDOUT') || msg.includes('aborted');
          },
        });
        if (sent === null) throw new Error('OTLP metrics export exhausted retries');
      }
    },
  });

  logger.info('planner_exporter_otlp_metrics_started', {
    endpoint: cfg.endpoint, service_name: cfg.serviceName,
  });

  return async (snapshot) => {
    batcher.enqueue(snapshot);
  };
}
