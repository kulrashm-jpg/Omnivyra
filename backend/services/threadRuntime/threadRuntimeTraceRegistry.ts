/**
 * Phase 1 — Thread runtime trace registry.
 *
 * Captures every state transition for a thread runtime session — node
 * creates, edits, reorders, persistence attempts (success + failure),
 * join operations, refresh events, recovery attempts.
 *
 * Downstream engines (snapshot, soak reporter, failure summarizer,
 * diagnostics, validator, operator summary) all read from this registry.
 * Stays pure: callers record events; engines consume.
 *
 * In-memory per-process. Per-company bucketing. Capacity-bounded.
 */

import type {
  ThreadNodeGenerationMode,
  ThreadRuntimeTrace,
  ThreadRuntimeTraceEvent,
  ThreadRuntimeTransitionType,
} from './threadRuntimeTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RecordTraceEventInput {
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  transitionType: ThreadRuntimeTransitionType;
  parentNodeId?: string | null;
  childNodeIds?: string[];
  nodeGenerationMode?: ThreadNodeGenerationMode;
  latencyMs?: number;
  detail?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
  /**
   * Transport-layer dedup key. When provided, the registry uses this id
   * verbatim and silently skips any second insert with the same eventId
   * for the same session. Callers must keep eventIds globally unique
   * within a session (any random-suffix scheme works; the helpers use
   * `evt_<base36>_<rand>` by default).
   *
   * When omitted, the registry generates a fresh id. Server-side callers
   * (in-process tracer) should leave this undefined. The HTTP transport
   * endpoint MUST forward the client-generated id so replays dedupe.
   */
  eventId?: string;
}

export interface ThreadRuntimeTraceRegistry {
  startSession(input: { runtimeSessionId: string; threadId: string; companyId: string; timestamp?: string }): ThreadRuntimeTrace;
  recordEvent(input: RecordTraceEventInput): ThreadRuntimeTraceEvent;
  endSession(runtimeSessionId: string, timestamp?: string): void;
  getTrace(runtimeSessionId: string): ThreadRuntimeTrace | undefined;
  listTraces(companyId?: string): ThreadRuntimeTrace[];
  listEvents(filter?: { companyId?: string; threadId?: string; type?: ThreadRuntimeTransitionType }): ThreadRuntimeTraceEvent[];
  clear(companyId?: string): void;
  size(companyId?: string): { sessions: number; events: number };
}

interface InternalSession {
  trace: ThreadRuntimeTrace;
  nextSequence: number;
  /** Set of eventIds already recorded for this session — used for transport dedup. */
  seenEventIds: Set<string>;
}

