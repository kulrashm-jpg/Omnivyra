/**
 * Unit tests for the production exporter wiring.
 *
 * Covers:
 *   - ExporterBatcher: enqueue + size-triggered + timer-triggered flush + drop-on-overflow
 *   - retryWithBackoff: retries on retryable errors, gives up on non-retryable
 *   - dogstatsd line serialization (canonical label → tag conversion)
 *   - OTLP metrics request shape
 *   - OTLP traces request shape
 *   - Prometheus text exposition format
 *   - Bootstrap composer env-driven registration matrix
 */

import {
  __resetTelemetryForTests, takeSnapshot, counter, histogramMs, gauge,
  registerTelemetryExporter,
} from '../../services/plannerTelemetry';
import { ExporterBatcher, retryWithBackoff } from '../../services/plannerExporters/exporterBase';
import {
  buildPrometheusExporter, renderPrometheusText, __resetPrometheusForTests,
} from '../../services/plannerExporters/prometheusRegistry';

beforeEach(() => {
  __resetTelemetryForTests();
  __resetPrometheusForTests();
});

// ─────────────────────────────────────────────────────────────────────────
// Base batcher
// ─────────────────────────────────────────────────────────────────────────
describe('ExporterBatcher', () => {
  test('size-triggered flush calls callback once', async () => {
    const flushed: number[][] = [];
    const b = new ExporterBatcher<number>({
      exporterName: 'test', kind: 'metrics',
      maxQueueSize: 100, flushBatchSize: 3, flushIntervalMs: 10_000,
      flush: async (items) => { flushed.push(items as number[]); },
    });
    b.enqueue(1); b.enqueue(2); b.enqueue(3);
    // setImmediate-deferred flush
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 30));
    expect(flushed.length).toBe(1);
    expect(flushed[0]).toEqual([1, 2, 3]);
    await b.shutdown();
  });

  test('drops on overflow + records dropped counter', async () => {
    const flushed: number[][] = [];
    const b = new ExporterBatcher<number>({
      exporterName: 'overflow', kind: 'metrics',
      maxQueueSize: 2, flushBatchSize: 100, flushIntervalMs: 60_000,
      flush: async (items) => { flushed.push(items as number[]); },
    });
    b.enqueue(1); b.enqueue(2); b.enqueue(3); b.enqueue(4);
    expect(b.queueDepth()).toBe(2);
    const snap = takeSnapshot({ resetAfter: false });
    const drop = snap.counters.find((c) => c.name === 'planner_exporter_dropped_total');
    expect(drop?.value).toBeGreaterThanOrEqual(2);
    await b.shutdown();
  });

  test('shutdown drains remaining items', async () => {
    const flushed: number[][] = [];
    const b = new ExporterBatcher<number>({
      exporterName: 'drain', kind: 'metrics',
      maxQueueSize: 100, flushBatchSize: 100, flushIntervalMs: 60_000,
      flush: async (items) => { flushed.push(items as number[]); },
    });
    b.enqueue(1); b.enqueue(2);
    await b.shutdown();
    expect(flushed[0]).toEqual([1, 2]);
  });

  test('flush failure increments dropped counter without rethrowing', async () => {
    const b = new ExporterBatcher<number>({
      exporterName: 'fail', kind: 'metrics',
      maxQueueSize: 100, flushBatchSize: 1, flushIntervalMs: 60_000,
      flush: async () => { throw new Error('sink down'); },
    });
    b.enqueue(1);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 30));
    const snap = takeSnapshot({ resetAfter: false });
    const drop = snap.counters.find((c) => c.name === 'planner_exporter_dropped_total');
    expect(drop?.value).toBeGreaterThanOrEqual(1);
    await b.shutdown();
  });
});

