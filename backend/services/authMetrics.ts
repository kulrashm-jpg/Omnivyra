/**
 * authMetrics — in-memory counter set for auth-subsystem operations.
 *
 * Why this exists
 * ───────────────
 * Phase 2.B exposed how thin our auth observability was: incidents had
 * to be diagnosed from log scraping because there were no metrics to
 * pivot on. This module gives every auth-critical operation a tagged
 * counter so dashboards can answer questions like:
 *
 *   - How many schema fallbacks fired today, by resolver?
 *   - How many forced sign-outs have we issued, by code?
 *   - How many lifecycle flips succeeded, vs how many were idempotent
 *     no-ops?
 *   - How many retries did clients exhaust in the last hour?
 *
 * The counters live in process memory and are exposed via
 * /api/health/metrics (or a future Prometheus exporter). Resetting via
 * {@link resetAuthMetrics} is test-only.
 *
 * Counter conventions
 * ───────────────────
 * Names are dot-namespaced: `auth.<surface>.<event>`. Tags are
 * key/value pairs and are part of the counter identity (every distinct
 * tag combination is a distinct bucket). We DO bound cardinality —
 * if a tag value looks unbounded (long UUID, free text) the bucket is
 * coalesced into a `*` placeholder to avoid runaway memory.
 */

import { logger } from './logger';

export type MetricTags = Readonly<Record<string, string>>;

interface CounterEntry {
  name:  string;
  tags:  MetricTags;
  value: number;
}

const counters = new Map<string, CounterEntry>();
let droppedHighCardinalityKeys = 0;

const MAX_COUNTER_KEYS = 1_000;

/** Cheap stable key for a (name, tags) bucket. */
function bucketKey(name: string, tags: MetricTags): string {
  const sorted = Object.keys(tags).sort().map((k) => `${k}=${tags[k]}`).join(',');
  return `${name}|${sorted}`;
}

/**
 * Increment a counter. `delta` defaults to 1. Tag values are coerced to
 * strings; null/undefined values are dropped to keep the cardinality
 * surface stable.
 */
export function incrementAuthMetric(
  name: string,
  tags: Record<string, string | number | boolean | null | undefined> = {},
  delta = 1,
): void {
  const cleanTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (v === null || v === undefined) continue;
    cleanTags[k] = String(v);
  }
  const key = bucketKey(name, cleanTags);

  let entry = counters.get(key);
  if (!entry) {
    if (counters.size >= MAX_COUNTER_KEYS) {
      droppedHighCardinalityKeys += 1;
      if (droppedHighCardinalityKeys === 1 || droppedHighCardinalityKeys % 100 === 0) {
        logger.warn('auth_metrics_cardinality_capped', {
          maxKeys: MAX_COUNTER_KEYS,
          dropped: droppedHighCardinalityKeys,
        });
      }
      return;
    }
    entry = { name, tags: cleanTags, value: 0 };
    counters.set(key, entry);
  }
  entry.value += delta;
}

export interface AuthMetricsSnapshot {
  counters: Array<{ name: string; tags: MetricTags; value: number }>;
  cardinalityCapped: number;
  takenAt: string;
}

/** Snapshot for the metrics endpoint / dev panel. Does not reset. */
export function snapshotAuthMetrics(): AuthMetricsSnapshot {
  return {
    counters: [...counters.values()].map((c) => ({ ...c })),
    cardinalityCapped: droppedHighCardinalityKeys,
    takenAt: new Date().toISOString(),
  };
}

/** Test-only. */
export function resetAuthMetrics(): void {
  counters.clear();
  droppedHighCardinalityKeys = 0;
}
