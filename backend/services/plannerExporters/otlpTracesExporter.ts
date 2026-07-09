/**
 * OTLP/HTTP+JSON traces exporter.
 *
 * Bridges the in-process tracer (`backend/services/plannerTracing.ts`) to
 * any OTel-compatible trace backend:
 *   - OpenTelemetry Collector → fanout to Datadog APM, Honeycomb, Tempo, ...
 *   - Datadog Agent's OTel receiver (http://localhost:4318/v1/traces)
 *   - Jaeger 1.35+ (native OTLP at http://jaeger:4318/v1/traces)
 *   - Grafana Tempo
 *
 * Integration: the planner tracer keeps a 256-span ring buffer. We replace
 * the recorder with one that batches spans through this exporter. The
 * fallback in-process recorder remains the default — registering this
 * tracer is opt-in via env.
 *
 * Span kinds mapped to OTel:
 *   server   → SPAN_KIND_SERVER     (1)
 *   client   → SPAN_KIND_CLIENT     (3)
 *   producer → SPAN_KIND_PRODUCER   (4)
 *   consumer → SPAN_KIND_CONSUMER   (5)
 *   internal → SPAN_KIND_INTERNAL   (2) — default
 */

import { logger } from '../logger';
import { ExporterBatcher, retryWithBackoff } from './exporterBase';
import {
  registerTracer, type Tracer, type SpanInterface, type SpanContext, type SpanKind,
} from '../plannerTracing';
import { randomBytes } from 'crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface OtlpTracesConfig {
  endpoint: string;
  serviceName: string;
  resourceAttrs: Record<string, string>;
  headers: Record<string, string>;
  timeoutMs: number;
  /** Override sample rate (0..1). When absent, falls back to PLANNER_TRACE_SAMPLE_RATE. */
  sampleRate: number;
}

function readConfig(): OtlpTracesConfig | null {
  const endpoint = process.env.OTLP_TRACES_ENDPOINT;
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
  const sampleRate = Math.max(0, Math.min(1, Number(process.env.PLANNER_TRACE_SAMPLE_RATE ?? 0.05)));
  return { endpoint, serviceName, resourceAttrs, headers, timeoutMs: 5_000, sampleRate };
}

interface PendingSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: SpanKind;
  start_ms: number;
  duration_ms: number;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; ts: number; attrs?: Record<string, unknown> }>;
  exception_message?: string;
}

function spanKindToOtel(kind: SpanKind): number {
  switch (kind) { case 'server': return 1; case 'client': return 3; case 'producer': return 4; case 'consumer': return 5; default: return 2; }
}

function attributesToOtel(attrs: Record<string, string | number | boolean>): Array<{ key: string; value: any }> {
  return Object.entries(attrs).map(([key, value]) => {
    if (typeof value === 'number') return { key, value: { doubleValue: value } };
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    return { key, value: { stringValue: String(value) } };
  });
}

function pendingToOtel(spans: PendingSpan[], cfg: OtlpTracesConfig): unknown {
  return {
    resourceSpans: [{
      resource: {
        attributes: Object.entries(cfg.resourceAttrs).map(([k, v]) => ({ key: k, value: { stringValue: v } })),
      },
      scopeSpans: [{
        scope: { name: 'planner', version: '1' },
        spans: spans.map((s) => ({
          traceId: s.trace_id,
          spanId: s.span_id,
          parentSpanId: s.parent_span_id ?? undefined,
          name: s.name,
          kind: spanKindToOtel(s.kind),
          startTimeUnixNano: String(BigInt(s.start_ms) * 1_000_000n),
          endTimeUnixNano: String(BigInt(s.start_ms + s.duration_ms) * 1_000_000n),
          attributes: attributesToOtel(s.attributes),
          events: s.events.map((e) => ({
            timeUnixNano: String(BigInt(e.ts) * 1_000_000n),
            name: e.name,
            attributes: e.attrs ? attributesToOtel(e.attrs as any) : [],
          })),
          status: s.exception_message
            ? { code: 2, message: s.exception_message } // STATUS_CODE_ERROR
            : { code: 1 },                              // STATUS_CODE_OK
        })),
      }],
    }],
  };
}

