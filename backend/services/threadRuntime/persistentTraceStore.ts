/**
 * Phase 1 substrate — Persistent trace store interface.
 *
 * Defines the pluggable persistence contract every distributed-layer
 * consumer programs against. Default implementation is in-memory (so the
 * whole distributed layer is testable / type-safe without a database).
 * The Supabase-backed implementation is a separate file and only
 * activates once the `thread_runtime_events` migration is applied.
 *
 * Append-only semantics:
 *   - `appendBatch` is the only write entry point.
 *   - No `update*` / `delete*` methods exist on the interface.
 *   - Duplicate event ids return a dedup count; they do NOT throw.
 *
 * No DB integration required at construction time; backends are caller-
 * supplied via `setDefaultPersistentTraceStore`.
 */

import type {
  PersistedRuntimeEvent,
  PersistedRuntimeEventsQuery,
  PersistentTraceWriteResult,
} from './threadRuntimeTypes';

export interface PersistentTraceStore {
  /** Append a batch of events. Returns per-event accept/duplicate/reject. */
  appendBatch(events: PersistedRuntimeEvent[]): Promise<PersistentTraceWriteResult>;
  /** Read events matching a query. Capped at query.limit or store default. */
  query(input: PersistedRuntimeEventsQuery): Promise<PersistedRuntimeEvent[]>;
  /** Distinct session ids touching a thread, newest-first. */
  listSessionsForThread(input: { companyId: string; threadId: string; limit?: number }): Promise<string[]>;
  /** Count events matching a query — used by analytics + retention. */
  count(input: PersistedRuntimeEventsQuery): Promise<number>;
  /** Optional truncation API; backends without truncation return 0. */
  truncateBefore(input: { companyId: string; beforeISO: string }): Promise<number>;
}

/** In-memory implementation. Per-company event arrays; eventId dedup via Set. */
export function createInMemoryPersistentTraceStore(options?: {
  maxEventsPerCompany?: number;
  defaultQueryLimit?: number;
}): PersistentTraceStore {
  const cap = Math.max(1000, options?.maxEventsPerCompany ?? 50_000);
  const queryDefault = Math.max(50, options?.defaultQueryLimit ?? 500);
  const events = new Map<string, PersistedRuntimeEvent[]>();      // companyId → events
  const seen = new Map<string, Set<string>>();                    // companyId → seen eventIds

  function bucket(companyId: string): PersistedRuntimeEvent[] {
    let b = events.get(companyId);
    if (!b) { b = []; events.set(companyId, b); }
    return b;
  }
  function seenSet(companyId: string): Set<string> {
    let s = seen.get(companyId);
    if (!s) { s = new Set(); seen.set(companyId, s); }
    return s;
  }

  return {
    async appendBatch(batch) {
      let accepted = 0, duplicate = 0, rejected = 0;
      const results: PersistentTraceWriteResult['results'] = [];
      for (const e of batch) {
        if (!e.companyId || !e.eventId || !e.runtimeSessionId || !e.threadId || !e.eventType || !e.timestamp) {
          results.push({ eventId: e.eventId ?? '(missing)', status: 'rejected', reason: 'missing required fields' });
          rejected += 1;
          continue;
        }
        const ss = seenSet(e.companyId);
        if (ss.has(e.eventId)) {
          results.push({ eventId: e.eventId, status: 'duplicate' });
          duplicate += 1;
          continue;
        }
        const b = bucket(e.companyId);
        b.push({ ...e });
        ss.add(e.eventId);
        while (b.length > cap) {
          const evicted = b.shift();
          if (evicted) ss.delete(evicted.eventId);
        }
        results.push({ eventId: e.eventId, status: 'accepted' });
        accepted += 1;
      }
      return { accepted, duplicate, rejected, results };
    },
    async query(input) {
      const limit = Math.max(1, input.limit ?? queryDefault);
      const all = events.get(input.companyId) ?? [];
      const sinceMs = input.sinceISO ? Date.parse(input.sinceISO) : null;
      const untilMs = input.untilISO ? Date.parse(input.untilISO) : null;
      const sevRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
      const minSev = input.severityAtLeast ? sevRank[input.severityAtLeast] : null;
      const typeSet = input.eventTypes ? new Set(input.eventTypes) : null;
      const filtered = all.filter((e) => {
        if (input.threadId && e.threadId !== input.threadId) return false;
        if (input.runtimeSessionId && e.runtimeSessionId !== input.runtimeSessionId) return false;
        if (input.correlationId && e.correlationId !== input.correlationId) return false;
        if (typeSet && !typeSet.has(e.eventType)) return false;
        if (minSev !== null && sevRank[e.severity] < minSev) return false;
        if (sinceMs !== null) {
          const ts = Date.parse(e.timestamp);
          if (Number.isFinite(ts) && ts < sinceMs) return false;
        }
        if (untilMs !== null) {
          const ts = Date.parse(e.timestamp);
          if (Number.isFinite(ts) && ts > untilMs) return false;
        }
        return true;
      });
      filtered.sort((a, b) => {
        if (a.orchestrationSequence !== b.orchestrationSequence) return a.orchestrationSequence - b.orchestrationSequence;
        return a.timestamp.localeCompare(b.timestamp);
      });
      return filtered.slice(0, limit);
    },
    async listSessionsForThread(input) {
      const limit = Math.max(1, input.limit ?? queryDefault);
      const all = events.get(input.companyId) ?? [];
      const sessions = new Map<string, string>(); // sessionId → latest timestamp
      for (const e of all) {
        if (e.threadId !== input.threadId) continue;
        const cur = sessions.get(e.runtimeSessionId);
        if (!cur || cur < e.timestamp) sessions.set(e.runtimeSessionId, e.timestamp);
      }
      return Array.from(sessions.entries())
        .sort((a, b) => b[1].localeCompare(a[1]))
        .slice(0, limit)
        .map(([sid]) => sid);
    },
    async count(input) {
      const result = await this.query({ ...input, limit: Number.MAX_SAFE_INTEGER });
      return result.length;
    },
    async truncateBefore(input) {
      const b = events.get(input.companyId);
      if (!b) return 0;
      const cutoff = Date.parse(input.beforeISO);
      if (!Number.isFinite(cutoff)) return 0;
      const before = b.length;
      const survivors = b.filter((e) => {
        const ts = Date.parse(e.timestamp);
        return !Number.isFinite(ts) || ts >= cutoff;
      });
      events.set(input.companyId, survivors);
      // rebuild seen-set
      const newSeen = new Set<string>();
      survivors.forEach((e) => newSeen.add(e.eventId));
      seen.set(input.companyId, newSeen);
      return before - survivors.length;
    },
  };
}

let _default: PersistentTraceStore | null = null;
export function getDefaultPersistentTraceStore(): PersistentTraceStore {
  if (!_default) _default = createInMemoryPersistentTraceStore();
  return _default;
}
export function setDefaultPersistentTraceStore(store: PersistentTraceStore): void {
  _default = store;
}
