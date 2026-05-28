/**
 * Phase 5 — Live thread runtime diagnostics.
 *
 * Reads the trace registry and computes latency + frequency metrics:
 *   - node creation latency
 *   - orchestration latency (session_start → first node_create)
 *   - persistence latency
 *   - reorder latency
 *   - topology mutation freq (creates + reorders per minute)
 *   - orphan suppression freq (failure_summary detections of orphan_generation per minute)
 *   - join repair freq (join_attempt → join_success per minute)
 *
 * Composite `runtimeHealthScore` blends latency normalcy + failure absence.
 *
 * Pure / deterministic.
 */

import type {
  ThreadRuntimeDiagnosticsResult,
  ThreadRuntimeTrace,
} from './threadRuntimeTypes';

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function spanMinutes(events: { timestamp: string }[]): number {
  if (events.length < 2) return 1; // avoid divide-by-zero
  const first = Date.parse(events[0].timestamp);
  const last = Date.parse(events[events.length - 1].timestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 1;
  return Math.max(1, (last - first) / 60_000);
}

export interface ComputeDiagnosticsInput {
  traces: ThreadRuntimeTrace[];
}

export function computeThreadRuntimeDiagnostics(input: ComputeDiagnosticsInput): ThreadRuntimeDiagnosticsResult {
  const allEvents = input.traces.flatMap((t) => t.events);
  const sampleSize = allEvents.length;

  if (sampleSize === 0) {
    return {
      nodeCreationLatencyMsAvg: 0,
      orchestrationLatencyMsAvg: 0,
      persistenceLatencyMsAvg: 0,
      reorderLatencyMsAvg: 0,
      topologyMutationFrequencyPerMin: 0,
      orphanSuppressionFrequencyPerMin: 0,
      joinRepairFrequencyPerMin: 0,
      runtimeHealthScore: 100,
      sampleSize: 0,
    };
  }

  // ── latencies ────────────────────────────────────────────────────────
  const nodeCreateLatencies = allEvents
    .filter((e) => e.transitionType === 'node_create' && typeof e.latencyMs === 'number')
    .map((e) => e.latencyMs!);
  const persistLatencies = allEvents
    .filter((e) => e.transitionType === 'persist_success' && typeof e.latencyMs === 'number')
    .map((e) => e.latencyMs!);
  const reorderLatencies = allEvents
    .filter((e) => e.transitionType === 'node_reorder' && typeof e.latencyMs === 'number')
    .map((e) => e.latencyMs!);

  // Orchestration latency = session_start → first node_create per session
  const orchestrationLatencies: number[] = [];
  for (const t of input.traces) {
    const start = t.events.find((e) => e.transitionType === 'session_start');
    const firstCreate = t.events.find((e) => e.transitionType === 'node_create');
    if (!start || !firstCreate) continue;
    const delta = Date.parse(firstCreate.timestamp) - Date.parse(start.timestamp);
    if (Number.isFinite(delta) && delta >= 0) orchestrationLatencies.push(delta);
  }

  // ── frequencies (per minute) ─────────────────────────────────────────
  const totalMinutes = spanMinutes(allEvents);
  const topologyMutationCount = allEvents.filter((e) => e.transitionType === 'node_create' || e.transitionType === 'node_reorder' || e.transitionType === 'node_edit').length;
  const topologyMutationFrequencyPerMin = Math.round(topologyMutationCount / totalMinutes);

  // Orphan suppression — counted as recovery events that follow a node_create
  // missing a valid parent. Heuristic: count recovery_success events.
  const orphanSuppressionCount = allEvents.filter((e) => e.transitionType === 'recovery_success').length;
  const orphanSuppressionFrequencyPerMin = Math.round(orphanSuppressionCount / totalMinutes);

  // Join repair — paired join_attempt + subsequent join_success
  let joinRepairCount = 0;
  for (let i = 0; i < allEvents.length; i += 1) {
    if (allEvents[i].transitionType !== 'join_attempt') continue;
    for (let j = i + 1; j < allEvents.length; j += 1) {
      if (allEvents[j].transitionType === 'join_success' && allEvents[j].threadId === allEvents[i].threadId) {
        joinRepairCount += 1;
        break;
      }
      if (allEvents[j].transitionType === 'join_attempt') break;
    }
  }
  const joinRepairFrequencyPerMin = Math.round(joinRepairCount / totalMinutes);

  // ── composite runtime health ──────────────────────────────────────────
  const failureCount = allEvents.filter((e) =>
    e.transitionType === 'persist_failure'
    || e.transitionType === 'join_failure'
    || e.transitionType === 'recovery_failure'
  ).length;
  const failurePct = Math.round((failureCount / Math.max(1, allEvents.length)) * 100);
  // Latency penalty: persist > 5000ms → −20pts; > 2000ms → −10pts; otherwise 0.
  const persistAvg = avg(persistLatencies);
  const latencyPenalty = persistAvg > 5000 ? 20 : persistAvg > 2000 ? 10 : 0;
  const runtimeHealthScore = clamp100(100 - failurePct - latencyPenalty);

  return {
    nodeCreationLatencyMsAvg: Math.round(avg(nodeCreateLatencies)),
    orchestrationLatencyMsAvg: Math.round(avg(orchestrationLatencies)),
    persistenceLatencyMsAvg: Math.round(persistAvg),
    reorderLatencyMsAvg: Math.round(avg(reorderLatencies)),
    topologyMutationFrequencyPerMin,
    orphanSuppressionFrequencyPerMin,
    joinRepairFrequencyPerMin,
    runtimeHealthScore,
    sampleSize,
  };
}
