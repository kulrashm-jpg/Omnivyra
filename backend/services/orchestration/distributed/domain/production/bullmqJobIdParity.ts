/**
 * Phase 27B.3 — BullMQ jobId parity enforcement.
 *
 * Single canonical jobId builder for publish-class enqueues. Every
 * enqueue path (runtime, cron sweep, campaign execution) MUST funnel
 * its jobId through this helper so that:
 *
 *   - the SAME (scheduledPostId, scheduledForIso) tuple produces the
 *     SAME jobId regardless of which path enqueued it;
 *   - BullMQ's own dedup-by-jobId mechanic suppresses the second
 *     enqueue automatically;
 *   - any divergence (e.g. cron uses DB UUID, runtime uses hash) is
 *     surfaced as `enqueue_path_divergence_detected` telemetry so it
 *     can't silently double-enqueue.
 *
 * SCOPE: ID builder + parity assertion ONLY. Does NOT modify
 * `queue.add()` call sites, the BullMQ client, or the existing
 * `createQueueJob` DB row — those keep their semantics. Callers wire
 * the helper into their enqueue paths incrementally.
 *
 * Telemetry:
 *   bullmq_jobid_generated
 *   bullmq_duplicate_suppressed
 *   enqueue_path_divergence_detected
 */

import { createHash } from 'crypto';

// ────────────────────────────────────────────────────────────────────
// Canonical ID build
// ────────────────────────────────────────────────────────────────────

/**
 * Identifies the enqueue path that produced a jobId. Used purely for
 * divergence detection — the canonical ID itself is path-independent.
 */
export type EnqueuePathSource = 'runtime' | 'cron' | 'campaign' | 'manual';

export interface PublishJobIdComponents {
  scheduledPostId: string;
  scheduledForIso: string;
}

/**
 * Build the canonical publish jobId. Content-addressed on
 * (scheduledPostId, scheduledForIso). The two inputs are the only
 * fields that determine "is this the same publish?" — provider,
 * user_id, social_account_id are derivable from the row.
 *
 * Format: `publish-<sha256[:16]>`. Stable across processes and
 * Node versions.
 */
