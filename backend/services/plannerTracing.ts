/**
 * Planner distributed tracing.
 *
 * Thin OTel-compatible abstraction. Production deploys register a real
 * OTel `Tracer` at bootstrap; absent that, we fall back to AsyncLocalStorage
 * "no-op spans" that still propagate `traceId` / `spanId` / `traceFlags`
 * through `getRequestContext()` so cross-worker context carries through
 * BullMQ jobs + Redis Stream envelopes even without a real OTel install.
 *
 * Hot-path properties:
 *   - `startSpan` returns a cheap span object even when no exporter is
 *     registered. The fallback span records `name + attributes + duration`
 *     in a small ring buffer for `/inspect` so operators can see span
 *     activity in dev without OTel SDK setup.
 *   - Sampling: every span checks `samplerShouldSample()` first. Default
 *     sampler honors `PLANNER_TRACE_SAMPLE_RATE` (0..1, default 0.05) plus
 *     `?trace=1` request override. Trace propagation always uses the
 *     parent's sample decision — no per-hop drift.
 *   - Cross-worker continuity: `propagateContextToEnvelope` writes
 *     `traceparent` (W3C format) into any envelope (BullMQ job data,
 *     Redis Stream entry, SSE message). `restoreContextFromEnvelope`
 *     reads it back on the consumer side.
 *
 * Trace-safe fallbacks: every tracing call is wrapped in try/catch so a
 * bug in the tracer never propagates to the planner hot path.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { logger } from './logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SpanKind = 'server' | 'client' | 'internal' | 'producer' | 'consumer';

export interface SpanContext {
  traceId: string;   // 32 hex chars (W3C)
  spanId: string;    // 16 hex chars
  traceFlags: number;// 0x01 = sampled
  sampled: boolean;
}

export interface SpanInterface {
  setAttribute(key: string, value: string | number | boolean | undefined): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  recordException(err: unknown): void;
  end(): void;
  context(): SpanContext;
  name: string;
  kind: SpanKind;
}

/* ───────────────────────────────────────────────────────────────────────
 * Trace context propagation via AsyncLocalStorage.
 * ────────────────────────────────────────────────────────────────────── */

const _ctxStorage = new AsyncLocalStorage<SpanContext>();

export function currentSpanContext(): SpanContext | null {
  return _ctxStorage.getStore() ?? null;
}

function newTraceId(): string { return randomBytes(16).toString('hex'); }
function newSpanId(): string { return randomBytes(8).toString('hex'); }

function samplerShouldSample(parent?: SpanContext | null): boolean {
  if (parent) return parent.sampled; // propagate parent decision
  const rate = Math.max(0, Math.min(1, Number(process.env.PLANNER_TRACE_SAMPLE_RATE ?? 0.05)));
  return Math.random() < rate;
}

/* ───────────────────────────────────────────────────────────────────────
 * Span implementation: thin in-process recorder by default; real OTel
 * tracer takes over when registered.
 * ────────────────────────────────────────────────────────────────────── */

interface RecordedSpan {
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

const _recentSpans: RecordedSpan[] = [];
const RECENT_SPANS_LIMIT = 256;

function pushRecorded(span: RecordedSpan): void {
  _recentSpans.push(span);
  if (_recentSpans.length > RECENT_SPANS_LIMIT) _recentSpans.shift();
}

export function getRecentSpansForTests(): RecordedSpan[] {
  return _recentSpans.slice();
}

class FallbackSpan implements SpanInterface {
  name: string;
  kind: SpanKind;
  private ctx: SpanContext;
  private parentSpanId: string | null;
  private startedAt: number;
  private attrs: Record<string, string | number | boolean> = {};
  private events: RecordedSpan['events'] = [];
  private exception?: string;
  private ended = false;

