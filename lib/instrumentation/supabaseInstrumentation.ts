/**
 * Supabase instrumentation — tracks DB reads, writes, errors, and latency.
 *
 * This module only owns counters and snapshot logic.
 * Fetch interception is handled exclusively by fetchInstrumentation.ts,
 * which calls recordSupabaseCall() here.  There is NO globalThis.fetch patch
 * in this file — that design caused double-counting when two modules each
 * wrapped fetch independently.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let reads        = 0;
let writes       = 0;
let errors       = 0;
let bytesIn      = 0;
const readLatency: number[]  = [];
const writeLatency: number[] = [];
const opTimeline: number[]   = [];
const OPS_WINDOW = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupabaseMetrics {
  reads:           number;
  writes:          number;
  errors:          number;
  queriesPerMin:   number;
  avgReadLatency:  number | null;
  avgWriteLatency: number | null;
  estimatedBytesIn: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function pushLatency(arr: number[], ms: number): void {
  arr.push(ms);
  if (arr.length > 200) arr.shift();
}

function average(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function tickOp(): void {
  const now = Date.now();
  opTimeline.push(now);
  let i = 0;
  while (i < opTimeline.length && opTimeline[i] < now - OPS_WINDOW) i++;
  if (i > 0) opTimeline.splice(0, i);
}

// ── Public recorder (called by fetchInstrumentation.ts) ───────────────────────

/**
 * Record one Supabase HTTP call.  Called by the unified fetch interceptor —
 * never call this directly from application code.
 */
export function recordSupabaseCall(
  isWrite: boolean,
  latencyMs: number,
  ok: boolean,
  contentLength: number,
): void {
  if (ok) {
    tickOp();
    if (isWrite) { writes++; pushLatency(writeLatency, latencyMs); }
    else          { reads++;  pushLatency(readLatency,  latencyMs); }
  } else {
    errors++;
  }
  if (contentLength > 0) bytesIn += contentLength;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function getSupabaseMetrics(): SupabaseMetrics {
  return {
    reads,
    writes,
    errors,
    queriesPerMin:   opTimeline.filter(t => t >= Date.now() - OPS_WINDOW).length,
    avgReadLatency:  average(readLatency),
    avgWriteLatency: average(writeLatency),
    estimatedBytesIn: bytesIn,
  };
}

export function resetSupabaseMetrics(): void {
  reads = 0; writes = 0; errors = 0; bytesIn = 0;
  readLatency.length  = 0;
  writeLatency.length = 0;
  opTimeline.length   = 0;
}
