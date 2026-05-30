/**
 * Variant Performance Telemetry (Phase 8 — production hardening).
 *
 * Bounded in-memory ring buffer that records duration samples for
 * the five operational variant flows:
 *
 *   - generation       (per-asset POST to /api/command-center/creator-content/generate)
 *   - fan_out          (parallel batch of N generations)
 *   - planner          (POST to /api/creator-intelligence/variant-execution-plan)
 *   - winner_engine    (detectVariantWinner per strategy)
 *   - analytics_query  (aggregateStrategyPerformance + leaderboards)
 *
 * Pure record-only — no behavior change. The diagnostics endpoint
 * reads from this buffer; downstream callers fire `time()` helpers
 * to record durations without coupling business logic.
 *
 * Caps:
 *   - 200 samples per category (rolling)
 *   - 5 categories total
 *
 * Memory footprint: ~5 KB max.
 */

export type VariantTelemetryCategory =
  | 'generation'
  | 'fan_out'
  | 'planner'
  | 'winner_engine'
  | 'analytics_query';

const CATEGORIES: ReadonlyArray<VariantTelemetryCategory> = [
  'generation', 'fan_out', 'planner', 'winner_engine', 'analytics_query',
];

const MAX_SAMPLES_PER_CATEGORY = 200;

type Sample = {
  durationMs: number;
  ok: boolean;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

const buffers = new Map<VariantTelemetryCategory, Sample[]>();
for (const cat of CATEGORIES) buffers.set(cat, []);

/**
 * Record a single duration sample. Pushed onto the category's
 * bounded ring buffer; the oldest sample drops when the cap is hit.
 *
 * Safe to call from hot paths — synchronous append, no I/O.
 */
export function recordVariantTimingSample(
  category: VariantTelemetryCategory,
  durationMs: number,
  ok = true,
  metadata?: Record<string, unknown>,
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const buf = buffers.get(category);
  if (!buf) return;
  buf.push({
    durationMs,
    ok,
    occurredAt: new Date().toISOString(),
    metadata,
  });
  if (buf.length > MAX_SAMPLES_PER_CATEGORY) {
    buf.splice(0, buf.length - MAX_SAMPLES_PER_CATEGORY);
  }
}

/**
 * Convenience wrapper. Times the awaited callback and records the
 * resulting duration. Errors are re-thrown after recording the
 * sample with `ok=false`.
 */
export async function timeVariantOperation<T>(
  category: VariantTelemetryCategory,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    const result = await fn();
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    recordVariantTimingSample(category, end - start, true, metadata);
    return result;
  } catch (err) {
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    recordVariantTimingSample(category, end - start, false, metadata);
    throw err;
  }
}

/* ── Read-side helpers ────────────────────────────────────────── */

export type CategorySummary = {
  category: VariantTelemetryCategory;
  sampleCount: number;
  okCount: number;
  failureCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  recentMs: number | null;
  lastSampleAt: string | null;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * (p / 100)));
  return sorted[idx];
}

export function summarizeCategory(category: VariantTelemetryCategory): CategorySummary {
  const buf = buffers.get(category) ?? [];
  const sampleCount = buf.length;
  if (sampleCount === 0) {
    return {
      category,
      sampleCount: 0,
      okCount: 0,
      failureCount: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      recentMs: null,
      lastSampleAt: null,
    };
  }
  const durations = buf.map((s) => s.durationMs).sort((a, b) => a - b);
  const okCount = buf.filter((s) => s.ok).length;
  const last = buf[buf.length - 1];
  return {
    category,
    sampleCount,
    okCount,
    failureCount: sampleCount - okCount,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations[durations.length - 1] ?? null,
    recentMs: last.durationMs,
    lastSampleAt: last.occurredAt,
  };
}

export function summarizeAllCategories(): CategorySummary[] {
  return CATEGORIES.map((c) => summarizeCategory(c));
}

/* ── Test surface ─────────────────────────────────────────────── */

export function clearVariantTelemetry(): void {
  for (const cat of CATEGORIES) buffers.set(cat, []);
}

export function variantTelemetryStats(): { categoryCount: number; maxSamplesPerCategory: number } {
  return { categoryCount: CATEGORIES.length, maxSamplesPerCategory: MAX_SAMPLES_PER_CATEGORY };
}
