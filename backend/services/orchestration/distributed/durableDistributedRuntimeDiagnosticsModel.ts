/** Part 1/2 of durableDistributedRuntimeDiagnostics.ts — verbatim split (barrel preserved; importers unchanged). */
/**
 * Phase 21H — durableDistributedRuntimeDiagnostics
 *
 * Passive in-process aggregator dedicated to the DURABLE distributed
 * runtime. Sits ALONGSIDE the Phase 20H `distributedExecutionDiagnostics`
 * — both can coexist. This one focuses on signals unique to the
 * Supabase-backed runtime:
 *
 *   - queue persistence latency
 *   - atomic claim latency
 *   - visibility reclaim frequency
 *   - distributed heartbeat drift
 *   - queue replay frequency
 *   - worker failover frequency
 *   - dead-letter trends
 *   - queue compaction pressure
 *   - cross-instance ownership transfer frequency
 *
 * Plus forensic timelines for:
 *   - distributed queue lifecycle
 *   - ownership transfer chain
 *   - worker failover chain
 *   - replay reclamation chain
 *
 * SCOPE: pure aggregation. No I/O. Memory bounded (SAMPLE_CAP=256,
 * TIMELINE_CAP=64). Snapshot consumed by /api endpoints + stress harnesses.
 */

// ────────────────────────────────────────────────────────────────────
// Sample-list helpers (shared shape with other diagnostics modules)
// ────────────────────────────────────────────────────────────────────


const SAMPLE_CAP = 256;
export const TIMELINE_CAP = 64;

interface SampleList {
  samples: number[];
  lastMs: number | null;
}
function newSampleList(): SampleList { return { samples: [], lastMs: null }; }
export function recordSample(list: SampleList, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  list.samples.push(ms);
  if (list.samples.length > SAMPLE_CAP) list.samples.shift();
  list.lastMs = ms;
}

export interface LatencyBucket {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}
export function summarize(list: SampleList): LatencyBucket {
  if (list.samples.length === 0) return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...list.samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: list.samples.length, lastMs: list.lastMs,
    p50Ms: p(0.5), p95Ms: p(0.95), maxMs: sorted[sorted.length - 1],
  };
}

// ────────────────────────────────────────────────────────────────────
// Snapshot
// ────────────────────────────────────────────────────────────────────