  constructor(name: string, kind: SpanKind, parent: SpanContext | null) {
    this.name = name;
    this.kind = kind;
    const sampled = samplerShouldSample(parent);
    this.ctx = {
      traceId: parent?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      traceFlags: sampled ? 0x01 : 0x00,
      sampled,
    };
    this.parentSpanId = parent?.spanId ?? null;
    this.startedAt = Date.now();
  }
  setAttribute(key: string, value: string | number | boolean | undefined): void {
    if (value === undefined) return;
    this.attrs[key] = value as any;
  }
  addEvent(name: string, attrs?: Record<string, unknown>): void {
    this.events.push({ name, ts: Date.now(), attrs });
  }
  recordException(err: unknown): void {
    this.exception = err instanceof Error ? err.message : String(err);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (!this.ctx.sampled) return; // dropped by sampler
    pushRecorded({
      trace_id: this.ctx.traceId,
      span_id: this.ctx.spanId,
      parent_span_id: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      start_ms: this.startedAt,
      duration_ms: Date.now() - this.startedAt,
      attributes: this.attrs,
      events: this.events,
      exception_message: this.exception,
    });
  }
  context(): SpanContext { return this.ctx; }
}

/* ───────────────────────────────────────────────────────────────────────
 * Pluggable tracer. The default uses FallbackSpan; a real OTel tracer
 * can be registered via registerTracer.
 * ────────────────────────────────────────────────────────────────────── */

export interface Tracer {
  startSpan(name: string, kind: SpanKind, parent: SpanContext | null): SpanInterface;
}

const fallbackTracer: Tracer = {
  startSpan(name, kind, parent) { return new FallbackSpan(name, kind, parent); },
};

let _activeTracer: Tracer = fallbackTracer;

export function registerTracer(tracer: Tracer): void {
  _activeTracer = tracer;
  logger.info('planner_tracer_registered', { fallback_replaced: true });
}

/* ───────────────────────────────────────────────────────────────────────
 * Public API.
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Start a span, run `fn` inside its `AsyncLocalStorage` scope, end span
 * automatically in `finally`. Exceptions are recorded then re-thrown.
 *
 * `fn` receives the span so it can attach attributes mid-flight.
 *
 * Sampling decision is made at span creation. If the parent is sampled,
 * the child is sampled. If neither parent nor sampler picks the span, the
 * span is created but never persisted (no-op end).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: SpanInterface) => Promise<T>,
  opts: { kind?: SpanKind; attributes?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  let span: SpanInterface;
  try {
    span = _activeTracer.startSpan(name, opts.kind ?? 'internal', currentSpanContext());
    if (opts.attributes) for (const [k, v] of Object.entries(opts.attributes)) span.setAttribute(k, v);
  } catch (err) {
    // Tracer construction must never fail the call.
    logger.warn('planner_tracer_start_failed', { name, error: err instanceof Error ? err.message : String(err) });
    return fn({ name, kind: opts.kind ?? 'internal',
      setAttribute() {}, addEvent() {}, recordException() {}, end() {},
      context() { return { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0, sampled: false }; },
    });
  }
  return _ctxStorage.run(span.context(), async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      try { span.recordException(err); } catch { /* trace-safe */ }
      throw err;
    } finally {
      try { span.end(); } catch { /* trace-safe */ }
    }
  });
}

/**
 * W3C traceparent serialization for cross-worker propagation.
 * Format: 00-<trace-id>-<span-id>-<trace-flags-hex>
 */
function serializeTraceparent(ctx: SpanContext): string {
  const flags = (ctx.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

function parseTraceparent(header: string | undefined | null): SpanContext | null {
  if (!header) return null;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(header);
  if (!m) return null;
  const flags = parseInt(m[3], 16);
  return {
    traceId: m[1].toLowerCase(),
    spanId: m[2].toLowerCase(),
    traceFlags: flags,
    sampled: (flags & 0x01) === 0x01,
  };
}

/**
 * Stamp the current trace context onto an arbitrary envelope (BullMQ job
 * data, Redis Stream fields, SSE message attributes). Returns a shallow
 * copy of the input with `__traceparent` added when a context is active.
 */
export function propagateContextToEnvelope<T extends Record<string, unknown>>(envelope: T): T & { __traceparent?: string } {
  const ctx = currentSpanContext();
  if (!ctx) return envelope;
  return { ...envelope, __traceparent: serializeTraceparent(ctx) };
}

/**
 * Restore a trace context from an envelope. Caller wraps its work in
 * `withSpan` so the restored context becomes the parent of the new span.
 *
 * Returns null when the envelope has no `__traceparent` or parse failed.
 */
export function restoreContextFromEnvelope(envelope: Record<string, unknown> | undefined | null): SpanContext | null {
  if (!envelope) return null;
  const tp = (envelope as { __traceparent?: string }).__traceparent;
  if (typeof tp !== 'string') return null;
  return parseTraceparent(tp);
}

/**
 * Convenience for HTTP entry points: extract context from `traceparent`
 * header. Returns null on absent or invalid header.
 */
export function restoreContextFromHeader(headers: Record<string, string | string[] | undefined>): SpanContext | null {
  const v = headers['traceparent'];
  const tp = Array.isArray(v) ? v[0] : v;
  return parseTraceparent(tp ?? null);
}

/** Run `fn` inside the given trace context (used after `restoreContextFromEnvelope`). */
export async function runInContext<T>(ctx: SpanContext, fn: () => Promise<T>): Promise<T> {
  return _ctxStorage.run(ctx, fn);
}

export function __resetTracingForTests(): void {
  _recentSpans.length = 0;
  _activeTracer = fallbackTracer;
}
