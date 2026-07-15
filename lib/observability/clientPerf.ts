/**
 * HARDEN-001A — client (browser) performance foundation.
 *
 * Lightweight, env-disableable, best-effort collection of browser performance
 * signals that are batched and beaconed to the server observability layer. This
 * NEVER affects user interaction:
 *   - all work happens in passive PerformanceObserver callbacks / idle time,
 *   - every operation is wrapped in try/catch and silently no-ops on failure,
 *   - flushes use navigator.sendBeacon (non-blocking) on page-hide + idle ticks,
 *   - the whole module is inert unless NEXT_PUBLIC_OBSERVABILITY_CLIENT is on.
 *
 * Signals: page load, route transition, React render duration (opt-in via
 * markRender), LCP, FCP, interaction latency (Event Timing), long tasks, JS heap.
 */

type ClientKind =
  | 'pageLoad' | 'routeChange' | 'render'
  | 'lcp' | 'fcp' | 'interaction' | 'longTask' | 'heapUsed'
  | 'activation';

interface Sample { kind: ClientKind; value: number; route: string }

const ENDPOINT = '/api/observability/client';
const MAX_BUFFER = 100;          // hard cap: drop rather than grow unbounded
const FLUSH_IDLE_MS = 10_000;    // opportunistic flush cadence

let started = false;
let buffer: Sample[] = [];
const observers: PerformanceObserver[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function enabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    // W0-4 (Gate A): Web Vitals collection is ON BY DEFAULT. Explicit
    // NEXT_PUBLIC_OBSERVABILITY_CLIENT=0/false/off is the kill switch.
    // Collection is bounded (MAX_BUFFER cap, idle-flush beacons) and the
    // ingest endpoint records into the HARDEN-001 registry — no new system.
    return /^(1|true|yes|on)$/i.test(String(process.env.NEXT_PUBLIC_OBSERVABILITY_CLIENT ?? '1'));
  } catch { return false; }
}

function route(): string {
  try { return window.location.pathname || '/'; } catch { return '/'; }
}

function push(kind: ClientKind, value: number, r: string = route()): void {
  try {
    if (!Number.isFinite(value) || value < 0) return;
    if (buffer.length >= MAX_BUFFER) return; // bounded: never grow past the cap
    buffer.push({ kind, value: Math.round(value), route: r });
  } catch { /* fail-safe */ }
}

function flush(useBeacon = false): void {
  try {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const body = JSON.stringify({ samples: batch });
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    // keepalive fetch so an in-flight flush survives a tab close; never awaited.
    void fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch { /* fail-safe */ }
}

function observe(type: string, cb: (entries: PerformanceEntryList) => void): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return;
    // Some entry types aren't supported in every browser — guard each one.
    const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes;
    if (Array.isArray(supported) && !supported.includes(type)) return;
    const obs = new PerformanceObserver((list) => { try { cb(list.getEntries()); } catch { /* fail-safe */ } });
    obs.observe({ type, buffered: true } as PerformanceObserverInit);
    observers.push(obs);
  } catch { /* fail-safe */ }
}

/** Public: record a route transition duration (called from the router hook). */
export function markRouteChange(durationMs: number): void {
  if (!started) return;
  push('routeChange', durationMs);
}

/** Public: record a React render/commit duration (opt-in from a Profiler). */
export function markRender(durationMs: number, r?: string): void {
  if (!started) return;
  push('render', durationMs, r ?? route());
}

// PERF-002: record time-to-authenticated-interactive exactly ONCE per page load
// (performance.now() ≈ ms since navigation start). Idempotent so repeat auth
// events — TOKEN_REFRESHED, company switch — never pollute the metric.
let activationMarked = false;
export function markAuthActivation(): void {
  if (!started || activationMarked) return;
  activationMarked = true;
  try { push('activation', performance.now()); } catch { /* fail-safe */ }
}

/** Initialize once (idempotent). Safe to call on every mount. */
export function initClientPerf(): void {
  try {
    if (started || !enabled()) return;
    started = true;

    // Navigation timing → total page load.
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav && nav.duration > 0) push('pageLoad', nav.duration);
    } catch { /* fail-safe */ }

    // Paint timing → FCP.
    observe('paint', (entries) => {
      for (const e of entries) if (e.name === 'first-contentful-paint') push('fcp', e.startTime);
    });
    // Largest Contentful Paint (last reported value wins; report each candidate).
    observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) push('lcp', last.startTime);
    });
    // Long tasks (>50ms blocking the main thread).
    observe('longtask', (entries) => {
      for (const e of entries) push('longTask', e.duration);
    });
    // Interaction / event latency (first-input + slow events).
    observe('event', (entries) => {
      for (const e of entries) {
        const d = (e as PerformanceEntry & { duration: number }).duration;
        if (d > 0) push('interaction', d);
      }
    });

    // JS heap (Chromium-only, non-standard) sampled on flush cadence.
    const sampleHeap = () => {
      try {
        const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
        if (mem && typeof mem.usedJSHeapSize === 'number') push('heapUsed', mem.usedJSHeapSize);
      } catch { /* fail-safe */ }
    };

    // Opportunistic idle flush.
    flushTimer = setInterval(() => { sampleHeap(); flush(false); }, FLUSH_IDLE_MS);
    if (typeof flushTimer === 'object' && flushTimer && 'unref' in flushTimer) {
      (flushTimer as unknown as { unref: () => void }).unref?.();
    }

    // Guaranteed flush when the tab is hidden/closed (beacon, non-blocking).
    const onHide = () => { if (document.visibilityState === 'hidden') { sampleHeap(); flush(true); } };
    document.addEventListener('visibilitychange', onHide, { passive: true });
    window.addEventListener('pagehide', () => flush(true), { passive: true });
  } catch {
    // Never let instrumentation break the app.
    started = true;
  }
}