export interface DurableDistributedRuntimeSnapshot {
  snapshotAtIso: string;
  // ── Latency ──
  queuePersistenceLatency: LatencyBucket;
  atomicClaimLatency: LatencyBucket;
  // ── Frequencies ──
  visibilityReclaimEvents: number;
  queueReplaySweeps: number;
  workerFailoverEvents: number;
  deadLetterEvents: number;
  crossInstanceOwnershipTransfers: number;
  heartbeatDriftEvents: number;
  // ── Pressure ──
  queueCompactionEvents: number;
  queueArchivedTotal: number;
  workerArchivedTotal: number;
  checkpointArchivedTotal: number;
  // ── Phase 22E — activation + reclaim observability ──
  runtimeActivationsStarted: number;
  runtimeActivationsSucceeded: number;
  runtimeActivationsFailed: number;
  runtimeActivationLatency: LatencyBucket;
  activationValidationFailures: number;
  activationWatchdogTrips: number;
  targetedReclaimEvents: number;
  reclaimSuppressionEvents: number;
  reclaimValidationFailures: number;
  reclaimSplitBrainPreventions: number;
  staleWorkerReclaimSuccesses: number;
  reclaimLatency: LatencyBucket;
  // ── Phase 23G — workflow execution observability ──
  queuePayloadHydrationLatency: LatencyBucket;
  workflowBuildLatency: LatencyBucket;
  workflowExecutionLatency: LatencyBucket;
  payloadRejectionEvents: number;
  replaySuppressionEvents: number;
  checkpointResumeEvents: number;
  workflowReplayDivergenceEvents: number;
  // ── Phase 24G — domain execution observability ──
  longFormExecutionLatency: LatencyBucket;
  publishExecutionLatency: LatencyBucket;
  campaignExecutionLatency: LatencyBucket;
  reconciliationExecutionLatency: LatencyBucket;
  regenerationReplayFrequency: number;
  duplicatePublishSuppressionFrequency: number;
  campaignReplayDivergence: number;
  reconciliationReplaySuppression: number;
  // ── Phase 26H — production live-execution observability ──
  liveLongFormExecutionFrequency: number;
  liveProviderPublishFrequency: number;
  replaySafePublishSuppressions: number;
  campaignReplayRecoveries: number;
  reconciliationReplayRecoveries: number;
  crossRunForensicDivergenceFrequency: number;
  // ── Forensic timelines ──
  distributedQueueLifecycle: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    event: string;
    detail: string | null;
  }>;
  ownershipTransferChain: Array<{
    atIso: string;
    executionId: string;
    fromWorkerId: string | null;
    toWorkerId: string;
    reason: string;
  }>;
  workerFailoverChain: Array<{
    atIso: string;
    workerId: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string;
  }>;
  replayReclamationChain: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    reason: string;
  }>;
  // ── Phase 22E — new forensic chains ──
  runtimeActivationChain: Array<{
    atIso: string;
    event: 'started' | 'succeeded' | 'failed';
    durationMs: number | null;
    failedValidator: string | null;
    detail: string | null;
  }>;
  reclaimOwnershipChain: Array<{
    atIso: string;
    queueEntryId: string;
    workerId: string;
    outcome: 'reclaimed' | 'refused';
    reason: string;
  }>;
  startupValidationChain: Array<{
    atIso: string;
    validator: string;
    ok: boolean;
    detail: string;
  }>;
  // ── Phase 23G — workflow execution chains ──
  queuePayloadChain: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    outcome: 'hydrated' | 'rejected';
    code: string;
    detail: string | null;
  }>;
  workflowExecutionChain: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    workflowType: string;
    stepCount: number;
    durationMs: number | null;
    outcome: 'dispatched' | 'suppressed' | 'refused' | 'failed';
    detail: string | null;
  }>;
  checkpointResumeChain: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    chainLength: number;
    verdict: string;
  }>;
  // ── Phase 24G — domain forensic timelines ──
  longFormExecutionChain: Array<{
    atIso: string;
    executionId: string;
    generationId: string;
    event: 'started' | 'section_completed' | 'finalized' | 'suppressed';
    detail: string | null;
  }>;
  providerPublishChain: Array<{
    atIso: string;
    executionId: string;
    provider: string;
    contentFingerprint: string;
    event: 'started' | 'completed' | 'suppressed' | 'failed';
    detail: string | null;
  }>;
  campaignProgressionChain: Array<{
    atIso: string;
    executionId: string;
    campaignId: string;
    postId: string | null;
    event: 'started' | 'post_completed' | 'finalized' | 'diverged';
    detail: string | null;
  }>;
  reconciliationChain: Array<{
    atIso: string;
    executionId: string;
    rowId: string;
    provider: string;
    event: 'started' | 'reconciled' | 'suppressed' | 'failed';
    detail: string | null;
  }>;
  // ── Phase 26H — live production forensic timelines ──
  liveLongFormChain: Array<{
    atIso: string;
    executionId: string;
    generationId: string;
    op: string;
    outcome: 'started' | 'completed' | 'failed';
    detail: string | null;
  }>;
  livePublishChain: Array<{
    atIso: string;
    executionId: string;
    provider: string;
    contentFingerprint: string;
    op: string;
    outcome: 'started' | 'completed' | 'failed' | 'suppressed';
    detail: string | null;
  }>;
  campaignReplayChain: Array<{
    atIso: string;
    executionId: string;
    campaignId: string;
    op: string;
    outcome: 'started' | 'completed' | 'failed';
    detail: string | null;
  }>;
  reconciliationReplayChain: Array<{
    atIso: string;
    executionId: string;
    rowId: string;
    provider: string;
    op: string;
    outcome: 'started' | 'completed' | 'failed';
    detail: string | null;
  }>;
}

