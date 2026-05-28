/**
 * Shared exporter infrastructure.
 *
 * Every metric/trace exporter needs the same scaffolding:
 *   - bounded in-memory queue (drop-on-overflow with telemetry signal)
 *   - batched flush (size OR time triggered, whichever fires first)
 *   - retry with exponential backoff for transient failures
 *   - silent-fast on permanent failures so the planner is never blocked
 *   - per-exporter health metrics so dashboards can spot stuck exporters
 *
 * This file provides:
 *   - `ExporterBatcher<T>`: enqueue items, flush in batches via callback
 *   - `withExporterHealth`: instrument a flush function with success /
 *     dropped / lag counters via the existing telemetry registry
 *   - `retryWithBackoff`: small helper for HTTP-style retry on 429/5xx
 */

import { counter, gauge, histogramMs } from '../plannerTelemetry';
import { logger } from '../logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type ExporterKind = 'metrics' | 'traces';

export interface BatcherOptions {
  /** Operator-facing exporter name, e.g. 'dogstatsd' / 'otlp_http'. Used as a metric label. */
  exporterName: string;
  /** 'metrics' | 'traces'. */
  kind: ExporterKind;
  /** Max items held in memory. Past this, new items are DROPPED (NOT blocking). */
  maxQueueSize: number;
  /** Flush when this many items are queued. */
  flushBatchSize: number;
  /** Flush at this cadence regardless of size. */
  flushIntervalMs: number;
  /** Per-flush callback — exporter does the actual network I/O here. */
  flush: (items: any[]) => Promise<void>;
}

/**
 * Bounded queue + scheduled flush. Producers are non-blocking — if the
 * queue is full, the item is dropped and `planner_exporter_dropped_total`
 * is incremented. Flushes happen in the background; producers never await.
 */
export class ExporterBatcher<T> {
  private queue: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private opts: BatcherOptions;

  constructor(opts: BatcherOptions) {
    this.opts = opts;
    this.timer = setInterval(() => { void this.flush('timer'); }, Math.max(500, opts.flushIntervalMs));
    try { (this.timer as any).unref?.(); } catch { /* noop */ }
  }

  enqueue(item: T): void {
    if (this.queue.length >= this.opts.maxQueueSize) {
      counter('planner_exporter_dropped_total', 1, {
        exporter: this.opts.exporterName, kind: this.opts.kind, reason: 'queue_full',
      });
      return;
    }
    this.queue.push(item);
    if (this.queue.length >= this.opts.flushBatchSize) {
      // Drain on next tick so producer returns immediately.
      setImmediate(() => { void this.flush('size'); });
    }
  }

  async flush(_trigger: 'timer' | 'size' | 'shutdown'): Promise<void> {
    if (this.flushing) return;
    if (this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, Math.min(this.queue.length, this.opts.flushBatchSize * 2));
    const startedAt = Date.now();
    try {
      histogramMs('planner_exporter_batch_size', batch.length, {
        exporter: this.opts.exporterName, kind: this.opts.kind,
      });
      await this.opts.flush(batch as any[]);
      counter('planner_exporter_export_total', 1, {
        exporter: this.opts.exporterName, kind: this.opts.kind, result: 'success',
      });
    } catch (err) {
      const isTimeout = (err as { code?: string })?.code === 'ETIMEDOUT' || /timeout/i.test((err as Error)?.message ?? '');
      counter('planner_exporter_export_total', 1, {
        exporter: this.opts.exporterName, kind: this.opts.kind,
        result: isTimeout ? 'timeout' : 'network_error',
      });
      // Drop the batch — retry would inflate queue past cap. The retry
      // helper inside the exporter's flush callback can handle short
      // transients; persistent failures are observable via the counter.
      counter('planner_exporter_dropped_total', batch.length, {
        exporter: this.opts.exporterName, kind: this.opts.kind,
        reason: isTimeout ? 'flush_timeout' : 'flush_error',
      });
      logger.warn('planner_exporter_flush_failed', {
        exporter: this.opts.exporterName, kind: this.opts.kind,
        batch_size: batch.length, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      histogramMs('planner_exporter_lag_ms', Date.now() - startedAt, {
        exporter: this.opts.exporterName, kind: this.opts.kind,
      });
      gauge('planner_exporter_queue_depth' as never, this.queue.length, {
        exporter: this.opts.exporterName, kind: this.opts.kind,
      });
      this.flushing = false;
    }
  }

  /** Stop the scheduled timer + flush remaining items. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.flush('shutdown');
  }

  queueDepth(): number { return this.queue.length; }
}

/**
 * Retry an HTTP-style operation up to `maxAttempts` times with exponential
 * backoff. Returns null after exhaustion — callers should treat null as a
 * permanent drop. NEVER throws.
 *
 * Backoff: 100ms, 200ms, 400ms ... capped at 2s. Random jitter added.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; isRetryable?: (err: unknown) => boolean } = {},
): Promise<T | null> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts.isRetryable ? opts.isRetryable(err) : true;
      if (!retryable || i === maxAttempts - 1) break;
      const base = Math.min(2000, 100 * Math.pow(2, i));
      const jitter = Math.random() * 100;
      await sleep(base + jitter);
    }
  }
  // Final failure is the caller's responsibility to record via the
  // exporter-health metric set; we just return null.
  void lastErr;
  return null;
}
