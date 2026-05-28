/**
 * Phase 2 — Persistent runtime trace writer.
 *
 * Bridges between the in-process trace registry and the persistent store.
 * Each application instance owns a writer; it batches events from the
 * local registry, retries with exponential backoff on transient failures,
 * and respects backpressure (queue cap).
 *
 * Multiple application instances writing into one canonical
 * PersistentTraceStore is the unit of distribution — the store (e.g. a
 * Supabase table) deduplicates on eventId, so concurrent writes from N
 * instances converge to one canonical event history.
 *
 * All errors are swallowed and logged. Writer failure must never break
 * the application that owns it.
 */

import type {
  PersistedRuntimeEvent,
  ThreadRuntimeTransitionType,
} from './threadRuntimeTypes';
import type {
  ThreadRuntimeTraceEvent,
} from './threadRuntimeTypes';
import {
  getDefaultPersistentTraceStore,
  type PersistentTraceStore,
} from './persistentTraceStore';

const CURRENT_REPLAY_VERSION = 1;

const SEVERITY_FOR_TYPE: Partial<Record<ThreadRuntimeTransitionType, PersistedRuntimeEvent['severity']>> = {
  persist_failure:   'high',
  join_failure:      'high',
  recovery_failure:  'critical',
  refresh_observed:  'low',
  recovery_attempt:  'medium',
  recovery_success:  'low',
  persist_attempt:   'info',
  persist_success:   'info',
  join_attempt:      'info',
  join_success:      'info',
  node_create:       'info',
  node_edit:         'info',
  node_reorder:      'info',
  session_start:     'info',
  session_end:       'info',
};

export interface PersistentRuntimeTraceWriterOptions {
  store?: PersistentTraceStore;
  /** Max events buffered before backpressure rejection (default 5000). */
  maxQueue?: number;
  /** Events per flush (default 100). */
  batchSize?: number;
  /** Flush interval (default 2s). */
  flushIntervalMs?: number;
  /** Retry caps. */
  maxRetries?: number;
  initialBackoffMs?: number;
  /** Source surface attribution. Defaults to 'unknown'. */
  sourceSurface?: PersistedRuntimeEvent['sourceSurface'];
}

export interface PersistentRuntimeTraceWriter {
  /** Project an in-process event to a persisted shape and enqueue. */
  enqueue(input: { event: ThreadRuntimeTraceEvent; correlationId?: string | null; sourceSurface?: PersistedRuntimeEvent['sourceSurface'] }): void;
  /** Drain the queue immediately. */
  flush(): Promise<{ accepted: number; duplicate: number; rejected: number; remaining: number }>;
  start(): void;
  stop(): void;
  queueSize(): number;
  drainOnShutdown(): Promise<void>;
}