// ────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────

interface InternalState {
  queuePersistence: SampleList;
  atomicClaim: SampleList;
  visibilityReclaims: number;
  queueReplaySweeps: number;
  workerFailovers: number;
  deadLetters: number;
  crossInstanceTransfers: number;
  heartbeatDrifts: number;
  queueCompactions: number;
  queueArchivedTotal: number;
  workerArchivedTotal: number;
  checkpointArchivedTotal: number;
  // Phase 22E
  runtimeActivationsStarted: number;
  runtimeActivationsSucceeded: number;
  runtimeActivationsFailed: number;
  runtimeActivationLatency: SampleList;
  activationValidationFailures: number;
  activationWatchdogTrips: number;
  targetedReclaimEvents: number;
  reclaimSuppressionEvents: number;
  reclaimValidationFailures: number;
  reclaimSplitBrainPreventions: number;
  staleWorkerReclaimSuccesses: number;
  reclaimLatency: SampleList;
  // Phase 23G
  queuePayloadHydrationLatency: SampleList;
  workflowBuildLatency: SampleList;
  workflowExecutionLatency: SampleList;
  payloadRejectionEvents: number;
  replaySuppressionEvents: number;
  checkpointResumeEvents: number;
  workflowReplayDivergenceEvents: number;
  queuePayloadChain: DurableDistributedRuntimeSnapshot['queuePayloadChain'];
  workflowExecutionChain: DurableDistributedRuntimeSnapshot['workflowExecutionChain'];
  checkpointResumeChain: DurableDistributedRuntimeSnapshot['checkpointResumeChain'];
  hydrationStartTimes: Map<string, number>;
  workflowDispatchStartTimes: Map<string, number>;
  // Phase 24G
  longFormExecutionLatency: SampleList;
  publishExecutionLatency: SampleList;
  campaignExecutionLatency: SampleList;
  reconciliationExecutionLatency: SampleList;
  regenerationReplayFrequency: number;
  duplicatePublishSuppressionFrequency: number;
  campaignReplayDivergence: number;
  reconciliationReplaySuppression: number;
  // Phase 26H state
  liveLongFormExecutionFrequency: number;
  liveProviderPublishFrequency: number;
  replaySafePublishSuppressions: number;
  campaignReplayRecoveries: number;
  reconciliationReplayRecoveries: number;
  crossRunForensicDivergenceFrequency: number;
  liveLongFormChain: DurableDistributedRuntimeSnapshot['liveLongFormChain'];
  livePublishChain: DurableDistributedRuntimeSnapshot['livePublishChain'];
  campaignReplayChain: DurableDistributedRuntimeSnapshot['campaignReplayChain'];
  reconciliationReplayChain: DurableDistributedRuntimeSnapshot['reconciliationReplayChain'];
  longFormExecutionChain: DurableDistributedRuntimeSnapshot['longFormExecutionChain'];
  providerPublishChain: DurableDistributedRuntimeSnapshot['providerPublishChain'];
  campaignProgressionChain: DurableDistributedRuntimeSnapshot['campaignProgressionChain'];
  reconciliationChain: DurableDistributedRuntimeSnapshot['reconciliationChain'];
  longFormDispatchStartTimes: Map<string, number>;
  publishDispatchStartTimes: Map<string, number>;
  campaignDispatchStartTimes: Map<string, number>;
  reconciliationDispatchStartTimes: Map<string, number>;
  queueLifecycle: DurableDistributedRuntimeSnapshot['distributedQueueLifecycle'];
  ownershipChain: DurableDistributedRuntimeSnapshot['ownershipTransferChain'];
  failoverChain: DurableDistributedRuntimeSnapshot['workerFailoverChain'];
  replayChain: DurableDistributedRuntimeSnapshot['replayReclamationChain'];
  runtimeActivationChain: DurableDistributedRuntimeSnapshot['runtimeActivationChain'];
  reclaimOwnershipChain: DurableDistributedRuntimeSnapshot['reclaimOwnershipChain'];
  startupValidationChain: DurableDistributedRuntimeSnapshot['startupValidationChain'];
  enqueueStartTimes: Map<string, number>;
  claimStartTimes: Map<string, number>;
  activationStartedAtMs: number | null;
  reclaimStartTimes: Map<string, number>;
}

