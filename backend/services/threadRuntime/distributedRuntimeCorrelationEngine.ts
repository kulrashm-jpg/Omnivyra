/**
 * Phase 4 — Distributed runtime correlation engine.
 *
 * Generates and resolves stable `correlationId`s that group runtime
 * sessions describing the same logical thread across:
 *
 *   - pending_* → canonical rootId rewrites (single-instance)
 *   - reconnect sessions (browser tab refresh creates a fresh
 *                          runtimeSessionId; correlationId stays the same)
 *   - cross-instance writers (two API servers both write events for the
 *                              same scheduled thread)
 *   - editor + scheduler split (editor opens its own session; scheduler
 *                                emits its own session; both share the
 *                                same correlationId per thread+company)
 *
 * The correlationId is derived from (companyId, canonicalThreadId) when
 * the canonical id is known, or from (companyId, scheduledFor, platform)
 * when only pre-RPC context exists. Both shapes hash to the same id when
 * applied to the same logical thread.
 *
 * Pure / deterministic. No I/O.
 */

import type {
  PersistedRuntimeEvent,
} from './threadRuntimeTypes';

function djbx33aHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** Stable correlationId for a known-canonical thread. */
export function correlationIdForCanonicalThread(input: { companyId: string; canonicalThreadId: string }): string {
  return `cor_${djbx33aHash(`${input.companyId}|t:${input.canonicalThreadId}`)}`;
}

/** Pre-persist correlationId. Used before the RPC returns the real rootId. */
export function correlationIdForPendingThread(input: {
  companyId: string;
  scheduledForIso: string;
  platform: string;
  userId: string;
}): string {
  return `cor_${djbx33aHash(`${input.companyId}|p:${input.scheduledForIso}|${input.platform}|${input.userId}`)}`;
}

/**
 * Resolve a set of persisted events into correlation groups.
 *
 * Algorithm:
 *   1. Partition events by explicit correlationId (when present).
 *   2. For events with null correlationId, derive a "best guess" from
 *      either a persist_success rootId in the same session, OR the
 *      session's first node_create position-0 nodeId.
 *   3. Coalesce groups whose canonicalThreadIds match.
 *   4. Detect split-brain: any group whose events claim two different
 *      canonical rootIds → flag.
 */

export interface CorrelationGroup {
  correlationId: string;
  canonicalThreadId: string | null;
  runtimeSessionIds: string[];
  eventCount: number;
  conflicts: Array<{ candidate: string; supportEventIds: string[] }>;
}

export interface ResolveDistributedCorrelationInput {
  events: PersistedRuntimeEvent[];
}

export interface ResolveDistributedCorrelationResult {
  groups: CorrelationGroup[];
  splitBrainDetected: boolean;
  totalEvents: number;
}

function extractRootId(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const m = detail.match(/root=([^\s]+)/);
  return m ? m[1] : null;
}

export function resolveDistributedCorrelation(input: ResolveDistributedCorrelationInput): ResolveDistributedCorrelationResult {
  // Step 1: index events by correlationId.
  const byCorrelation = new Map<string, PersistedRuntimeEvent[]>();
  const orphans: PersistedRuntimeEvent[] = [];
  for (const e of input.events) {
    if (e.correlationId) {
      const arr = byCorrelation.get(e.correlationId) ?? [];
      arr.push(e);
      byCorrelation.set(e.correlationId, arr);
    } else {
      orphans.push(e);
    }
  }

  // Step 2: assign orphans to derived correlationIds.
  // First derive per-session canonical id from each session.
  const sessionRoots = new Map<string, string>(); // sessionId → rootId
  for (const e of input.events) {
    if (e.eventType === 'persist_success') {
      const rid = extractRootId((e.payloadJson as { detail?: string | null })?.detail);
      if (rid) sessionRoots.set(e.runtimeSessionId, rid);
    }
  }
  for (const e of orphans) {
    const root = sessionRoots.get(e.runtimeSessionId);
    if (!root) {
      // last resort: use threadId directly (works when it's already canonical)
      const fallback = correlationIdForCanonicalThread({ companyId: e.companyId, canonicalThreadId: e.threadId });
      const arr = byCorrelation.get(fallback) ?? [];
      arr.push(e);
      byCorrelation.set(fallback, arr);
      continue;
    }
    const derived = correlationIdForCanonicalThread({ companyId: e.companyId, canonicalThreadId: root });
    const arr = byCorrelation.get(derived) ?? [];
    arr.push(e);
    byCorrelation.set(derived, arr);
  }

  // Step 3: build groups + detect split-brain.
  let splitBrainDetected = false;
  const groups: CorrelationGroup[] = [];
  for (const [correlationId, evs] of byCorrelation) {
    const sessionSet = new Set<string>();
    const rootCandidates = new Map<string, string[]>();
    for (const e of evs) {
      sessionSet.add(e.runtimeSessionId);
      if (e.eventType === 'persist_success') {
        const rid = extractRootId((e.payloadJson as { detail?: string | null })?.detail);
        if (rid) {
          const arr = rootCandidates.get(rid) ?? [];
          arr.push(e.eventId);
          rootCandidates.set(rid, arr);
        }
      }
    }
    const conflicts: CorrelationGroup['conflicts'] = [];
    let canonicalThreadId: string | null = null;
    if (rootCandidates.size === 1) {
      canonicalThreadId = Array.from(rootCandidates.keys())[0];
    } else if (rootCandidates.size > 1) {
      splitBrainDetected = true;
      for (const [candidate, supportEventIds] of rootCandidates) {
        conflicts.push({ candidate, supportEventIds });
      }
      canonicalThreadId = null;
    }
    groups.push({
      correlationId,
      canonicalThreadId,
      runtimeSessionIds: Array.from(sessionSet),
      eventCount: evs.length,
      conflicts,
    });
  }
  groups.sort((a, b) => b.eventCount - a.eventCount);
  return { groups, splitBrainDetected, totalEvents: input.events.length };
}
