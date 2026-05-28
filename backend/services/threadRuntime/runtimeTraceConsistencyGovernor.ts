/**
 * Phase 5 (wiring) — Runtime trace consistency governor.
 *
 * Validates the SHAPE of the trace stream itself, independent of any
 * application semantics:
 *
 *   - monotonic orchestrationSequence per session
 *   - timestamp order respects sequence order (non-decreasing)
 *   - lifecycle closure integrity:
 *       persist_attempt → persist_success | persist_failure (one terminator)
 *       join_attempt → join_success | join_failure
 *       recovery_attempt → recovery_success | recovery_failure
 *       session_start → exactly one session_end (or open session)
 *   - parent-child event integrity:
 *       node_edit / node_reorder must reference a previously-created node id
 *   - replay graph continuity: a node referenced as parentNodeId must have
 *     been emitted in an earlier node_create
 *   - no duplicate lifecycle terminators (e.g. two persist_success for the
 *     same persist_attempt)
 *   - no impossible transitions (e.g. session_end before session_start)
 *
 * Pure / deterministic. Operates on a single trace.
 */

import type { ThreadRuntimeTrace } from './threadRuntimeTypes';

export type TraceConsistencyIssueType =
  | 'non_monotonic_sequence'
  | 'timestamp_disorder'
  | 'dangling_persist'
  | 'dangling_join'
  | 'dangling_recovery'
  | 'duplicate_terminator'
  | 'orphan_reference'
  | 'broken_replay_chain'
  | 'impossible_transition'
  | 'multiple_session_starts'
  | 'event_before_session_start';

export interface TraceConsistencyIssue {
  type: TraceConsistencyIssueType;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  eventIds: string[];
}

export interface TraceConsistencyResult {
  ok: boolean;
  issues: TraceConsistencyIssue[];
  sequenceCount: number;
  closedLifecycles: number;
  openLifecycles: number;
}

interface LifecyclePairCheck {
  attemptType: string;
  successType: string;
  failureType: string;
  danglingIssue: TraceConsistencyIssueType;
}

const LIFECYCLE_PAIRS: LifecyclePairCheck[] = [
  { attemptType: 'persist_attempt', successType: 'persist_success', failureType: 'persist_failure', danglingIssue: 'dangling_persist' },
  { attemptType: 'join_attempt', successType: 'join_success', failureType: 'join_failure', danglingIssue: 'dangling_join' },
  { attemptType: 'recovery_attempt', successType: 'recovery_success', failureType: 'recovery_failure', danglingIssue: 'dangling_recovery' },
];

export interface CheckTraceConsistencyInput {
  trace: ThreadRuntimeTrace;
  /** allow an "open" session (no session_end) without flagging — true for live runs */
  allowOpenSession?: boolean;
}