export function buildCanonicalPublishJobId(input: PublishJobIdComponents): string {
  if (!input || !input.scheduledPostId || !input.scheduledForIso) {
    throw new Error('[bullmqJobIdParity] scheduledPostId + scheduledForIso required');
  }
  // Normalize the timestamp to ms-precision UTC so wall-clock drift on
  // sub-second precision can't cause divergence.
  const normalizedTs = new Date(input.scheduledForIso).toISOString();
  const payload = `${input.scheduledPostId}|${normalizedTs}`;
  const hash = createHash('sha256').update(`publish:${payload}`).digest('hex').slice(0, 16);
  return `publish-${hash}`;
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type JobIdParityTelemetryEvent =
  | 'bullmq_jobid_generated'
  | 'bullmq_duplicate_suppressed'
  | 'enqueue_path_divergence_detected';

export interface JobIdParityTelemetrySink {
  emit(event: JobIdParityTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: JobIdParityTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'enqueue_path_divergence_detected') {
        console.warn(`[jobid_parity] ${line}`);
      } else {
        console.log(`[jobid_parity] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Parity tracker
// ────────────────────────────────────────────────────────────────────

interface ParityRecord {
  canonicalJobId: string;
  observed: Array<{ source: EnqueuePathSource; observedJobId: string; observedAtMs: number }>;
}

const PARITY_CAP = 4096;
const PARITY_TTL_MS = 5 * 60 * 1000; // 5 minutes — enough to catch a cron/runtime collision

/**
 * Stateful tracker that records each enqueue's (canonical, observed)
 * pair and emits divergence telemetry if two sources produced
 * non-matching observed IDs for the same canonical key.
 */
export class JobIdParityTracker {
  private readonly records = new Map<string, ParityRecord>();
  private readonly telemetry: JobIdParityTelemetrySink;
  private readonly clock: () => number;

  constructor(opts?: { telemetry?: JobIdParityTelemetrySink; clock?: () => number }) {
    this.telemetry = opts?.telemetry ?? defaultTelemetrySink;
    this.clock = opts?.clock ?? (() => Date.now());
  }

  /**
   * Record an enqueue attempt. The canonical jobId is recomputed
   * deterministically; observed is whatever the caller actually
   * passed to BullMQ (which may match — or, in the case of legacy
   * paths, be a DB UUID).
   */
  recordEnqueue(input: {
    source: EnqueuePathSource;
    components: PublishJobIdComponents;
    observedJobId: string;
  }): { canonicalJobId: string; divergent: boolean } {
    const canonicalJobId = buildCanonicalPublishJobId(input.components);
    const nowMs = this.clock();
    this.evictExpired(nowMs);

    let record = this.records.get(canonicalJobId);
    if (!record) {
      record = { canonicalJobId, observed: [] };
      this.records.set(canonicalJobId, record);
      if (this.records.size > PARITY_CAP) {
        const first = this.records.keys().next().value as string | undefined;
        if (first) this.records.delete(first);
      }
    }

    record.observed.push({
      source: input.source,
      observedJobId: input.observedJobId,
      observedAtMs: nowMs,
    });

    this.telemetry.emit('bullmq_jobid_generated', {
      source: input.source,
      canonicalJobId,
      observedJobId: input.observedJobId,
      scheduledPostId: input.components.scheduledPostId,
      scheduledForIso: input.components.scheduledForIso,
    });

    // Divergence detection: same canonical key seen from different
    // sources with non-matching observed IDs.
    const distinctObserved = new Set(record.observed.map((o) => o.observedJobId));
    const divergent = distinctObserved.size > 1;
    if (divergent) {
      const sources = Array.from(new Set(record.observed.map((o) => o.source)));
      this.telemetry.emit('enqueue_path_divergence_detected', {
        canonicalJobId,
        scheduledPostId: input.components.scheduledPostId,
        scheduledForIso: input.components.scheduledForIso,
        sources,
        observedIds: Array.from(distinctObserved),
      });
    } else if (record.observed.length > 1) {
      // Same canonical + same observed = a BullMQ-level duplicate
      // suppression would have fired.
      this.telemetry.emit('bullmq_duplicate_suppressed', {
        canonicalJobId,
        observedJobId: input.observedJobId,
        source: input.source,
        attemptCount: record.observed.length,
      });
    }

    return { canonicalJobId, divergent };
  }

  /**
   * Snapshot the current tracker state for diagnostics.
   */
  snapshot(): {
    trackedCanonicalKeys: number;
    totalObservations: number;
    divergentKeys: number;
  } {
    let totalObservations = 0;
    let divergentKeys = 0;
    for (const record of this.records.values()) {
      totalObservations += record.observed.length;
      const distinctObserved = new Set(record.observed.map((o) => o.observedJobId));
      if (distinctObserved.size > 1) divergentKeys += 1;
    }
    return {
      trackedCanonicalKeys: this.records.size,
      totalObservations,
      divergentKeys,
    };
  }

  /**
   * Drop all tracker state — for tests.
   */
  reset(): void {
    this.records.clear();
  }

  private evictExpired(nowMs: number): void {
    for (const [key, record] of this.records) {
      const latest = record.observed[record.observed.length - 1];
      if (!latest) {
        this.records.delete(key);
        continue;
      }
      if (nowMs - latest.observedAtMs > PARITY_TTL_MS) {
        this.records.delete(key);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Default tracker singleton
// ────────────────────────────────────────────────────────────────────

let defaultTracker: JobIdParityTracker | null = null;

export function getDefaultJobIdParityTracker(): JobIdParityTracker {
  if (!defaultTracker) defaultTracker = new JobIdParityTracker();
  return defaultTracker;
}

/** Replace the default tracker (for tests). */
export function setDefaultJobIdParityTracker(tracker: JobIdParityTracker | null): void {
  defaultTracker = tracker;
}
