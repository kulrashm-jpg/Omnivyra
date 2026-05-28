/**
 * Phase 7 — Long-horizon runtime analytics aggregator.
 *
 * Queries the PersistentTraceStore for a time window and emits aggregate
 * metrics suitable for ops dashboards / weekly review.
 *
 * Pure (no I/O) once the store is supplied.
 */

import type {
  PersistedRuntimeEvent,
  RuntimeAnalytics,
} from './threadRuntimeTypes';
import {
  getDefaultPersistentTraceStore,
  type PersistentTraceStore,
} from './persistentTraceStore';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function pct(numer: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((numer / denom) * 100);
}

export interface AggregateAnalyticsInput {
  store?: PersistentTraceStore;
  companyId: string;
  sinceISO: string;
  untilISO?: string;
  /** Optional cap on number of events scanned. Default 50k. */
  scanLimit?: number;
}

export async function aggregateRuntimeAnalytics(input: AggregateAnalyticsInput): Promise<RuntimeAnalytics> {
  const store = input.store ?? getDefaultPersistentTraceStore();
  const events = await store.query({
    companyId: input.companyId,
    sinceISO: input.sinceISO,
    untilISO: input.untilISO,
    limit: Math.max(100, input.scanLimit ?? 50_000),
  });

  const sampleSize = events.length;
  const startMs = Date.parse(input.sinceISO);
  const endMs = input.untilISO ? Date.parse(input.untilISO) : Date.now();
  const windowMs = Math.max(60_000, (Number.isFinite(endMs) && Number.isFinite(startMs)) ? endMs - startMs : 60_000);
  const windowHours = windowMs / 3_600_000;

  if (sampleSize === 0) {
    return {
      windowMs, sampleSize: 0,
      replayIntegrityScore: 100,
      orphanFrequencyPerHour: 0,
      recoverySuccessRatePercent: 100,
      topologyInstabilityScore: 0,
      transportRetryRatePercent: 0,
      lifecycleCorruptionRatePercent: 0,
      averageNodeCreationLatencyMs: 0,
      averagePersistLatencyMs: 0,
      crossInstanceContinuityScore: 100,
    };
  }

  // Count events by type
  const counts = new Map<PersistedRuntimeEvent['eventType'], number>();
  for (const e of events) counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
  const get = (t: PersistedRuntimeEvent['eventType']) => counts.get(t) ?? 0;

  // ── replayIntegrityScore — fraction of sessions whose events are
  //    monotonic in (sequence, timestamp).
  const sessions = new Map<string, PersistedRuntimeEvent[]>();
  for (const e of events) {
    const arr = sessions.get(e.runtimeSessionId) ?? [];
    arr.push(e);
    sessions.set(e.runtimeSessionId, arr);
  }
  let monotonicSessions = 0;
  for (const [, evs] of sessions) {
    const sorted = [...evs].sort((a, b) => a.orchestrationSequence - b.orchestrationSequence);
    let ok = true;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].orchestrationSequence <= sorted[i - 1].orchestrationSequence) { ok = false; break; }
      if (Date.parse(sorted[i].timestamp) < Date.parse(sorted[i - 1].timestamp)) { ok = false; break; }
    }
    if (ok) monotonicSessions += 1;
  }
  const replayIntegrityScore = sessions.size === 0 ? 100 : clamp100((monotonicSessions / sessions.size) * 100);

  // ── orphan frequency: count failure events tagged orphan_* OR persist_failure with detail containing 'orphan'
  const orphanish = events.filter((e) =>
    e.eventType === 'persist_failure'
    || e.eventType === 'recovery_failure'
    || e.eventType === 'join_failure',
  ).length;
  const orphanFrequencyPerHour = Math.round((orphanish / windowHours) * 100) / 100;

  // ── recovery success rate
  const recoveryAttempts = get('recovery_attempt');
  const recoverySuccess = get('recovery_success');
  const recoverySuccessRatePercent = pct(recoverySuccess, recoveryAttempts);

  // ── topology instability score: weighted sum of failure events normalized to per-hour
  const persistFailures = get('persist_failure');
  const joinFailures = get('join_failure');
  const recoveryFailures = get('recovery_failure');
  const failuresPerHour = (persistFailures + joinFailures + recoveryFailures) / windowHours;
  const topologyInstabilityScore = clamp100(Math.min(100, failuresPerHour * 15));

  // ── transport retry rate: payload extra carries `retryAttempt`? heuristic
  let retryEvents = 0;
  for (const e of events) {
    const extra = (e.payloadJson as { retryAttempt?: number } | null | undefined)?.retryAttempt;
    if (typeof extra === 'number' && extra > 0) retryEvents += 1;
  }
  const transportRetryRatePercent = pct(retryEvents, sampleSize);

  // ── lifecycle corruption: persist_attempt without matching persist_success/failure
  let openLifecycles = 0;
  for (const [, evs] of sessions) {
    const attempts = evs.filter((e) => e.eventType === 'persist_attempt' || e.eventType === 'join_attempt' || e.eventType === 'recovery_attempt');
    for (const a of attempts) {
      const matched = evs.some((e) =>
        e.orchestrationSequence > a.orchestrationSequence
        && (e.eventType === `${a.eventType.replace('_attempt', '_success')}` as PersistedRuntimeEvent['eventType']
          || e.eventType === `${a.eventType.replace('_attempt', '_failure')}` as PersistedRuntimeEvent['eventType']));
      if (!matched) openLifecycles += 1;
    }
  }
  const totalAttempts = get('persist_attempt') + get('join_attempt') + get('recovery_attempt');
  const lifecycleCorruptionRatePercent = pct(openLifecycles, totalAttempts);

  // ── average latencies (extract from payload)
  const nodeLatencies: number[] = [];
  const persistLatencies: number[] = [];
  for (const e of events) {
    const lat = (e.payloadJson as { latencyMs?: number } | null | undefined)?.latencyMs;
    if (typeof lat !== 'number') continue;
    if (e.eventType === 'node_create') nodeLatencies.push(lat);
    if (e.eventType === 'persist_success') persistLatencies.push(lat);
  }
  const avg = (vs: number[]) => (vs.length === 0 ? 0 : Math.round(vs.reduce((s, v) => s + v, 0) / vs.length));

  // ── cross-instance continuity: fraction of sessions where ALL events
  //    share one sourceSurface (i.e. didn't migrate between instances).
  //    Lower fraction = more continuity (events spread across writers).
  let migratedSessions = 0;
  for (const [, evs] of sessions) {
    const surfaceSet = new Set(evs.map((e) => e.sourceSurface));
    if (surfaceSet.size > 1) migratedSessions += 1;
  }
  const crossInstanceContinuityScore = sessions.size === 0 ? 100 : clamp100(100 - (migratedSessions / sessions.size) * 50);

  return {
    windowMs,
    sampleSize,
    replayIntegrityScore,
    orphanFrequencyPerHour,
    recoverySuccessRatePercent,
    topologyInstabilityScore,
    transportRetryRatePercent,
    lifecycleCorruptionRatePercent,
    averageNodeCreationLatencyMs: avg(nodeLatencies),
    averagePersistLatencyMs: avg(persistLatencies),
    crossInstanceContinuityScore,
  };
}
