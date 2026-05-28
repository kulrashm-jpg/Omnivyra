/**
 * Phase 1–10 — Thread runtime observability types.
 *
 * All types are wire/serialization-stable. In-memory shapes only; no DB
 * coupling. `DiagnosticTrend` is borrowed from longForm types so trend
 * semantics stay consistent across observability layers.
 */

import type { DiagnosticTrend } from '../longForm/longFormRecommendationTypes';

export type { DiagnosticTrend };

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — Runtime trace registry
// ────────────────────────────────────────────────────────────────────────────

export type ThreadNodeGenerationMode = 'manual' | 'ai' | 'mixed';

export type ThreadRuntimeTransitionType =
  | 'session_start'
  | 'node_create'
  | 'node_edit'
  | 'node_reorder'
  | 'persist_attempt'
  | 'persist_success'
  | 'persist_failure'
  | 'join_attempt'
  | 'join_success'
  | 'join_failure'
  | 'refresh_observed'
  | 'recovery_attempt'
  | 'recovery_success'
  | 'recovery_failure'
  | 'session_end';

export interface ThreadRuntimeTraceEvent {
  eventId: string;
  runtimeSessionId: string;
  threadId: string;
  parentNodeId: string | null;
  childNodeIds: string[];
  nodeGenerationMode: ThreadNodeGenerationMode;
  orchestrationSequence: number;
  transitionType: ThreadRuntimeTransitionType;
  timestamp: string;
  latencyMs?: number;
  detail?: string;
  payload?: Record<string, unknown>;
}

