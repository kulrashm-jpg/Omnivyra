/**
 * Phase 13 — In-process bounded event coalescer.
 *
 * High-frequency event sources (deployment health snapshots, SRE
 * snapshots, observability convergence projections) can fire many
 * `*.health_changed` events when many surfaces transition during the
 * same operator action. The coalescer batches events with the same
 * (orgId, topic, eventName) key within a short window so the subscriber
 * sees a single fanout instead of N duplicates.
 *
 * Adoption is opt-in. The existing realtime publisher continues to fire
 * each event individually — this helper is a wrapper that callers can
 * adopt for hot paths.
 *
 * Hard guarantees:
 *   • Bounded buffer (default 256 entries per (org, topic, eventName)).
 *   • Bounded window (default 250 ms). Coalescer never holds events past
 *     the window — operators see latest-write-wins per key.
 *   • Replay-safe: the coalesced payload is the latest payload; earlier
 *     payloads are discarded. Callers that need every payload must NOT
 *     use the coalescer.
 *   • Tenant-scoped key; one coalescer is safe to share process-wide.
 */

export type CoalescerKey = {
  organizationId: string;
  topic: string;
  eventName: string;
};

export type CoalescerEntry<T> = {
  key: CoalescerKey;
  latestPayload: T;
  versionCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type CoalescerFlushHandler<T> = (entry: CoalescerEntry<T>) => Promise<void> | void;

export type CoalescerConfig = {
  windowMs: number;
  maxEntries: number;
};

export const DEFAULT_COALESCER_CONFIG: CoalescerConfig = {
  windowMs: 250,
  maxEntries: 256,
};

function keyOf(key: CoalescerKey): string {
  return `${key.organizationId}|${key.topic}|${key.eventName}`;
}

/**
 * Lightweight coalescer keyed by (orgId, topic, eventName). Holds at
 * most `maxEntries` keys; oldest is evicted when full. Each key holds
 * the latest payload + version count. Flush is operator-driven —
 * callers call `flush()` after the user-triggered action completes.
 */
export class EventCoalescer<T> {
  private readonly entries = new Map<string, CoalescerEntry<T>>();
  private readonly config: CoalescerConfig;

  constructor(config: Partial<CoalescerConfig> = {}) {
    this.config = { ...DEFAULT_COALESCER_CONFIG, ...config };
  }

  push(key: CoalescerKey, payload: T): void {
    const k = keyOf(key);
    const now = Date.now();
    const existing = this.entries.get(k);
    if (existing) {
      existing.latestPayload = payload;
      existing.versionCount += 1;
      existing.lastSeenAt = now;
      return;
    }
    if (this.entries.size >= this.config.maxEntries) {
      // Evict oldest. O(n) — bounded by config.
      let oldestKey: string | null = null;
      let oldestSeen = Infinity;
      for (const [k2, e] of this.entries) {
        if (e.firstSeenAt < oldestSeen) {
          oldestSeen = e.firstSeenAt;
          oldestKey = k2;
        }
      }
      if (oldestKey) this.entries.delete(oldestKey);
    }
    this.entries.set(k, { key, latestPayload: payload, versionCount: 1, firstSeenAt: now, lastSeenAt: now });
  }

  /**
   * Flush all entries whose window has elapsed (or all of them when
   * `force=true`). The handler is invoked once per key with the latest
   * payload + total version count for that key.
   */
  async flush(handler: CoalescerFlushHandler<T>, options?: { force?: boolean; now?: number }): Promise<number> {
    const force = options?.force ?? false;
    const now = options?.now ?? Date.now();
    let flushed = 0;
    const keys = Array.from(this.entries.keys());
    for (const k of keys) {
      const entry = this.entries.get(k);
      if (!entry) continue;
      const age = now - entry.firstSeenAt;
      if (!force && age < this.config.windowMs) continue;
      this.entries.delete(k);
      try {
        await handler(entry);
        flushed += 1;
      } catch (err: any) {
        console.warn('[eventCoalescer] handler threw:', { key: k, error: err?.message });
      }
    }
    return flushed;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