/**
 * Exporting Tracer implementation. Wraps each span so `end()` enqueues
 * it on the batcher. Sampling is honored at span creation: dropped spans
 * never enter the batcher.
 */
class OtlpTracer implements Tracer {
  private batcher: ExporterBatcher<PendingSpan>;
  private cfg: OtlpTracesConfig;

  constructor(cfg: OtlpTracesConfig) {
    this.cfg = cfg;
    this.batcher = new ExporterBatcher<PendingSpan>({
      exporterName: 'otlp_http',
      kind: 'traces',
      maxQueueSize: 4_096,
      flushBatchSize: 128,
      flushIntervalMs: 5_000,
      flush: async (spans) => {
        const body = JSON.stringify(pendingToOtel(spans, cfg));
        const sent = await retryWithBackoff(async () => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), cfg.timeoutMs);
          try {
            // ssrf-ok: cfg.endpoint is an operator-configured OTLP collector
            const res = await fetch(cfg.endpoint, {
              method: 'POST', headers: cfg.headers, body, signal: controller.signal,
            });
            if (!res.ok && res.status !== 202 && res.status !== 204) {
              const text = await res.text().catch(() => '');
              throw new Error(`OTLP traces HTTP ${res.status}: ${text.slice(0, 200)}`);
            }
            return true;
          } finally { clearTimeout(t); }
        }, {
          maxAttempts: 3,
          isRetryable: (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            return /HTTP 5\d\d/.test(msg) || /HTTP 429/.test(msg) || msg.toLowerCase().includes('network') || msg.includes('ETIMEDOUT') || msg.includes('aborted');
          },
        });
        if (sent === null) throw new Error('OTLP traces export exhausted retries');
      },
    });
  }

  startSpan(name: string, kind: SpanKind, parent: SpanContext | null): SpanInterface {
    const sampled = parent ? parent.sampled : Math.random() < this.cfg.sampleRate;
    const traceId = parent?.traceId ?? randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const ctx: SpanContext = {
      traceId, spanId,
      traceFlags: sampled ? 0x01 : 0x00,
      sampled,
    };
    const startedAt = Date.now();
    const attrs: Record<string, string | number | boolean> = {};
    const events: PendingSpan['events'] = [];
    let exception: string | undefined;
    let ended = false;
    const batcher = this.batcher;
    const parentSpanId = parent?.spanId ?? null;

    return {
      name, kind,
      setAttribute(k, v) { if (v !== undefined) attrs[k] = v as any; },
      addEvent(n, a) { events.push({ name: n, ts: Date.now(), attrs: a }); },
      recordException(err) { exception = err instanceof Error ? err.message : String(err); },
      end() {
        if (ended) return; ended = true;
        if (!sampled) return;
        const pending: PendingSpan = {
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          name, kind,
          start_ms: startedAt,
          duration_ms: Date.now() - startedAt,
          attributes: attrs,
          events,
          exception_message: exception,
        };
        batcher.enqueue(pending);
      },
      context() { return ctx; },
    };
  }
}

/**
 * Register the OTLP tracer. Idempotent — registering twice replaces the
 * previous registration. Returns null when env config is missing.
 */
export function registerOtlpTracer(): { registered: boolean; reason?: string } {
  const cfg = readConfig();
  if (!cfg) return { registered: false, reason: 'no_endpoint_configured' };
  const tracer = new OtlpTracer(cfg);
  registerTracer(tracer);
  logger.info('planner_exporter_otlp_traces_started', {
    endpoint: cfg.endpoint, service_name: cfg.serviceName, sample_rate: cfg.sampleRate,
  });
  return { registered: true };
}
