/**
 * Phase 2 — Thread runtime client transport.
 *
 * Browser-side buffered queue that flushes batched trace events to the
 * server-side `/api/threadRuntime/trace` endpoint. Designed to be
 * resilient against:
 *   - tab refresh / navigation (flush on `pagehide` / `beforeunload`)
 *   - network blips (exponential backoff retries)
 *   - tab crashes (events buffered in localStorage as a last resort)
 *   - reconnects (queue drains when connection returns)
 *
 * Event IDs are generated client-side. The server endpoint dedupes per
 * `eventId`, so retried batches are idempotent.
 *
 * Pure browser code; safe in any client component. Exports a singleton
 * via `getDefaultThreadRuntimeClientTransport()`.
 */

import type { ThreadRuntimeTraceEvent } from './threadRuntimeTypes';

const LOCAL_STORAGE_KEY = 'omnivyra:thread-runtime-trace-queue:v1';
const DEFAULT_ENDPOINT = '/api/threadRuntime/trace';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_QUEUE = 1_000;

export interface ThreadRuntimeClientTransportOptions {
  endpoint?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxQueueSize?: number;
  /** Disable localStorage persistence (defaults to enabled when window.localStorage exists). */
  disableLocalStorage?: boolean;
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
}

export interface ThreadRuntimeClientTransport {
  enqueue(event: ThreadRuntimeTraceEvent): void;
  flush(): Promise<{ accepted: number; duplicate: number; rejected: number } | null>;
  drainOnUnload(): void;
  queueSize(): number;
  clear(): void;
  /** Test-only: install/remove DOM event hooks. */
  attachLifecycleHooks(): void;
  detachLifecycleHooks(): void;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

function safeLocalStorageGet(key: string): string | null {
  try { return typeof window !== 'undefined' ? window.localStorage?.getItem(key) ?? null : null; }
  catch { return null; }
}
function safeLocalStorageSet(key: string, value: string): void {
  try { window.localStorage?.setItem(key, value); } catch { /* quota / privacy mode — ignore */ }
}
function safeLocalStorageRemove(key: string): void {
  try { window.localStorage?.removeItem(key); } catch { /* ignore */ }
}

export function createThreadRuntimeClientTransport(options?: ThreadRuntimeClientTransportOptions): ThreadRuntimeClientTransport {
  const endpoint = options?.endpoint ?? DEFAULT_ENDPOINT;
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  const flushIntervalMs = Math.max(500, options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
  const initialBackoffMs = Math.max(100, options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS);
  const maxQueue = Math.max(50, options?.maxQueueSize ?? DEFAULT_MAX_QUEUE);
  const disableLocalStorage = options?.disableLocalStorage ?? false;
  const doFetch = options?.fetchImpl ?? (isBrowser() ? window.fetch.bind(window) : undefined);

  let queue: ThreadRuntimeTraceEvent[] = [];
  let inFlight: ThreadRuntimeTraceEvent[] = [];
  let flushing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lifecycleHandlers: { event: string; handler: EventListener }[] = [];

  // Restore queue from localStorage on construction (tab crash recovery).
  if (isBrowser() && !disableLocalStorage) {
    const persisted = safeLocalStorageGet(LOCAL_STORAGE_KEY);
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted) as ThreadRuntimeTraceEvent[];
        if (Array.isArray(parsed)) queue = parsed.slice(-maxQueue);
      } catch { /* corrupt — drop */ }
    }
  }

  function persistQueue(): void {
    if (!isBrowser() || disableLocalStorage) return;
    if (queue.length + inFlight.length === 0) {
      safeLocalStorageRemove(LOCAL_STORAGE_KEY);
      return;
    }
    // Persist queue + inFlight (anything not yet acknowledged by server).
    const snapshot = [...inFlight, ...queue].slice(-maxQueue);
    try {
      safeLocalStorageSet(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
    } catch { /* over quota — accept loss */ }
  }

  async function flushOnce(): Promise<{ accepted: number; duplicate: number; rejected: number } | null> {
    if (flushing || !doFetch || (queue.length === 0 && inFlight.length === 0)) return null;
    flushing = true;
    try {
      // Move up to batchSize events from queue into inFlight.
      if (inFlight.length === 0) {
        inFlight = queue.splice(0, batchSize);
      }
      if (inFlight.length === 0) return null;

      let attempt = 0;
      let lastError: Error | null = null;
      while (attempt <= maxRetries) {
        try {
          const response = await doFetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: inFlight }),
          });
          if (response.ok) {
            const data = await response.json().catch(() => ({})) as { accepted?: number; duplicate?: number; rejected?: number };
            inFlight = [];
            persistQueue();
            return { accepted: data.accepted ?? 0, duplicate: data.duplicate ?? 0, rejected: data.rejected ?? 0 };
          }
          if (response.status === 401 || response.status === 403) {
            // Permanent auth failure — drop the batch and stop retrying.
            inFlight = [];
            persistQueue();
            return null;
          }
          if (response.status === 413) {
            // Payload too large — drop oldest half to recover.
            const half = Math.floor(inFlight.length / 2);
            inFlight = inFlight.slice(-half);
            // proceed to retry with smaller batch
          }
          lastError = new Error(`HTTP ${response.status}`);
        } catch (err) {
          lastError = err as Error;
        }
        attempt += 1;
        if (attempt <= maxRetries) {
          const backoff = initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      // All retries exhausted: put inFlight back on the queue head for next time.
      queue = [...inFlight, ...queue].slice(-maxQueue);
      inFlight = [];
      persistQueue();
      if (lastError) {
        // Hint operators in the console without spamming.
        try { console.warn(`[threadRuntime.clientTransport] flush failed after ${attempt} retries: ${lastError.message}`); }
        catch { /* node test env may shim console — ignore */ }
      }
      return null;
    } finally {
      flushing = false;
    }
  }

  const transport: ThreadRuntimeClientTransport = {
    enqueue(event) {
      queue.push(event);
      while (queue.length + inFlight.length > maxQueue) queue.shift();
      persistQueue();
    },
    async flush() {
      const r1 = await flushOnce();
      // Drain successive batches until queue empties OR a flush returns no progress.
      let r = r1;
      while (queue.length > 0) {
        const next = await flushOnce();
        if (!next) break;
        r = next;
      }
      return r;
    },
    drainOnUnload() {
      // Best-effort synchronous beacon flush. sendBeacon won't return acks
      // but does deliver the payload before the tab dies.
      if (!isBrowser()) return;
      const batch = [...inFlight, ...queue].slice(0, batchSize);
      if (batch.length === 0) return;
      try {
        const body = JSON.stringify({ events: batch });
        const blob = new Blob([body], { type: 'application/json' });
        // navigator.sendBeacon is the only reliable transport during pagehide.
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const sent = navigator.sendBeacon(endpoint, blob);
          if (sent) {
            // Optimistically consider these flushed for localStorage purposes.
            // The server-side dedup keeps us safe if they're retried on next load.
            inFlight = [];
            queue = queue.slice(batch.length);
            persistQueue();
          }
        }
      } catch {
        /* unload phase — anything we can't do here is acceptable loss */
      }
    },
    queueSize() {
      return queue.length + inFlight.length;
    },
    clear() {
      queue = [];
      inFlight = [];
      persistQueue();
    },
    attachLifecycleHooks() {
      if (!isBrowser() || timer !== null) return;
      timer = setInterval(() => { void transport.flush(); }, flushIntervalMs);
      const pagehide = () => transport.drainOnUnload();
      const beforeunload = () => transport.drainOnUnload();
      const visibilityChange = () => { if (document.visibilityState === 'hidden') transport.drainOnUnload(); };
      window.addEventListener('pagehide', pagehide);
      window.addEventListener('beforeunload', beforeunload);
      document.addEventListener('visibilitychange', visibilityChange);
      lifecycleHandlers.push({ event: 'pagehide', handler: pagehide });
      lifecycleHandlers.push({ event: 'beforeunload', handler: beforeunload });
      lifecycleHandlers.push({ event: 'visibilitychange', handler: visibilityChange });
    },
    detachLifecycleHooks() {
      if (timer !== null) { clearInterval(timer); timer = null; }
      if (!isBrowser()) return;
      for (const h of lifecycleHandlers) {
        if (h.event === 'visibilitychange') {
          document.removeEventListener(h.event, h.handler);
        } else {
          window.removeEventListener(h.event, h.handler);
        }
      }
      lifecycleHandlers = [];
    },
  };

  return transport;
}

let _default: ThreadRuntimeClientTransport | null = null;

export function getDefaultThreadRuntimeClientTransport(options?: ThreadRuntimeClientTransportOptions): ThreadRuntimeClientTransport {
  if (!_default) {
    _default = createThreadRuntimeClientTransport(options);
    if (isBrowser()) _default.attachLifecycleHooks();
  }
  return _default;
}

export function resetDefaultThreadRuntimeClientTransport(): void {
  if (_default) _default.detachLifecycleHooks();
  _default = null;
}
