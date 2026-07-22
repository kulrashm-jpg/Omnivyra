/**
 * Writer Wave 3 — AI Runtime Consolidation: RUNTIME OBSERVABILITY.
 *
 * Fail-safe wrappers over the existing HARDEN-001 observability framework
 * (backend/observability/metrics.ts → registry). Every function here is a
 * no-op-on-failure wrapper: it NEVER throws, so emitting a metric can never
 * break a generation. When the observability domain is disabled the underlying
 * recorders are already no-ops (they check observabilityConfig), so this layer
 * simply forwards through the shared, bounded registry.
 *
 * Metric names (single source of truth) — all under the `runtime.*` namespace:
 *   runtime.latency_ms          — end-to-end runtime.generate() wall time
 *   runtime.model_latency_ms    — time spent in the master-generation call(s)
 *   runtime.retries             — transient/provider/timeout retries consumed
 *   runtime.cache_hits          — result-cache hits (none this wave; wired for later)
 *   runtime.cache_misses        — result-cache misses
 *   runtime.provider_selection  — which model/provider the task policy chose
 *   runtime.failures            — best-effort (post-generation) stage failures
 *   runtime.token_usage         — total tokens consumed by generation (when known)
 *   runtime.originality_time_ms — time spent in the originality gate
 *   runtime.persistence_time_ms — time spent persisting the accepted generation
 */

import {
  recordRawCounter,
  recordRawHistogram,
  type Labels,
} from '../../../observability/metrics';

/** Canonical runtime metric names. */
export const RUNTIME_METRIC = {
  latency: 'runtime.latency_ms',
  modelLatency: 'runtime.model_latency_ms',
  retries: 'runtime.retries',
  cacheHits: 'runtime.cache_hits',
  cacheMisses: 'runtime.cache_misses',
  providerSelection: 'runtime.provider_selection',
  failures: 'runtime.failures',
  tokenUsage: 'runtime.token_usage',
  originalityTime: 'runtime.originality_time_ms',
  persistenceTime: 'runtime.persistence_time_ms',
} as const;

// ── fail-safe primitives (never throw) ───────────────────────────────────────

function safeObserve(name: string, value: number, labels?: Labels): void {
  try {
    if (!Number.isFinite(value)) return;
    recordRawHistogram(name, value, labels);
  } catch {
    /* fail-safe: metrics must never break generation */
  }
}

function safeIncr(name: string, value: number, labels?: Labels): void {
  try {
    if (!Number.isFinite(value)) return;
    recordRawCounter(name, value, labels);
  } catch {
    /* fail-safe */
  }
}

// ── public recorders ─────────────────────────────────────────────────────────

export const runtimeMetrics = {
  /** End-to-end runtime latency, ms. */
  latencyMs(ms: number, labels?: Labels): void {
    safeObserve(RUNTIME_METRIC.latency, ms, labels);
  },
  /** Master-generation call latency, ms. */
  modelLatencyMs(ms: number, labels?: Labels): void {
    safeObserve(RUNTIME_METRIC.modelLatency, ms, labels);
  },
  /** Retries consumed across the generation call(s). No-op when zero. */
  retries(count: number, labels?: Labels): void {
    if (count > 0) safeIncr(RUNTIME_METRIC.retries, count, labels);
  },
  /** A generation-result cache hit. */
  cacheHit(labels?: Labels): void {
    safeIncr(RUNTIME_METRIC.cacheHits, 1, labels);
  },
  /** A generation-result cache miss. */
  cacheMiss(labels?: Labels): void {
    safeIncr(RUNTIME_METRIC.cacheMisses, 1, labels);
  },
  /** Which model/provider the task policy selected for this generation. */
  providerSelection(model: string, labels?: Labels): void {
    safeIncr(RUNTIME_METRIC.providerSelection, 1, { ...(labels ?? {}), model });
  },
  /** A best-effort (post-generation, fail-open) stage failed. */
  failure(stage: string, labels?: Labels): void {
    safeIncr(RUNTIME_METRIC.failures, 1, { ...(labels ?? {}), stage });
  },
  /** Total tokens consumed by generation, when the provider metered them. */
  tokenUsage(tokens: number, labels?: Labels): void {
    safeObserve(RUNTIME_METRIC.tokenUsage, tokens, labels);
  },
  /** Time spent inside the originality gate, ms. */
  originalityTimeMs(ms: number, labels?: Labels): void {
    safeObserve(RUNTIME_METRIC.originalityTime, ms, labels);
  },
  /** Time spent persisting the accepted generation, ms. */
  persistenceTimeMs(ms: number, labels?: Labels): void {
    safeObserve(RUNTIME_METRIC.persistenceTime, ms, labels);
  },
};

export type RuntimeMetrics = typeof runtimeMetrics;
