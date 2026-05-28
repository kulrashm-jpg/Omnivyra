/**
 * Phase 6 — Self-validating shadow run validator.
 *
 * Given (1) the trace + snapshot for a thread, and (2) the expected
 * topology shape (node count, manual/AI mix, parent-child links, ordering),
 * runs a battery of self-validation checks and surfaces:
 *
 *   - silent corruption (snapshot present, no events for the affected nodes)
 *   - partial persistence (persist_attempt without matching persist_success)
 *   - hidden orphans (snapshot reports orphan, no recovery emitted)
 *   - unstable joins (join_attempt without subsequent join_success)
 *
 * Returns a comprehensive `ShadowRunValidationResult` with per-axis booleans
 * and `validationPassed = AND of all axes + zero flags`.
 *
 * Pure / deterministic.
 */

import type {
  ShadowRunValidationResult,
  ThreadRuntimeTrace,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

export interface SelfValidateShadowRunInput {
  threadId: string;
  expectedNodeCount: number;
  trace: ThreadRuntimeTrace | null;
  snapshots: ThreadTopologySnapshot[];
}

export function selfValidateShadowRun(input: SelfValidateShadowRunInput): ShadowRunValidationResult {
  const latest = input.snapshots[input.snapshots.length - 1] ?? null;
  const events = input.trace?.events ?? [];
  const observedNodeCount = latest?.nodes.length ?? 0;

  // ── topology shape: node count + has root + reasonable parent topology ──
  const topologyShapeOk = !!latest
    && observedNodeCount === input.expectedNodeCount
    && latest.rootNodeId !== null;

  // ── ordering consistency ────────────────────────────────────────────
  const orderingConsistencyOk = latest ? latest.orderingIntegrity === 'monotonic' : true;

  // ── parent-child integrity ──────────────────────────────────────────
  const parentChildIntegrityOk = latest ? latest.joinIntegrity === 'intact' : true;

  // ── replay consistency: walking events should reconstruct the same node set ──
  let replayConsistencyOk = true;
  if (latest) {
    const reconstructed = new Set<string>();
    for (const e of events) {
      if (e.transitionType === 'node_create') {
        for (const id of e.childNodeIds) reconstructed.add(id);
      }
    }
    if (reconstructed.size > 0) {
      const observedIds = new Set(latest.nodes.map((n) => n.nodeId));
      // every observed id should have been emitted in a node_create event
      const missing = [...observedIds].filter((id) => !reconstructed.has(id));
      replayConsistencyOk = missing.length === 0;
    }
  }

  // ── refresh persistence: if a refresh_observed event exists, the latest
  //    snapshot should be reachable AFTER that event (i.e. captured later) ──
  let refreshPersistenceOk = true;
  const refreshEvents = events.filter((e) => e.transitionType === 'refresh_observed');
  if (refreshEvents.length > 0 && latest) {
    const lastRefreshTs = refreshEvents[refreshEvents.length - 1].timestamp;
    refreshPersistenceOk = Date.parse(latest.takenAt) >= Date.parse(lastRefreshTs);
  }

  // ── silent corruption: snapshot nodes whose ids never appear in any event ──
  const silentCorruptionFlags: string[] = [];
  if (latest && events.length > 0) {
    const eventNodeIds = new Set<string>();
    for (const e of events) {
      for (const id of e.childNodeIds) eventNodeIds.add(id);
      if (e.parentNodeId) eventNodeIds.add(e.parentNodeId);
    }
    for (const n of latest.nodes) {
      if (!eventNodeIds.has(n.nodeId)) silentCorruptionFlags.push(`node ${n.nodeId} present in snapshot but never appears in any trace event`);
    }
  }

  // ── partial persistence: persist_attempt without matching persist_success ──
  const partialPersistenceFlags: string[] = [];
  const persistAttempts = events.filter((e) => e.transitionType === 'persist_attempt');
  for (const a of persistAttempts) {
    const matched = events.some((e) =>
      e.transitionType === 'persist_success'
      && e.threadId === a.threadId
      && e.orchestrationSequence > a.orchestrationSequence,
    );
    if (!matched) partialPersistenceFlags.push(`persist_attempt @ seq=${a.orchestrationSequence} has no matching persist_success`);
  }

  // ── hidden orphans: snapshot orphans with no recovery_attempt afterwards ──
  const hiddenOrphanFlags: string[] = [];
  if (latest && latest.orphanNodeIds.length > 0) {
    const snapTs = Date.parse(latest.takenAt);
    const postSnapRecoveries = events.filter((e) =>
      e.transitionType === 'recovery_attempt' && Date.parse(e.timestamp) >= snapTs,
    ).length;
    if (postSnapRecoveries === 0) {
      for (const id of latest.orphanNodeIds) hiddenOrphanFlags.push(`orphan ${id} observed in latest snapshot but no recovery_attempt followed`);
    }
  }

  // ── unstable joins ──────────────────────────────────────────────────
  const unstableJoinFlags: string[] = [];
  const joinAttempts = events.filter((e) => e.transitionType === 'join_attempt');
  for (const a of joinAttempts) {
    const success = events.some((e) =>
      e.transitionType === 'join_success'
      && e.threadId === a.threadId
      && e.orchestrationSequence > a.orchestrationSequence,
    );
    const failure = events.some((e) =>
      e.transitionType === 'join_failure'
      && e.threadId === a.threadId
      && e.orchestrationSequence > a.orchestrationSequence,
    );
    if (!success && !failure) unstableJoinFlags.push(`join_attempt @ seq=${a.orchestrationSequence} reached neither success nor failure`);
  }

  const validationPassed = topologyShapeOk
    && orderingConsistencyOk
    && parentChildIntegrityOk
    && replayConsistencyOk
    && refreshPersistenceOk
    && silentCorruptionFlags.length === 0
    && partialPersistenceFlags.length === 0
    && hiddenOrphanFlags.length === 0
    && unstableJoinFlags.length === 0;

  return {
    threadId: input.threadId,
    expectedNodeCount: input.expectedNodeCount,
    observedNodeCount,
    topologyShapeOk,
    orderingConsistencyOk,
    parentChildIntegrityOk,
    replayConsistencyOk,
    refreshPersistenceOk,
    silentCorruptionFlags,
    partialPersistenceFlags,
    hiddenOrphanFlags,
    unstableJoinFlags,
    validationPassed,
  };
}