export function createThreadRuntimeTraceRegistry(options?: {
  maxSessionsPerCompany?: number;
  maxEventsPerSession?: number;
}): ThreadRuntimeTraceRegistry {
  const sessionCap = Math.max(20, options?.maxSessionsPerCompany ?? 500);
  const eventCap = Math.max(50, options?.maxEventsPerSession ?? 5000);
  const sessions = new Map<string, InternalSession>();              // sessionId → session
  const companyIndex = new Map<string, Set<string>>();              // companyId → set of sessionIds

  function recordCompanySession(companyId: string, sessionId: string) {
    let set = companyIndex.get(companyId);
    if (!set) { set = new Set(); companyIndex.set(companyId, set); }
    set.add(sessionId);
    // capacity prune — drop oldest if over cap
    while (set.size > sessionCap) {
      const first = set.values().next().value as string | undefined;
      if (!first) break;
      set.delete(first);
      sessions.delete(first);
    }
  }

  return {
    startSession(input) {
      const now = input.timestamp ?? new Date().toISOString();
      const trace: ThreadRuntimeTrace = {
        runtimeSessionId: input.runtimeSessionId,
        threadId: input.threadId,
        companyId: input.companyId,
        startedAt: now,
        endedAt: null,
        events: [],
      };
      sessions.set(input.runtimeSessionId, { trace, nextSequence: 1, seenEventIds: new Set() });
      recordCompanySession(input.companyId, input.runtimeSessionId);
      // record the session_start event itself
      this.recordEvent({
        runtimeSessionId: input.runtimeSessionId,
        threadId: input.threadId,
        companyId: input.companyId,
        transitionType: 'session_start',
        timestamp: now,
      });
      return trace;
    },
    recordEvent(input) {
      let session = sessions.get(input.runtimeSessionId);
      if (!session) {
        // Auto-create when the caller skipped startSession.
        const trace: ThreadRuntimeTrace = {
          runtimeSessionId: input.runtimeSessionId,
          threadId: input.threadId,
          companyId: input.companyId,
          startedAt: input.timestamp ?? new Date().toISOString(),
          endedAt: null,
          events: [],
        };
        session = { trace, nextSequence: 1, seenEventIds: new Set() };
        sessions.set(input.runtimeSessionId, session);
        recordCompanySession(input.companyId, input.runtimeSessionId);
      }
      // Transport dedup: if the caller supplied an eventId we've already
      // seen for this session, return the existing event without inserting.
      const eventId = input.eventId ?? newId('evt');
      if (session.seenEventIds.has(eventId)) {
        const existing = session.trace.events.find((e) => e.eventId === eventId);
        if (existing) return existing;
        // Defensive: fell out of capacity-bounded events buffer but still in
        // the seen set. Treat as already-handled.
        return {
          eventId,
          runtimeSessionId: input.runtimeSessionId,
          threadId: input.threadId,
          parentNodeId: input.parentNodeId ?? null,
          childNodeIds: input.childNodeIds ?? [],
          nodeGenerationMode: input.nodeGenerationMode ?? 'manual',
          orchestrationSequence: -1,
          transitionType: input.transitionType,
          timestamp: input.timestamp ?? new Date().toISOString(),
          latencyMs: input.latencyMs,
          detail: input.detail,
          payload: input.payload,
        };
      }
      const event: ThreadRuntimeTraceEvent = {
        eventId,
        runtimeSessionId: input.runtimeSessionId,
        threadId: input.threadId,
        parentNodeId: input.parentNodeId ?? null,
        childNodeIds: input.childNodeIds ?? [],
        nodeGenerationMode: input.nodeGenerationMode ?? 'manual',
        orchestrationSequence: session.nextSequence++,
        transitionType: input.transitionType,
        timestamp: input.timestamp ?? new Date().toISOString(),
        latencyMs: input.latencyMs,
        detail: input.detail,
        payload: input.payload,
      };
      session.trace.events.push(event);
      session.seenEventIds.add(eventId);
      // event cap
      while (session.trace.events.length > eventCap) session.trace.events.shift();
      return event;
    },
    endSession(runtimeSessionId, timestamp) {
      const session = sessions.get(runtimeSessionId);
      if (!session) return;
      session.trace.endedAt = timestamp ?? new Date().toISOString();
      this.recordEvent({
        runtimeSessionId,
        threadId: session.trace.threadId,
        companyId: session.trace.companyId,
        transitionType: 'session_end',
        timestamp: session.trace.endedAt,
      });
    },
    getTrace(runtimeSessionId) {
      return sessions.get(runtimeSessionId)?.trace;
    },
    listTraces(companyId) {
      if (companyId) {
        const set = companyIndex.get(companyId);
        if (!set) return [];
        return Array.from(set).map((id) => sessions.get(id)?.trace).filter((t): t is ThreadRuntimeTrace => !!t);
      }
      const out: ThreadRuntimeTrace[] = [];
      sessions.forEach((s) => out.push(s.trace));
      return out;
    },
    listEvents(filter) {
      const traces = this.listTraces(filter?.companyId);
      const out: ThreadRuntimeTraceEvent[] = [];
      for (const t of traces) {
        for (const e of t.events) {
          if (filter?.threadId && e.threadId !== filter.threadId) continue;
          if (filter?.type && e.transitionType !== filter.type) continue;
          out.push(e);
        }
      }
      return out;
    },
    clear(companyId) {
      if (!companyId) { sessions.clear(); companyIndex.clear(); return; }
      const set = companyIndex.get(companyId);
      if (!set) return;
      for (const sid of set) sessions.delete(sid);
      companyIndex.delete(companyId);
    },
    size(companyId) {
      const traces = this.listTraces(companyId);
      let events = 0;
      for (const t of traces) events += t.events.length;
      return { sessions: traces.length, events };
    },
  };
}

let _default: ThreadRuntimeTraceRegistry | null = null;
export function getDefaultThreadRuntimeTraceRegistry(): ThreadRuntimeTraceRegistry {
  if (!_default) _default = createThreadRuntimeTraceRegistry();
  return _default;
}
export function setDefaultThreadRuntimeTraceRegistry(r: ThreadRuntimeTraceRegistry): void {
  _default = r;
}
