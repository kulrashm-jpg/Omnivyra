/**
 * Phase 5 — Runtime session correlation resolver.
 *
 * Eliminates the `pending_*` threadId ambiguity introduced by the scheduler
 * wiring: tracer events emitted BEFORE the multi-row RPC use a synthesized
 * `pending_<userId>_<ts>` id; events emitted AFTER use the real rootId. The
 * resolver walks a session's events, finds the persist_success that
 * established the real rootId, and rewrites the trace in-place (or in a
 * derived copy) so all events share the canonical identity.
 *
 * Also handles:
 *   - rootId reassignment (e.g. server-side re-issue of a multi-row root
 *     after a recovery flow renames the canonical id)
 *   - session continuity (same companyId + same pending prefix + same
 *     wall-clock window — collapse if the caller resumed under a fresh
 *     runtimeSessionId)
 *
 * Pure / deterministic. Operates on a copy of the trace by default.
 */

import type {
  ThreadRuntimeTrace,
  ThreadRuntimeTraceEvent,
} from './threadRuntimeTypes';
import type { ThreadRuntimeTraceRegistry } from './threadRuntimeTraceRegistry';

export interface ResolveCorrelationResult {
  /** Resolved canonical trace (events with threadId rewritten). */
  resolved: ThreadRuntimeTrace;
  /** The pending id that was reassigned (or null if none). */
  pendingThreadId: string | null;
  /** The canonical id (from persist_success detail). */
  canonicalThreadId: string | null;
  /** Events whose threadId was rewritten. */
  rewrittenEventIds: string[];
  /** Sessions merged into this one (for continuity resolution). */
  mergedSessionIds: string[];
}

function extractRootIdFromDetail(detail: string | undefined): string | null {
  if (!detail) return null;
  // matches `root=<uuid>` produced by scheduler instrumentation
  const m = detail.match(/root=([^\s]+)/);
  return m ? m[1] : null;
}

function isPendingId(id: string): boolean {
  return id.startsWith('pending_');
}

export interface ResolveCorrelationInput {
  trace: ThreadRuntimeTrace;
  /** Optional pre-known canonical id (overrides extraction from persist_success). */
  knownCanonicalId?: string;
  /** Mutate in place (registry) — defaults to false (returns a copy). */
  mutate?: boolean;
}

export function resolveCorrelation(input: ResolveCorrelationInput): ResolveCorrelationResult {
  const events = input.trace.events;
  // Find the canonical thread id either from the caller or from the first
  // persist_success that names a rootId.
  let canonicalThreadId: string | null = input.knownCanonicalId ?? null;
  if (!canonicalThreadId) {
    for (const e of events) {
      if (e.transitionType === 'persist_success') {
        const fromDetail = extractRootIdFromDetail(e.detail);
        if (fromDetail) { canonicalThreadId = fromDetail; break; }
      }
    }
  }

  // Find the pending id, if any.
  let pendingThreadId: string | null = null;
  for (const e of events) {
    if (isPendingId(e.threadId)) { pendingThreadId = e.threadId; break; }
    if (isPendingId(input.trace.threadId)) { pendingThreadId = input.trace.threadId; break; }
  }

  const rewrittenEventIds: string[] = [];
  if (!canonicalThreadId || !pendingThreadId || canonicalThreadId === pendingThreadId) {
    // Nothing to do; return trace as-is.
    return {
      resolved: input.mutate ? input.trace : structuredCopyTrace(input.trace),
      pendingThreadId,
      canonicalThreadId,
      rewrittenEventIds: [],
      mergedSessionIds: [],
    };
  }

  const target = input.mutate ? input.trace : structuredCopyTrace(input.trace);
  for (const e of target.events) {
    if (e.threadId === pendingThreadId) {
      e.threadId = canonicalThreadId;
      rewrittenEventIds.push(e.eventId);
    }
  }
  if (target.threadId === pendingThreadId) target.threadId = canonicalThreadId;

  return {
    resolved: target,
    pendingThreadId,
    canonicalThreadId,
    rewrittenEventIds,
    mergedSessionIds: [],
  };
}

function structuredCopyTrace(t: ThreadRuntimeTrace): ThreadRuntimeTrace {
  return {
    ...t,
    events: t.events.map((e) => ({ ...e, childNodeIds: [...e.childNodeIds] })),
  };
}

