/**
 * Phase 6 — Runtime forensic analyzer.
 *
 * Consumes a reconstructed trace (from globalRuntimeReplayReconstructor)
 * plus snapshots (when available) and produces a forensic report
 * suitable for an operator post-incident review.
 *
 * Inputs are reconstructed events, not raw registry events, so this layer
 * works equally well on local + distributed replays.
 *
 * Pure / deterministic. No I/O.
 */

import type {
  RuntimeForensicReport,
  ThreadRuntimeTrace,
  ThreadRuntimeTraceEvent,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

const FAILURE_TYPES = new Set<ThreadRuntimeTraceEvent['transitionType']>([
  'persist_failure', 'join_failure', 'recovery_failure',
]);

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface AnalyzeForensicsInput {
  trace: ThreadRuntimeTrace;
  snapshots?: ThreadTopologySnapshot[];
  /** Optional baseline of healthy trace event counts (used in comparison score). */
  healthyBaseline?: { successesPerSession?: number; failuresPerSession?: number };
}

export function analyzeRuntimeForensics(input: AnalyzeForensicsInput): RuntimeForensicReport {
  const events = [...input.trace.events].sort((a, b) => a.orchestrationSequence - b.orchestrationSequence);
  const failureChain: RuntimeForensicReport['failureChain'] = events
    .filter((e) => FAILURE_TYPES.has(e.transitionType))
    .map((e) => ({ eventId: e.eventId, transitionType: e.transitionType, detail: e.detail ?? '(no detail)', timestamp: e.timestamp }));

  // Topology corruption: time window between first orphan-flag snapshot and
  // the next intact one (or end of trace).
  let topologyCorruptionOriginEventId: string | null = null;
  let topologyCorruptionWindow: RuntimeForensicReport['topologyCorruptionWindow'] = null;
  if (input.snapshots && input.snapshots.length > 0) {
    let firstCorrupt: { idx: number; takenMs: number } | null = null;
    for (let i = 0; i < input.snapshots.length; i += 1) {
      const s = input.snapshots[i];
      const corrupted = s.orphanNodeIds.length > 0 || s.joinIntegrity !== 'intact' || s.orderingIntegrity !== 'monotonic';
      if (corrupted && !firstCorrupt) {
        const ms = Date.parse(s.takenAt);
        if (Number.isFinite(ms)) firstCorrupt = { idx: i, takenMs: ms };
      }
    }
    if (firstCorrupt) {
      // find restoration (next intact snapshot)
      let endMs = firstCorrupt.takenMs;
      for (let j = firstCorrupt.idx + 1; j < input.snapshots.length; j += 1) {
        const s = input.snapshots[j];
        const intact = s.orphanNodeIds.length === 0 && s.joinIntegrity === 'intact' && s.orderingIntegrity === 'monotonic';
        if (intact) {
          const ms = Date.parse(s.takenAt);
          if (Number.isFinite(ms)) endMs = ms;
          break;
        }
        const ms = Date.parse(s.takenAt);
        if (Number.isFinite(ms)) endMs = ms;
      }
      topologyCorruptionWindow = { startMs: firstCorrupt.takenMs, endMs };
      // Origin event: persist_failure / join_failure closest to the start time.
      const candidate = [...failureChain]
        .filter((f) => {
          const ts = Date.parse(f.timestamp);
          return Number.isFinite(ts) && ts >= firstCorrupt!.takenMs - 5000 && ts <= firstCorrupt!.takenMs + 5000;
        })
        .sort((a, b) => Math.abs(Date.parse(a.timestamp) - firstCorrupt!.takenMs) - Math.abs(Date.parse(b.timestamp) - firstCorrupt!.takenMs))[0];
      topologyCorruptionOriginEventId = candidate?.eventId ?? null;
    }
  }

  // Lifecycle transition replay — sequence of (fromState, toState) for
  // persist + join + recovery pairs.
  const lifecycleTransitionReplay: RuntimeForensicReport['lifecycleTransitionReplay'] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.transitionType === 'persist_attempt') lifecycleTransitionReplay.push({ fromState: 'idle', toState: 'persisting', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'persist_success') lifecycleTransitionReplay.push({ fromState: 'persisting', toState: 'persisted', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'persist_failure') lifecycleTransitionReplay.push({ fromState: 'persisting', toState: 'failed', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'join_attempt') lifecycleTransitionReplay.push({ fromState: 'detached', toState: 'joining', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'join_success') lifecycleTransitionReplay.push({ fromState: 'joining', toState: 'joined', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'join_failure') lifecycleTransitionReplay.push({ fromState: 'joining', toState: 'disjoint', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'recovery_attempt') lifecycleTransitionReplay.push({ fromState: 'failed', toState: 'recovering', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'recovery_success') lifecycleTransitionReplay.push({ fromState: 'recovering', toState: 'recovered', atSequence: e.orchestrationSequence });
    else if (e.transitionType === 'recovery_failure') lifecycleTransitionReplay.push({ fromState: 'recovering', toState: 'unrecoverable', atSequence: e.orchestrationSequence });
  }

  // Instability pattern classification
  let instabilityPattern: RuntimeForensicReport['instabilityPattern'] = 'none';
  if (failureChain.length === 0) {
    instabilityPattern = 'none';
  } else if (failureChain.length >= 3) {
    // count flips: failure → success → failure ...
    let flips = 0;
    let prev: 'success' | 'failure' | null = null;
    for (const e of events) {
      const isSuccess = e.transitionType === 'persist_success' || e.transitionType === 'recovery_success' || e.transitionType === 'join_success';
      const isFailure = FAILURE_TYPES.has(e.transitionType);
      const cur = isSuccess ? 'success' : isFailure ? 'failure' : null;
      if (cur && prev && cur !== prev) flips += 1;
      if (cur) prev = cur;
    }
    if (flips >= 3) instabilityPattern = 'flapping';
    else instabilityPattern = 'cascading_failure';
  } else {
    // Single failure context
    const hasOrphans = (input.snapshots ?? []).some((s) => s.orphanNodeIds.length > 0);
    if (hasOrphans) instabilityPattern = 'orphan_cluster';
    else instabilityPattern = 'silent_drift';
  }

  // Replay break origin: first event with orchestrationSequence != prev + 1
  // (gap in the canonical sequence indicates a missing replay record).
  let replayBreakOrigin: RuntimeForensicReport['replayBreakOrigin'] = null;
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const cur = events[i];
    const expected = prev.orchestrationSequence + 1;
    if (cur.orchestrationSequence > expected + 1) {
      replayBreakOrigin = { eventId: cur.eventId, reason: `sequence gap ${prev.orchestrationSequence} → ${cur.orchestrationSequence}` };
      break;
    }
  }
  if (instabilityPattern === 'silent_drift' && replayBreakOrigin) {
    instabilityPattern = 'replay_break';
  }

  // Probable root cause: prefer the FIRST event in the failureChain, else a
  // topology-corruption origin, else a sequence-break.
  const firstFailure = failureChain[0];
  const probableRootCause = firstFailure
    ? `${firstFailure.transitionType}: ${firstFailure.detail}`
    : topologyCorruptionOriginEventId
      ? `topology corruption originated at event ${topologyCorruptionOriginEventId}`
      : replayBreakOrigin
        ? replayBreakOrigin.reason
        : 'no anomalies detected';

  // Comparison score against healthy baseline
  const healthyFailuresExpected = input.healthyBaseline?.failuresPerSession ?? 0;
  const failureSurplus = Math.max(0, failureChain.length - healthyFailuresExpected);
  const comparisonToHealthyRunsScore = clamp100(100 - failureSurplus * 20);

  return {
    threadId: input.trace.threadId,
    failureChain,
    topologyCorruptionOriginEventId,
    topologyCorruptionWindow,
    lifecycleTransitionReplay,
    instabilityPattern,
    probableRootCause,
    comparisonToHealthyRunsScore,
    replayBreakOrigin,
  };
}