export function createPersistentRuntimeTraceWriter(options?: PersistentRuntimeTraceWriterOptions): PersistentRuntimeTraceWriter {
  const store = options?.store ?? getDefaultPersistentTraceStore();
  const maxQueue = Math.max(100, options?.maxQueue ?? 5000);
  const batchSize = Math.max(10, options?.batchSize ?? 100);
  const flushIntervalMs = Math.max(250, options?.flushIntervalMs ?? 2000);
  const maxRetries = Math.max(0, options?.maxRetries ?? 4);
  const initialBackoffMs = Math.max(50, options?.initialBackoffMs ?? 250);
  const defaultSurface = options?.sourceSurface ?? 'unknown';

  let queue: PersistedRuntimeEvent[] = [];
  let inFlight: PersistedRuntimeEvent[] = [];
  let flushing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let backpressureDropped = 0;

  function project(input: { event: ThreadRuntimeTraceEvent; correlationId?: string | null; sourceSurface?: PersistedRuntimeEvent['sourceSurface'] }): PersistedRuntimeEvent {
    return {
      eventId: input.event.eventId,
      runtimeSessionId: input.event.runtimeSessionId,
      threadId: input.event.threadId,
      companyId: '', // overridden below via correlation if available
      orchestrationSequence: input.event.orchestrationSequence,
      eventType: input.event.transitionType,
      severity: SEVERITY_FOR_TYPE[input.event.transitionType] ?? 'info',
      timestamp: input.event.timestamp,
      payloadJson: {
        parentNodeId: input.event.parentNodeId,
        childNodeIds: input.event.childNodeIds,
        nodeGenerationMode: input.event.nodeGenerationMode,
        latencyMs: input.event.latencyMs ?? null,
        detail: input.event.detail ?? null,
        extra: input.event.payload ?? null,
      },
      sourceSurface: input.sourceSurface ?? defaultSurface,
      correlationId: input.correlationId ?? null,
      replayVersion: CURRENT_REPLAY_VERSION,
    };
  }

  async function flushOnce(): Promise<{ accepted: number; duplicate: number; rejected: number; remaining: number } | null> {
    if (flushing || (queue.length === 0 && inFlight.length === 0)) return null;
    flushing = true;
    try {
      if (inFlight.length === 0) inFlight = queue.splice(0, batchSize);
      if (inFlight.length === 0) return null;

      let attempt = 0;
      let lastErr: Error | null = null;
      while (attempt <= maxRetries) {
        try {
          const result = await store.appendBatch(inFlight);
          inFlight = [];
          return { accepted: result.accepted, duplicate: result.duplicate, rejected: result.rejected, remaining: queue.length };
        } catch (err) {
          lastErr = err as Error;
        }
        attempt += 1;
        if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, initialBackoffMs * Math.pow(2, attempt - 1)));
      }
      // Retries exhausted; push events back to queue head.
      queue = [...inFlight, ...queue].slice(-maxQueue);
      inFlight = [];
      if (lastErr) {
        try { console.warn(`[threadRuntime.persistentWriter] flush failed after ${attempt} retries: ${lastErr.message}`); }
        catch { /* ignore */ }
      }
      return null;
    } finally {
      flushing = false;
    }
  }

  const writer: PersistentRuntimeTraceWriter = {
    enqueue(input) {
      const projected = project(input);
      // companyId is required for the store; if the registry event didn't
      // carry it we leave the placeholder empty and the store will reject.
      // Live callers should plumb companyId via the correlation / wrapper.
      projected.companyId = (input.event.payload as { companyId?: string } | undefined)?.companyId ?? projected.companyId;
      queue.push(projected);
      while (queue.length + inFlight.length > maxQueue) {
        queue.shift();
        backpressureDropped += 1;
      }
    },
    async flush() {
      let acc = 0, dup = 0, rej = 0;
      // Drain until queue empty or flushOnce returns no progress.
      while (queue.length > 0 || inFlight.length > 0) {
        const r = await flushOnce();
        if (!r) break;
        acc += r.accepted; dup += r.duplicate; rej += r.rejected;
        if (r.remaining === 0) break;
      }
      return { accepted: acc, duplicate: dup, rejected: rej, remaining: queue.length + inFlight.length };
    },
    start() {
      if (timer !== null) return;
      timer = setInterval(() => { void this.flush(); }, flushIntervalMs);
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
    queueSize() { return queue.length + inFlight.length; },
    async drainOnShutdown() {
      this.stop();
      await this.flush();
    },
  };
  // Expose backpressure counter for diagnostics.
  Object.defineProperty(writer, 'backpressureDroppedCount', {
    get: () => backpressureDropped,
  });
  return writer;
}

// ─── Helper: bridge a registry event into a writer in one call ─────────

export interface WriterBridgeInput {
  writer: PersistentRuntimeTraceWriter;
  event: ThreadRuntimeTraceEvent;
  companyId: string;
  correlationId?: string | null;
  sourceSurface?: PersistedRuntimeEvent['sourceSurface'];
}

export function bridgeRegistryEventIntoWriter(input: WriterBridgeInput): void {
  // Embed companyId into payload because TraceRegistry events don't carry
  // it natively (they carry it on the trace, not on each event).
  const event: ThreadRuntimeTraceEvent = {
    ...input.event,
    payload: { ...(input.event.payload ?? {}), companyId: input.companyId },
  };
  input.writer.enqueue({ event, correlationId: input.correlationId ?? null, sourceSurface: input.sourceSurface });
}

let _default: PersistentRuntimeTraceWriter | null = null;
export function getDefaultPersistentRuntimeTraceWriter(): PersistentRuntimeTraceWriter {
  if (!_default) _default = createPersistentRuntimeTraceWriter();
  return _default;
}
export function setDefaultPersistentRuntimeTraceWriter(w: PersistentRuntimeTraceWriter): void {
  _default = w;
}