// ── Session continuity resolution ──────────────────────────────────────

export interface MergeSessionsInput {
  registry: ThreadRuntimeTraceRegistry;
  companyId: string;
  /** A canonical thread id known to identify this thread (e.g. rootId after persist). */
  canonicalThreadId: string;
  /** Window in ms within which adjacent sessions are eligible to merge. Default 5min. */
  windowMs?: number;
  mutate?: boolean;
}

/**
 * Find all sessions whose events touch the canonical thread (post-rename)
 * or used a pending id within the time window, and return a single
 * coalesced trace. Useful when the operator opens the introspection for
 * a thread and wants to see EVERY event across multiple runtime sessions.
 */
export function mergeCorrelatedSessions(input: MergeSessionsInput): {
  resolved: ThreadRuntimeTrace;
  mergedSessionIds: string[];
} {
  const windowMs = input.windowMs ?? 5 * 60 * 1000;
  const all = input.registry.listTraces(input.companyId);
  if (all.length === 0) {
    return {
      resolved: {
        runtimeSessionId: 'empty',
        threadId: input.canonicalThreadId,
        companyId: input.companyId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        events: [],
      },
      mergedSessionIds: [],
    };
  }

  // First pass: identify a temporal pivot — the latest trace touching
  // canonicalThreadId (after resolution).
  let pivotEndMs = 0;
  for (const t of all) {
    const resolved = resolveCorrelation({ trace: t, knownCanonicalId: input.canonicalThreadId });
    if (resolved.resolved.threadId === input.canonicalThreadId) {
      const ts = Date.parse(t.endedAt ?? t.startedAt);
      if (Number.isFinite(ts) && ts > pivotEndMs) pivotEndMs = ts;
    }
  }
  if (pivotEndMs === 0) {
    // No sessions touch this canonical id; return an empty placeholder.
    return {
      resolved: {
        runtimeSessionId: 'no-match',
        threadId: input.canonicalThreadId,
        companyId: input.companyId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        events: [],
      },
      mergedSessionIds: [],
    };
  }

  const mergedEvents: ThreadRuntimeTraceEvent[] = [];
  const mergedSessionIds: string[] = [];
  let earliestStart = new Date(pivotEndMs).toISOString();
  let latestEnd: string | null = null;

  for (const t of all) {
    const startMs = Date.parse(t.startedAt);
    if (!Number.isFinite(startMs)) continue;
    // Eligible if it overlaps the temporal window OR resolves to the canonical id.
    const resolved = resolveCorrelation({ trace: t, knownCanonicalId: input.canonicalThreadId });
    const touchesCanonical = resolved.resolved.threadId === input.canonicalThreadId
      || resolved.resolved.events.some((e) => e.threadId === input.canonicalThreadId);
    const withinWindow = Math.abs(startMs - pivotEndMs) <= windowMs;
    if (!touchesCanonical && !withinWindow) continue;
    mergedEvents.push(...resolved.resolved.events);
    mergedSessionIds.push(t.runtimeSessionId);
    if (Date.parse(t.startedAt) < Date.parse(earliestStart)) earliestStart = t.startedAt;
    if (t.endedAt && (!latestEnd || Date.parse(t.endedAt) > Date.parse(latestEnd))) latestEnd = t.endedAt;
  }

  // Re-sort by orchestrationSequence, then timestamp, then eventId.
  mergedEvents.sort((a, b) => {
    if (a.orchestrationSequence !== b.orchestrationSequence) return a.orchestrationSequence - b.orchestrationSequence;
    if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.eventId.localeCompare(b.eventId);
  });

  // Dedupe by eventId in case the same event somehow appears in multiple sessions.
  const seen = new Set<string>();
  const deduped = mergedEvents.filter((e) => {
    if (seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });

  return {
    resolved: {
      runtimeSessionId: `merged_${input.canonicalThreadId.slice(0, 12)}_${Date.now().toString(36)}`,
      threadId: input.canonicalThreadId,
      companyId: input.companyId,
      startedAt: earliestStart,
      endedAt: latestEnd,
      events: deduped,
    },
    mergedSessionIds,
  };
}