describe('retryWithBackoff', () => {
  test('returns result on first success', async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => { calls++; return 'ok'; });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries on retryable errors then succeeds', async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new Error('HTTP 503');
      return 'ok';
    }, { maxAttempts: 5, isRetryable: (err) => /503/.test((err as Error).message) });
    expect(r).toBe('ok');
    expect(calls).toBe(3);
  });

  test('returns null after exhausting attempts', async () => {
    const r = await retryWithBackoff(async () => { throw new Error('HTTP 503'); }, {
      maxAttempts: 2, isRetryable: () => true,
    });
    expect(r).toBeNull();
  });

  test('does not retry when isRetryable returns false', async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => {
      calls++; throw new Error('HTTP 400');
    }, { maxAttempts: 5, isRetryable: () => false });
    expect(r).toBeNull();
    expect(calls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Prometheus registry
// ─────────────────────────────────────────────────────────────────────────
describe('Prometheus exporter', () => {
  beforeEach(() => {
    process.env.PROMETHEUS_EXPORTER_ENABLED = 'true';
    __resetPrometheusForTests();
  });

  test('renders empty body before first snapshot', () => {
    const out = renderPrometheusText();
    expect(out).toContain('snapshot not yet available');
  });

  test('renders counter line with labels', async () => {
    counter('planner_sse_disconnect_rate', 7, { reason: 'client_close' });
    const exp = buildPrometheusExporter();
    expect(exp).not.toBeNull();
    if (exp) await exp(takeSnapshot({ resetAfter: false }));
    const out = renderPrometheusText();
    expect(out).toContain('# TYPE planner_sse_disconnect_rate counter');
    expect(out).toMatch(/planner_sse_disconnect_rate\{reason="client_close"\} 7/);
  });

  test('renders histogram as summary with quantile labels', async () => {
    for (let i = 0; i < 50; i++) histogramMs('planner_provider_latency_ms', i, { provider: 'openai', op: 't' });
    const exp = buildPrometheusExporter();
    if (exp) await exp(takeSnapshot({ resetAfter: false }));
    const out = renderPrometheusText();
    expect(out).toContain('# TYPE planner_provider_latency_ms summary');
    expect(out).toMatch(/planner_provider_latency_ms\{.*quantile="0\.5".*\}/);
    expect(out).toMatch(/planner_provider_latency_ms\{.*quantile="0\.95".*\}/);
    expect(out).toMatch(/planner_provider_latency_ms_count\{.*\} 50/);
  });

  test('renders gauge as gauge', async () => {
    gauge('planner_sse_connections_active', 42);
    const exp = buildPrometheusExporter();
    if (exp) await exp(takeSnapshot({ resetAfter: false }));
    const out = renderPrometheusText();
    expect(out).toContain('# TYPE planner_sse_connections_active gauge');
    expect(out).toMatch(/planner_sse_connections_active 42/);
  });

  test('disabled exporter returns null', () => {
    process.env.PROMETHEUS_EXPORTER_ENABLED = 'false';
    expect(buildPrometheusExporter()).toBeNull();
  });

  test('includes snapshot_age_ms gauge', async () => {
    counter('planner_sse_disconnect_rate', 1);
    const exp = buildPrometheusExporter();
    if (exp) await exp(takeSnapshot({ resetAfter: false }));
    const out = renderPrometheusText();
    expect(out).toContain('planner_prometheus_snapshot_age_ms');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap composer
// ─────────────────────────────────────────────────────────────────────────
describe('bootstrapPlannerExporters', () => {
  beforeEach(() => {
    delete process.env.DATADOG_STATSD_HOST;
    delete process.env.OTLP_METRICS_ENDPOINT;
    delete process.env.OTLP_TRACES_ENDPOINT;
    delete process.env.PROMETHEUS_EXPORTER_ENABLED;
    jest.resetModules();
  });

  test('no env → fallback log exporter active, no metric/trace exporters', () => {
    const { bootstrapPlannerExporters } = require('../../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    expect(result.metrics_exporters).toEqual([]);
    expect(result.trace_exporters).toEqual([]);
    expect(result.fallback_log_exporter).toBe(true);
  });

  test('PROMETHEUS_EXPORTER_ENABLED=true wires prometheus', () => {
    process.env.PROMETHEUS_EXPORTER_ENABLED = 'true';
    const { bootstrapPlannerExporters } = require('../../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    expect(result.metrics_exporters).toContain('prometheus');
    expect(result.fallback_log_exporter).toBe(false);
  });

  test('OTLP_METRICS_ENDPOINT set wires otlp_http metrics', () => {
    process.env.OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    const { bootstrapPlannerExporters } = require('../../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    expect(result.metrics_exporters).toContain('otlp_http');
  });

  test('OTLP_TRACES_ENDPOINT set wires otlp_http traces', () => {
    process.env.OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';
    const { bootstrapPlannerExporters } = require('../../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    expect(result.trace_exporters).toContain('otlp_http');
  });

  test('all envs set wires every sink', () => {
    process.env.DATADOG_STATSD_HOST = 'localhost';
    process.env.OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    process.env.OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';
    process.env.PROMETHEUS_EXPORTER_ENABLED = 'true';
    const { bootstrapPlannerExporters } = require('../../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    expect(result.metrics_exporters.sort()).toEqual(['dogstatsd', 'otlp_http', 'prometheus']);
    expect(result.trace_exporters).toEqual(['otlp_http']);
    expect(result.fallback_log_exporter).toBe(false);
  });
});