export interface ThreadRuntimeTrace {
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  startedAt: string;
  endedAt: string | null;
  events: ThreadRuntimeTraceEvent[];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — Topology snapshot
// ────────────────────────────────────────────────────────────────────────────

export type ThreadSnapshotPhase =
  | 'pre_generation'
  | 'post_generation'
  | 'post_edit'
  | 'post_reorder'
  | 'post_recovery';

export type ThreadNodeStatus = 'scheduled' | 'draft' | 'published' | 'unknown';

export interface ThreadNodeShape {
  nodeId: string;
  position: number;
  parentNodeId: string | null;
  status: ThreadNodeStatus;
  hasContent: boolean;
  generationMode: ThreadNodeGenerationMode;
}

export type JoinIntegrity = 'intact' | 'gaps' | 'broken';
export type OrderingIntegrity = 'monotonic' | 'gaps' | 'duplicates';

export interface ThreadTopologySnapshot {
  snapshotId: string;
  threadId: string;
  companyId: string;
  takenAt: string;
  phase: ThreadSnapshotPhase;
  nodes: ThreadNodeShape[];
  rootNodeId: string | null;
  orphanNodeIds: string[];
  joinIntegrity: JoinIntegrity;
  orderingIntegrity: OrderingIntegrity;
  topologyIntegrityScore: number; // 0..100
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — Shadow soak report
// ────────────────────────────────────────────────────────────────────────────

export type ShadowSoakFlowType =
  | 'manual_3'
  | 'ai_10_edit'
  | 'mixed'
  | 'reorder'
  | 'persistence'
  | 'refresh';

export interface ShadowSoakReport {
  flow: ShadowSoakFlowType;
  threadId: string;
  reportedAt: string;
  runtimeStabilityScore: number;       // 0..100
  topologyIntegrityScore: number;
  orphanRiskScore: number;              // 0..100 — higher = worse
  rowJoinIntegrityScore: number;
  persistenceConsistencyScore: number;
  orderingContinuityScore: number;
  recoveryStabilityScore: number;
  overallSoakHealthScore: number;
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — Failure summarization
// ────────────────────────────────────────────────────────────────────────────

export type RuntimeFailureType =
  | 'runtime_crash'
  | 'orphan_generation'
  | 'topology_corruption'
  | 'persistence_failure'
  | 'ordering_failure'
  | 'join_inconsistency'
  | 'reload_inconsistency'
  | 'ai_manual_divergence';

export type RuntimeFailureSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AffectedRuntimeZone =
  | 'orchestration'
  | 'persistence'
  | 'topology'
  | 'recovery'
  | 'transport';

export interface RuntimeFailureSummary {
  failureId: string;
  failureType: RuntimeFailureType;
  failureSeverity: RuntimeFailureSeverity;
  probableRootCause: string;
  affectedRuntimeZone: AffectedRuntimeZone;
  recoveryRecommendation: string;
  evidence: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 — Runtime diagnostics (live)
// ────────────────────────────────────────────────────────────────────────────

export interface ThreadRuntimeDiagnosticsResult {
  nodeCreationLatencyMsAvg: number;
  orchestrationLatencyMsAvg: number;
  persistenceLatencyMsAvg: number;
  reorderLatencyMsAvg: number;
  topologyMutationFrequencyPerMin: number;
  orphanSuppressionFrequencyPerMin: number;
  joinRepairFrequencyPerMin: number;
  runtimeHealthScore: number;       // 0..100
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 6 — Self-validating shadow runs
// ────────────────────────────────────────────────────────────────────────────

export interface ShadowRunValidationResult {
  threadId: string;
  expectedNodeCount: number;
  observedNodeCount: number;
  topologyShapeOk: boolean;
  orderingConsistencyOk: boolean;
  parentChildIntegrityOk: boolean;
  replayConsistencyOk: boolean;
  refreshPersistenceOk: boolean;
  silentCorruptionFlags: string[];
  partialPersistenceFlags: string[];
  hiddenOrphanFlags: string[];
  unstableJoinFlags: string[];
  validationPassed: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 7 — Recovery traceability
// ────────────────────────────────────────────────────────────────────────────

export interface RecoveryTrace {
  recoveryId: string;
  threadId: string;
  startedAt: string;
  completedAt: string | null;
  whatFailed: string;
  whatRecovered: string;
  recoveryDurationMs: number | null;
  recoveryStable: boolean;
  residualCorruptionRisk: number;   // 0..100 — higher = worse
  recoveryConfidenceScore: number;  // 0..100
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 8 — Operator summary view
// ────────────────────────────────────────────────────────────────────────────

export interface RuntimeOperatorSummary {
  threadId: string;
  topologyVerified: boolean;
  orphanRiskScore: number;
  persistenceIntegrityScore: number;
  runtimeInstabilityFlags: string[];
  recoveryQualityScore: number;
  unresolvedWarnings: string[];
  oneLine: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 10 — Observability aggregator
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Phase 15 — Durable execution orchestration
// ────────────────────────────────────────────────────────────────────────────

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'recovering'
  | 'failed'
  | 'completed'
  | 'abandoned';

export type OrchestrationPhase =
  | 'precheck'
  | 'generation'
  | 'persistence'
  | 'topology_settle'
  | 'recovery'
  | 'finalize';

export interface ExecutionRecord {
  executionId: string;
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  orchestrationPhase: OrchestrationPhase;
  executionStatus: ExecutionStatus;
  executionOwner: string | null;   // worker id; null while pending
  retryCount: number;
  recoveryState: 'idle' | 'attempting' | 'stabilizing' | 'reconciled' | 'failed';
  startedAt: string;
  heartbeatAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  /** Pointer to the latest checkpointId (if any). */
  replayCheckpointId: string | null;
}

export interface ExecutionCheckpoint {
  checkpointId: string;
  executionId: string;
  takenAt: string;
  /** The orchestration phase the executor was in when this checkpoint was taken. */
  phase: OrchestrationPhase;
  /** Identifiers for node operations that have completed (no need to retry). */
  completedNodeOperationIds: string[];
  /** Identifiers for node operations still pending. */
  pendingNodeOperationIds: string[];
  /** Topology mutations that have been issued but not yet observed in snapshots. */
  pendingTopologyMutationIds: string[];
  /** Recovery progress marker. Caller-defined; opaque to the manager. */
  recoveryProgress: Record<string, unknown> | null;
  /** Replay continuity state — captures enough to resume safely. */
  replayContinuity: Record<string, unknown> | null;
}

export interface ExecutionLease {
  leaseId: string;
  executionId: string;
  ownerWorkerId: string;
  acquiredAt: string;
  expiresAt: string;
  released: boolean;
}

/** Phase 6 — recovery determinism evaluation. */
export interface RecoveryDeterminismResult {
  /** 0..100; higher = recovery operations are deterministic and replay-safe. */
  recoveryDeterminismScore: number;
  duplicateMutationSuppressions: number;
  duplicateInsertionsSuppressed: number;
  duplicateBillingsSuppressed: number;
  partialTopologyReconciliations: number;
  divergentReplaysDetected: number;
  details: string[];
}

/** Phase 7 — idempotency tracking. */
export type IdempotencyClass =
  | 'node_insert'
  | 'topology_mutation'
  | 'scheduling'
  | 'billing'
  | 'recovery_action'
  | 'unknown';

export interface IdempotencyFingerprint {
  fingerprintKey: string;
  cls: IdempotencyClass;
  executionId: string | null;
  firstSeenAt: string;
  suppressedCount: number;
}

/** Phase 9 — execution forensic outputs. */
export interface ExecutionForensicReport {
  executionId: string;
  /** Best-effort timestamp window where the crash / interruption happened. */
  probableFailureBoundary: { startMs: number; endMs: number } | null;
  /** Per-checkpoint replay integrity assessment. */
  replayIntegrityAssessment: Array<{ checkpointId: string; integrityScore: number; reason: string }>;
  /** Recovery consistency — did the recovered run match the canonical successful run? */
  recoveryConsistencyAssessment: {
    score: number;             // 0..100
    matchedMutations: number;
    divergentMutations: number;
    notes: string[];
  };
  duplicateSuppressionEvents: number;
}

/** Phase 11 — durable execution diagnostics. */
export interface DurableExecutionDiagnostics {
  checkpointFrequencyPerExecutionAvg: number;
  recoveryDeterminismScoreAvg: number;
  staleWorkerFrequencyPerHour: number;
  replayContinuationSuccessRatePercent: number;
  leaseConflictFrequencyPerHour: number;
  idempotencySuppressionEventsTotal: number;
  executionRecoveryTrend: DiagnosticTrend;
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 14 — Distributed runtime governance
// ────────────────────────────────────────────────────────────────────────────

/** Wire representation of a persisted runtime event. Mirrors the
 *  thread_runtime_events SQL table 1:1. */
export interface PersistedRuntimeEvent {
  eventId: string;
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  orchestrationSequence: number;
  eventType: ThreadRuntimeTransitionType;
  severity: 'low' | 'medium' | 'high' | 'critical' | 'info';
  timestamp: string;
  payloadJson: Record<string, unknown> | null;
  sourceSurface: 'server_scheduler' | 'client_scheduler' | 'editor' | 'recovery' | 'cron' | 'unknown';
  /** Distributed correlation: groups events across instances/sessions that
   *  describe the same logical thread runtime. */
  correlationId: string | null;
  /** Schema version of the event payload. Bumped when the contract changes. */
  replayVersion: number;
}

/** Persistence-layer write outcome reported back to the writer. */
export interface PersistentTraceWriteResult {
  accepted: number;
  duplicate: number;
  rejected: number;
  /** Per-event status from the persistence backend. */
  results: Array<{ eventId: string; status: 'accepted' | 'duplicate' | 'rejected'; reason?: string }>;
}

/** Query shape consumed by /api/threadRuntime/introspect and friends. */
export interface PersistedRuntimeEventsQuery {
  companyId: string;
  threadId?: string;
  runtimeSessionId?: string;
  correlationId?: string;
  sinceISO?: string;
  untilISO?: string;
  eventTypes?: ThreadRuntimeTransitionType[];
  severityAtLeast?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  limit?: number;
}

/** Phase 6 forensic outputs. */
export interface RuntimeForensicReport {
  threadId: string;
  failureChain: Array<{ eventId: string; transitionType: ThreadRuntimeTransitionType; detail: string; timestamp: string }>;
  topologyCorruptionOriginEventId: string | null;
  topologyCorruptionWindow: { startMs: number; endMs: number } | null;
  lifecycleTransitionReplay: Array<{ fromState: string; toState: string; atSequence: number }>;
  instabilityPattern: 'none' | 'flapping' | 'cascading_failure' | 'silent_drift' | 'orphan_cluster' | 'replay_break';
  probableRootCause: string;
  comparisonToHealthyRunsScore: number; // 0..100; higher = closer to healthy
  replayBreakOrigin: { eventId: string; reason: string } | null;
}

/** Phase 7 analytics aggregator output. */
export interface RuntimeAnalytics {
  windowMs: number;
  sampleSize: number;
  replayIntegrityScore: number;          // 0..100
  orphanFrequencyPerHour: number;
  recoverySuccessRatePercent: number;
  topologyInstabilityScore: number;      // 0..100; higher = more unstable
  transportRetryRatePercent: number;
  lifecycleCorruptionRatePercent: number;
  averageNodeCreationLatencyMs: number;
  averagePersistLatencyMs: number;
  crossInstanceContinuityScore: number;  // 0..100
}

/** Phase 8 archival summary entry (compressed cold storage). */
export interface RuntimeArchiveEntry {
  archiveId: string;
  companyId: string;
  threadId: string;
  runtimeSessionId: string;
  archivedAt: string;
  /** Earliest and latest event timestamps covered. */
  windowStart: string;
  windowEnd: string;
  /** Compressed JSON.stringify of the event slice (gzip optional; default raw). */
  blob: string;
  /** Integrity hash of the blob. */
  integrityHash: string;
  eventCount: number;
}

/** Phase 8 replay checkpoint — a "you can resume from here" anchor. */
export interface RuntimeReplayCheckpoint {
  checkpointId: string;
  companyId: string;
  threadId: string;
  runtimeSessionId: string;
  takenAt: string;
  lastIncludedSequence: number;
  lastIncludedEventId: string;
  topologyDigest: string;        // small hash that downstream replay compares against
}

/** Phase 10 composite governance score. */
export interface RuntimeGovernanceScore {
  /** 0..100 — single operational health number. */
  score: number;
  band: 'healthy' | 'watch' | 'degraded' | 'critical';
  components: {
    replayIntegrity: number;
    topologyStability: number;
    lifecycleClosure: number;
    transportReliability: number;
    recoveryQuality: number;
    distributedContinuity: number;
  };
  /** Surfaces the worst-performing component for routing. */
  weakestComponent: keyof RuntimeGovernanceScore['components'];
  recommendations: string[];
}

export interface ThreadRuntimeObservability {
  topologyHealthTrend: DiagnosticTrend;
  orphanSuppressionTrend: DiagnosticTrend;
  recoverySuccessTrend: DiagnosticTrend;
  nodeMutationTrend: DiagnosticTrend;
  persistenceDriftTrend: DiagnosticTrend;
  orchestrationStabilityTrend: DiagnosticTrend;
  sampleSize: number;
  // ── Wiring phase additions (optional; present when wiring samples
  //    carry the relevant inputs) ─────────────────────────────────────
  instrumentationCoveragePercentAvg?: number;
  replayIntegrityTrend?: DiagnosticTrend;
  silentZoneFrequencyAvg?: number;        // mean warnings per sample
  lifecycleClosureTrend?: DiagnosticTrend;
  traceCompletenessTrend?: DiagnosticTrend;
  snapshotCoverageTrend?: DiagnosticTrend;
}