export function checkTraceConsistency(input: CheckTraceConsistencyInput): TraceConsistencyResult {
  const events = input.trace.events;
  const issues: TraceConsistencyIssue[] = [];

  // ── 1. monotonic orchestrationSequence ────────────────────────────────
  let prevSeq = 0;
  for (const e of events) {
    if (e.orchestrationSequence <= prevSeq) {
      issues.push({
        type: 'non_monotonic_sequence', severity: 'high',
        detail: `event ${e.eventId} has orchestrationSequence=${e.orchestrationSequence}; previous was ${prevSeq}`,
        eventIds: [e.eventId],
      });
    }
    prevSeq = Math.max(prevSeq, e.orchestrationSequence);
  }

  // ── 2. timestamp order respects sequence order ────────────────────────
  for (let i = 1; i < events.length; i += 1) {
    const a = events[i - 1];
    const b = events[i];
    const at = Date.parse(a.timestamp);
    const bt = Date.parse(b.timestamp);
    if (Number.isFinite(at) && Number.isFinite(bt) && bt < at) {
      issues.push({
        type: 'timestamp_disorder', severity: 'medium',
        detail: `event ${b.eventId} (seq ${b.orchestrationSequence}) timestamp ${b.timestamp} precedes earlier event ${a.eventId} (seq ${a.orchestrationSequence}, ${a.timestamp})`,
        eventIds: [a.eventId, b.eventId],
      });
    }
  }

  // ── 3. session lifecycle ──────────────────────────────────────────────
  const sessionStarts = events.filter((e) => e.transitionType === 'session_start');
  const sessionEnds = events.filter((e) => e.transitionType === 'session_end');
  if (sessionStarts.length > 1) {
    issues.push({
      type: 'multiple_session_starts', severity: 'high',
      detail: `trace contains ${sessionStarts.length} session_start events`,
      eventIds: sessionStarts.map((e) => e.eventId),
    });
  }
  if (sessionStarts.length === 1 && events.length > 0 && events[0].transitionType !== 'session_start') {
    issues.push({
      type: 'event_before_session_start', severity: 'medium',
      detail: `first event in trace is ${events[0].transitionType}, not session_start`,
      eventIds: [events[0].eventId],
    });
  }
  if (sessionEnds.length > 1) {
    issues.push({
      type: 'impossible_transition', severity: 'high',
      detail: `trace contains ${sessionEnds.length} session_end events`,
      eventIds: sessionEnds.map((e) => e.eventId),
    });
  }
  if (sessionStarts.length === 1 && sessionEnds.length === 1) {
    const startSeq = sessionStarts[0].orchestrationSequence;
    const endSeq = sessionEnds[0].orchestrationSequence;
    if (endSeq <= startSeq) {
      issues.push({
        type: 'impossible_transition', severity: 'high',
        detail: `session_end (seq ${endSeq}) precedes or equals session_start (seq ${startSeq})`,
        eventIds: [sessionStarts[0].eventId, sessionEnds[0].eventId],
      });
    }
  }

  // ── 4. lifecycle pair closure ─────────────────────────────────────────
  let closedLifecycles = 0;
  let openLifecycles = 0;
  for (const pair of LIFECYCLE_PAIRS) {
    const attempts = events.filter((e) => e.transitionType === pair.attemptType);
    for (const a of attempts) {
      // Find the nearest subsequent success or failure for the same threadId.
      const successesAfter = events.filter((e) =>
        e.transitionType === pair.successType
        && e.threadId === a.threadId
        && e.orchestrationSequence > a.orchestrationSequence,
      );
      const failuresAfter = events.filter((e) =>
        e.transitionType === pair.failureType
        && e.threadId === a.threadId
        && e.orchestrationSequence > a.orchestrationSequence,
      );

      // Find the next attempt after this one (for the same threadId) — its
      // sequence is the boundary for "matched terminator must come before
      // the next attempt".
      const nextAttempt = events.find((e) =>
        e.transitionType === pair.attemptType
        && e.threadId === a.threadId
        && e.orchestrationSequence > a.orchestrationSequence,
      );
      const boundary = nextAttempt?.orchestrationSequence ?? Number.POSITIVE_INFINITY;

      const successesInWindow = successesAfter.filter((e) => e.orchestrationSequence < boundary);
      const failuresInWindow = failuresAfter.filter((e) => e.orchestrationSequence < boundary);

      const terminatorCount = successesInWindow.length + failuresInWindow.length;
      if (terminatorCount === 0) {
        // dangling
        openLifecycles += 1;
        issues.push({
          type: pair.danglingIssue, severity: 'medium',
          detail: `${pair.attemptType} @ seq=${a.orchestrationSequence} for thread ${a.threadId} has no matching ${pair.successType} or ${pair.failureType}`,
          eventIds: [a.eventId],
        });
      } else if (terminatorCount > 1) {
        // duplicate terminator
        const terminators = [...successesInWindow, ...failuresInWindow];
        issues.push({
          type: 'duplicate_terminator', severity: 'medium',
          detail: `${pair.attemptType} @ seq=${a.orchestrationSequence} has ${terminatorCount} terminators in its window`,
          eventIds: [a.eventId, ...terminators.map((t) => t.eventId)],
        });
        closedLifecycles += 1;
      } else {
        closedLifecycles += 1;
      }
    }

    // Orphan terminators: successType / failureType without a preceding attempt
    const allTerminators = events.filter((e) => e.transitionType === pair.successType || e.transitionType === pair.failureType);
    for (const term of allTerminators) {
      const hadAttempt = events.some((e) =>
        e.transitionType === pair.attemptType
        && e.threadId === term.threadId
        && e.orchestrationSequence < term.orchestrationSequence,
      );
      if (!hadAttempt) {
        issues.push({
          type: 'impossible_transition', severity: 'high',
          detail: `${term.transitionType} @ seq=${term.orchestrationSequence} has no preceding ${pair.attemptType}`,
          eventIds: [term.eventId],
        });
      }
    }
  }

  // ── 5. parent-child + replay graph continuity ────────────────────────
  const createdNodeIds = new Set<string>();
  // walk in sequence order
  for (const e of events) {
    if (e.transitionType === 'node_create') {
      for (const id of e.childNodeIds) createdNodeIds.add(id);
      if (e.parentNodeId && !createdNodeIds.has(e.parentNodeId)) {
        issues.push({
          type: 'broken_replay_chain', severity: 'high',
          detail: `node_create @ seq=${e.orchestrationSequence} references parent ${e.parentNodeId} that was never created earlier`,
          eventIds: [e.eventId],
        });
      }
      continue;
    }
    if (e.transitionType === 'node_edit' || e.transitionType === 'node_reorder') {
      for (const id of e.childNodeIds) {
        if (!createdNodeIds.has(id)) {
          issues.push({
            type: 'orphan_reference', severity: 'medium',
            detail: `${e.transitionType} @ seq=${e.orchestrationSequence} references node ${id} that was never created`,
            eventIds: [e.eventId],
          });
        }
      }
    }
    // join_* events should reference known parents
    if (e.transitionType === 'join_attempt' || e.transitionType === 'join_success' || e.transitionType === 'join_failure') {
      if (e.parentNodeId && !createdNodeIds.has(e.parentNodeId)) {
        issues.push({
          type: 'orphan_reference', severity: 'medium',
          detail: `${e.transitionType} @ seq=${e.orchestrationSequence} references parent ${e.parentNodeId} that was never created`,
          eventIds: [e.eventId],
        });
      }
    }
  }

  // ── 6. open session policy ─────────────────────────────────────────────
  if (sessionStarts.length === 1 && sessionEnds.length === 0 && !input.allowOpenSession && events.length > 1) {
    issues.push({
      type: 'dangling_recovery', severity: 'low',
      detail: 'trace has session_start but no session_end (set allowOpenSession=true for live sessions)',
      eventIds: [sessionStarts[0].eventId],
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    sequenceCount: events.length,
    closedLifecycles,
    openLifecycles,
  };
}
