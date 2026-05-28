/**
 * Phase 3 — Global runtime replay reconstructor.
 *
 * Reads from a PersistentTraceStore and rebuilds the canonical event
 * stream for a thread, independent of which process(es) wrote it. The
 * reconstructor handles:
 *
 *   - replay across instances    (events from multiple writers per thread)
 *   - replay across reconnects   (events for same correlationId across
 *                                  different runtimeSessionIds)
 *   - replay across crashes      (process restart loses in-memory state;
 *                                  store retains everything)
 *   - session migration          (canonicalThreadId rewrite via the
 *                                  scheduler's persist_success rootId)
 *   - transport retries          (dedup by eventId already in store)
 *
 * Output: a single ordered `ThreadRuntimeTrace` shape (compatible with
 * the existing introspect / timeline / failure pipelines).
 */

import type {
  PersistedRuntimeEvent,
  ThreadRuntimeTrace,
  ThreadRuntimeTraceEvent,
} from './threadRuntimeTypes';
import {
  getDefaultPersistentTraceStore,
  type PersistentTraceStore,
} from './persistentTraceStore';

export interface ReconstructReplayInput {
  store?: PersistentTraceStore;
  companyId: string;
  /** EITHER threadId — gather every session for this thread; OR runtimeSessionId — single session only. */
  threadId?: string;
  runtimeSessionId?: string;
  correlationId?: string;
  sinceISO?: string;
  untilISO?: string;
  /** Optional: pin the canonical threadId (used when reconstructing across pending → real id rewrites). */
  canonicalThreadId?: string;
}

export interface ReconstructReplayResult {
  /** Canonical reconstructed trace, ordered by (orchestrationSequence, timestamp, eventId). */
  trace: ThreadRuntimeTrace;
  /** Source sessions and how many events each contributed. */
  contributingSessions: Array<{ runtimeSessionId: string; eventCount: number }>;
  /** Events whose eventIds were de-duplicated during reconstruction. */
  dedupedCount: number;
  /** Events whose threadId was rewritten to the canonical id. */
  rewrittenCount: number;
}

function projectPersistedToEvent(p: PersistedRuntimeEvent): ThreadRuntimeTraceEvent {
  const payload = (p.payloadJson ?? {}) as Record<string, unknown>;
  return {
    eventId: p.eventId,
    runtimeSessionId: p.runtimeSessionId,
    threadId: p.threadId,
    parentNodeId: (payload.parentNodeId as string | null | undefined) ?? null,
    childNodeIds: Array.isArray(payload.childNodeIds) ? payload.childNodeIds as string[] : [],
    nodeGenerationMode: (payload.nodeGenerationMode as 'manual' | 'ai' | 'mixed' | undefined) ?? 'manual',
    orchestrationSequence: p.orchestrationSequence,
    transitionType: p.eventType,
    timestamp: p.timestamp,
    latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : undefined,
    detail: typeof payload.detail === 'string' ? payload.detail : undefined,
    payload: (payload.extra as Record<string, unknown> | null | undefined) ?? undefined,
  };
}

function extractRootIdFromDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const m = detail.match(/root=([^\s]+)/);
  return m ? m[1] : null;
}

export async function reconstructReplay(input: ReconstructReplayInput): Promise<ReconstructReplayResult> {
  const store = input.store ?? getDefaultPersistentTraceStore();

  // Initial query — load every event that could plausibly belong to this thread.
  const events = await store.query({
    companyId: input.companyId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    correlationId: input.correlationId,
    sinceISO: input.sinceISO,
    untilISO: input.untilISO,
    limit: Number.MAX_SAFE_INTEGER,
  });

  // ── Canonical threadId resolution ──────────────────────────────────
  // The scheduler writes a persist_success carrying `detail = "root=<id>"`.
  // Any pending_* threadId observed in the events should be rewritten to
  // that canonical id. The caller can pin the id explicitly.
  let canonicalThreadId = input.canonicalThreadId ?? null;
  if (!canonicalThreadId) {
    for (const e of events) {
      if (e.eventType === 'persist_success') {
        const rid = extractRootIdFromDetail((e.payloadJson as { detail?: string | null })?.detail);
        if (rid) { canonicalThreadId = rid; break; }
      }
    }
  }

  // If we have a canonical id, also pull events tagged with it (in case
  // the caller queried by pending id originally).
  let extraEvents: PersistedRuntimeEvent[] = [];
  if (canonicalThreadId && canonicalThreadId !== input.threadId) {
    extraEvents = await store.query({
      companyId: input.companyId,
      threadId: canonicalThreadId,
      correlationId: input.correlationId,
      sinceISO: input.sinceISO,
      untilISO: input.untilISO,
      limit: Number.MAX_SAFE_INTEGER,
    });
  }

  // Dedup by eventId across the union of (events ∪ extraEvents).
  const byId = new Map<string, PersistedRuntimeEvent>();
  let dedupedCount = 0;
  for (const e of events) {
    if (byId.has(e.eventId)) { dedupedCount += 1; continue; }
    byId.set(e.eventId, e);
  }
  for (const e of extraEvents) {
    if (byId.has(e.eventId)) { dedupedCount += 1; continue; }
    byId.set(e.eventId, e);
  }
  const all = Array.from(byId.values());

  // Rewrite threadId on events that still use the pending id.
  let rewrittenCount = 0;
  if (canonicalThreadId) {
    for (const e of all) {
      if (e.threadId !== canonicalThreadId && e.threadId.startsWith('pending_')) {
        e.threadId = canonicalThreadId;
        rewrittenCount += 1;
      }
    }
  }

  // Order: (orchestrationSequence ASC, timestamp ASC, eventId ASC).
  all.sort((a, b) => {
    if (a.orchestrationSequence !== b.orchestrationSequence) return a.orchestrationSequence - b.orchestrationSequence;
    if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.eventId.localeCompare(b.eventId);
  });

  // Contributing sessions.
  const sessionCounts = new Map<string, number>();
  for (const e of all) sessionCounts.set(e.runtimeSessionId, (sessionCounts.get(e.runtimeSessionId) ?? 0) + 1);
  const contributingSessions = Array.from(sessionCounts.entries())
    .map(([runtimeSessionId, eventCount]) => ({ runtimeSessionId, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount);

  // Materialize as ThreadRuntimeTrace.
  const projected = all.map(projectPersistedToEvent);
  const startedAt = all[0]?.timestamp ?? new Date().toISOString();
  const sessionEndEvent = all.findLast?.((e) => e.eventType === 'session_end')
    ?? [...all].reverse().find((e) => e.eventType === 'session_end');
  const endedAt = sessionEndEvent?.timestamp ?? null;

  const trace: ThreadRuntimeTrace = {
    runtimeSessionId: input.runtimeSessionId ?? `replay_${(canonicalThreadId ?? input.threadId ?? 'unknown').slice(0, 16)}_${Date.now().toString(36)}`,
    threadId: canonicalThreadId ?? input.threadId ?? '(unknown)',
    companyId: input.companyId,
    startedAt,
    endedAt,
    events: projected,
  };

  return { trace, contributingSessions, dedupedCount, rewrittenCount };
}