export function newState(): InternalState {
  return {
    queuePersistence: newSampleList(),
    atomicClaim: newSampleList(),
    visibilityReclaims: 0,
    queueReplaySweeps: 0,
    workerFailovers: 0,
    deadLetters: 0,
    crossInstanceTransfers: 0,
    heartbeatDrifts: 0,
    queueCompactions: 0,
    queueArchivedTotal: 0,
    workerArchivedTotal: 0,
    checkpointArchivedTotal: 0,
    runtimeActivationsStarted: 0,
    runtimeActivationsSucceeded: 0,
    runtimeActivationsFailed: 0,
    runtimeActivationLatency: newSampleList(),
    activationValidationFailures: 0,
    activationWatchdogTrips: 0,
    targetedReclaimEvents: 0,
    reclaimSuppressionEvents: 0,
    reclaimValidationFailures: 0,
    reclaimSplitBrainPreventions: 0,
    staleWorkerReclaimSuccesses: 0,
    reclaimLatency: newSampleList(),
    // Phase 23G
    queuePayloadHydrationLatency: newSampleList(),
    workflowBuildLatency: newSampleList(),
    workflowExecutionLatency: newSampleList(),
    payloadRejectionEvents: 0,
    replaySuppressionEvents: 0,
    checkpointResumeEvents: 0,
    workflowReplayDivergenceEvents: 0,
    queuePayloadChain: [],
    workflowExecutionChain: [],
    checkpointResumeChain: [],
    hydrationStartTimes: new Map(),
    workflowDispatchStartTimes: new Map(),
    // Phase 24G
    longFormExecutionLatency: newSampleList(),
    publishExecutionLatency: newSampleList(),
    campaignExecutionLatency: newSampleList(),
    reconciliationExecutionLatency: newSampleList(),
    regenerationReplayFrequency: 0,
    duplicatePublishSuppressionFrequency: 0,
    campaignReplayDivergence: 0,
    reconciliationReplaySuppression: 0,
    // Phase 26H initial state
    liveLongFormExecutionFrequency: 0,
    liveProviderPublishFrequency: 0,
    replaySafePublishSuppressions: 0,
    campaignReplayRecoveries: 0,
    reconciliationReplayRecoveries: 0,
    crossRunForensicDivergenceFrequency: 0,
    liveLongFormChain: [],
    livePublishChain: [],
    campaignReplayChain: [],
    reconciliationReplayChain: [],
    longFormExecutionChain: [],
    providerPublishChain: [],
    campaignProgressionChain: [],
    reconciliationChain: [],
    longFormDispatchStartTimes: new Map(),
    publishDispatchStartTimes: new Map(),
    campaignDispatchStartTimes: new Map(),
    reconciliationDispatchStartTimes: new Map(),
    queueLifecycle: [],
    ownershipChain: [],
    failoverChain: [],
    replayChain: [],
    runtimeActivationChain: [],
    reclaimOwnershipChain: [],
    startupValidationChain: [],
    enqueueStartTimes: new Map(),
    claimStartTimes: new Map(),
    activationStartedAtMs: null,
    reclaimStartTimes: new Map(),
  };
}

