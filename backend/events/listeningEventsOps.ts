/** Listening event types + emitters — trends, compliance, ops — split from listeningEvents.ts (barrel preserved; importers unchanged). */
/**
 * Phase 0 — typed event contracts for the listening / capability surface.
 *
 * No transport is wired here. Subscribers are in-process for now; Phase 4
 * will bind these payloads to Supabase Realtime / WebSocket so the UI can
 * push-update. Publishing services should call the publish* helpers; if no
 * subscribers are registered the events are silently dropped (safe no-op).
 */

import type { IntegrationCapability } from '../types/integrationCapabilities';
import type {
  ListeningSourceStatus,
  ListeningSourceType,
} from '../types/listeningSource';

import { type ListeningEventType, type CapabilityChangedEvent, type ListeningSourceStatusChangedEvent, type ConsentRecordedEvent, type ConsentRevokedEvent, type LeadSignalCreatedEvent, type ExecutionPlannedEvent, type ExecutionStartedEvent, type ExecutionCompletedEvent, type ExecutionFailedEvent, type ExecutionBlockedEvent, type SignalsDetectedEvent, type ModerationBlockedEvent, type SourceRateLimitedEvent, type RecommendationLifecycleEvent, type OpportunityDetectedEvent, type ClusterCreatedEvent, type FeedUpdatedEvent, type ListeningEventPayload } from './listeningEventsCore';

export type TrendMaterializedEvent = {
  type: 'trend.materialized';
  organization_id: string;
  trend_kind: string;
  window_kind: string;
  window_start: string;
  window_end: string;
  series_points: number;
  occurred_at: string;
};

export type DisasterRecoveryExecutedEvent = {
  type: 'disaster_recovery.executed';
  organization_id: string;
  execution_id: string;
  plan_kind: string;
  status: string;
  approved_by: string | null;
  occurred_at: string;
};

export type ComplianceExportGeneratedEvent = {
  type: 'compliance.export_generated';
  organization_id: string;
  evidence_kind: string;
  certification_target: string;
  status: string;
  row_count: number;
  byte_size: number;
  occurred_at: string;
};

export type AnalystTemplateExecutedEvent = {
  type: 'analyst.template_executed';
  organization_id: string;
  macro_id: string;
  macro_kind: string;
  status: string;
  executed_by: string | null;
  occurred_at: string;
};

export type SafeguardTriggeredEvent = {
  type: 'safeguard.triggered';
  organization_id: string;
  safeguard_kind: string;
  observed_value: number;
  threshold_value: number;
  acted_by: string | null;
  occurred_at: string;
};

export type SafeguardRecoveredEvent = {
  type: 'safeguard.recovered';
  organization_id: string;
  safeguard_kind: string;
  acted_by: string | null;
  occurred_at: string;
};

type Subscriber = (event: ListeningEventPayload) => void | Promise<void>;

const subscribers = new Map<ListeningEventType, Set<Subscriber>>();

export function subscribeToListeningEvents<T extends ListeningEventType>(
  type: T,
  handler: Subscriber,
): () => void {
  const existing = subscribers.get(type) ?? new Set<Subscriber>();
  existing.add(handler);
  subscribers.set(type, existing);
  return () => existing.delete(handler);
}

async function publish(event: ListeningEventPayload): Promise<void> {
  const handlers = subscribers.get(event.type);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (err: any) {
      console.warn('[listeningEvents] subscriber threw:', {
        type: event.type,
        error: err?.message,
      });
    }
  }
}

export async function publishCapabilityChangedEvent(
  payload: Omit<CapabilityChangedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'capability.changed', ...payload });
}

export async function publishListeningSourceStatusChangedEvent(
  payload: Omit<ListeningSourceStatusChangedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'listening_source.status_changed', ...payload });
}

export async function publishConsentRecordedEvent(
  payload: Omit<ConsentRecordedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'consent.recorded', ...payload });
}

export async function publishConsentRevokedEvent(
  payload: Omit<ConsentRevokedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'consent.revoked', ...payload });
}

export async function publishLeadSignalCreatedEvent(
  payload: Omit<LeadSignalCreatedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'lead_signal.created', ...payload });
}

export async function publishExecutionPlannedEvent(payload: Omit<ExecutionPlannedEvent, 'type'>): Promise<void> {
  await publish({ type: 'execution.planned', ...payload });
}
export async function publishExecutionStartedEvent(payload: Omit<ExecutionStartedEvent, 'type'>): Promise<void> {
  await publish({ type: 'execution.started', ...payload });
}
export async function publishExecutionCompletedEvent(payload: Omit<ExecutionCompletedEvent, 'type'>): Promise<void> {
  await publish({ type: 'execution.completed', ...payload });
}
export async function publishExecutionFailedEvent(payload: Omit<ExecutionFailedEvent, 'type'>): Promise<void> {
  await publish({ type: 'execution.failed', ...payload });
}
export async function publishExecutionBlockedEvent(payload: Omit<ExecutionBlockedEvent, 'type'>): Promise<void> {
  await publish({ type: 'execution.blocked', ...payload });
}
export async function publishSignalsDetectedEvent(payload: Omit<SignalsDetectedEvent, 'type'>): Promise<void> {
  await publish({ type: 'signals.detected', ...payload });
}
export async function publishModerationBlockedEvent(payload: Omit<ModerationBlockedEvent, 'type'>): Promise<void> {
  await publish({ type: 'moderation.blocked', ...payload });
}
export async function publishSourceRateLimitedEvent(payload: Omit<SourceRateLimitedEvent, 'type'>): Promise<void> {
  await publish({ type: 'source.rate_limited', ...payload });
}

export async function publishRecommendationLifecycleEvent(payload: RecommendationLifecycleEvent): Promise<void> {
  await publish(payload);
}
export async function publishOpportunityDetectedEvent(payload: Omit<OpportunityDetectedEvent, 'type'>): Promise<void> {
  await publish({ type: 'opportunity.detected', ...payload });
}
export async function publishClusterCreatedEvent(payload: Omit<ClusterCreatedEvent, 'type'>): Promise<void> {
  await publish({ type: 'cluster.created', ...payload });
}
export async function publishFeedUpdatedEvent(payload: Omit<FeedUpdatedEvent, 'type'>): Promise<void> {
  await publish({ type: 'feed.updated', ...payload });
}

// --- Phase 9 publishers ------------------------------------------------------

function nowIso(): string { return new Date().toISOString(); }

export async function publishSemanticJobQueued(args: {
  organizationId: string;
  semanticIndexingJobId: string;
  partitions: number;
  totalSources: number;
}): Promise<void> {
  await publish({
    type: 'semantic.job_queued',
    organization_id: args.organizationId,
    semantic_indexing_job_id: args.semanticIndexingJobId,
    partitions: args.partitions,
    total_sources: args.totalSources,
    occurred_at: nowIso(),
  });
}

export async function publishSemanticJobCompleted(args: {
  organizationId: string;
  semanticIndexingJobId: string;
  chunksIndexed: number;
  chunksFailed: number;
  costUnits: number;
  finalStatus: 'complete' | 'failed' | 'cancelled';
}): Promise<void> {
  await publish({
    type: 'semantic.job_completed',
    organization_id: args.organizationId,
    semantic_indexing_job_id: args.semanticIndexingJobId,
    chunks_indexed: args.chunksIndexed,
    chunks_failed: args.chunksFailed,
    cost_units: args.costUnits,
    final_status: args.finalStatus,
    occurred_at: nowIso(),
  });
}

export async function publishReplayPartitionStarted(args: {
  organizationId: string;
  replayOperationId: string;
  partitionId: string;
  partitionIndex: number;
}): Promise<void> {
  await publish({
    type: 'replay.partition_started',
    organization_id: args.organizationId,
    replay_operation_id: args.replayOperationId,
    partition_id: args.partitionId,
    partition_index: args.partitionIndex,
    occurred_at: nowIso(),
  });
}

export async function publishReplayPartitionCompleted(args: {
  organizationId: string;
  replayOperationId: string;
  partitionId: string;
  partitionIndex: number;
  processedCount: number;
  skippedCount: number;
  finalStatus: 'complete' | 'failed' | 'cancelled';
}): Promise<void> {
  await publish({
    type: 'replay.partition_completed',
    organization_id: args.organizationId,
    replay_operation_id: args.replayOperationId,
    partition_id: args.partitionId,
    partition_index: args.partitionIndex,
    processed_count: args.processedCount,
    skipped_count: args.skippedCount,
    final_status: args.finalStatus,
    occurred_at: nowIso(),
  });
}

export async function publishAnalyticsMaterialized(args: {
  organizationId: string;
  factKind: string;
  windowStart: string;
  windowEnd: string;
  rowsWritten: number;
  status: 'complete' | 'partial' | 'failed';
}): Promise<void> {
  await publish({
    type: 'analytics.materialized',
    organization_id: args.organizationId,
    fact_kind: args.factKind,
    window_start: args.windowStart,
    window_end: args.windowEnd,
    rows_written: args.rowsWritten,
    status: args.status,
    occurred_at: nowIso(),
  });
}

export async function publishIncidentCreated(args: {
  organizationId: string;
  incidentId: string;
  severity: string;
  category: string;
  createdBy: string | null;
}): Promise<void> {
  await publish({
    type: 'incident.created',
    organization_id: args.organizationId,
    incident_id: args.incidentId,
    severity: args.severity,
    category: args.category,
    created_by: args.createdBy,
    occurred_at: nowIso(),
  });
}

export async function publishIncidentUpdated(args: {
  organizationId: string;
  incidentId: string;
  status: string;
  severity: string;
  actorUserId: string | null;
}): Promise<void> {
  await publish({
    type: 'incident.updated',
    organization_id: args.organizationId,
    incident_id: args.incidentId,
    status: args.status,
    severity: args.severity,
    actor_user_id: args.actorUserId,
    occurred_at: nowIso(),
  });
}

export async function publishReportGenerated(args: {
  organizationId: string;
  reportExecutionId: string;
  reportKind: string;
  rowCount: number | null;
  byteSize: number | null;
  status: 'complete' | 'failed' | 'cancelled';
}): Promise<void> {
  await publish({
    type: 'report.generated',
    organization_id: args.organizationId,
    report_execution_id: args.reportExecutionId,
    report_kind: args.reportKind,
    row_count: args.rowCount,
    byte_size: args.byteSize,
    status: args.status,
    occurred_at: nowIso(),
  });
}

export async function publishRuntimeCongested(args: {
  organizationId: string;
  queue: string;
  depth: number;
  threshold: number;
}): Promise<void> {
  await publish({
    type: 'runtime.congested',
    organization_id: args.organizationId,
    queue: args.queue,
    depth: args.depth,
    threshold: args.threshold,
    occurred_at: nowIso(),
  });
}

export async function publishRuntimeRecovered(args: {
  organizationId: string;
  queue: string;
  depth: number;
}): Promise<void> {
  await publish({
    type: 'runtime.recovered',
    organization_id: args.organizationId,
    queue: args.queue,
    depth: args.depth,
    occurred_at: nowIso(),
  });
}

// --- Phase 10 publishers ----------------------------------------------------

export async function publishConnectorMarketplaceRegistered(args: {
  organizationId: string;
  marketplaceConnectorId: string;
  connectorSlug: string;
  version: string;
  signatureHash: string;
}): Promise<void> {
  await publish({
    type: 'connector.marketplace_registered',
    organization_id: args.organizationId,
    marketplace_connector_id: args.marketplaceConnectorId,
    connector_slug: args.connectorSlug,
    version: args.version,
    signature_hash: args.signatureHash,
    occurred_at: nowIso(),
  });
}

export async function publishConnectorCertificationUpdated(args: {
  organizationId: string;
  marketplaceConnectorId: string;
  previousState: string | null;
  newState: string;
  actorUserId: string | null;
}): Promise<void> {
  await publish({
    type: 'connector.certification_updated',
    organization_id: args.organizationId,
    marketplace_connector_id: args.marketplaceConnectorId,
    previous_state: args.previousState,
    new_state: args.newState,
    actor_user_id: args.actorUserId,
    occurred_at: nowIso(),
  });
}

export async function publishOnboardingTemplateApplied(args: {
  organizationId: string;
  applicationId: string;
  templateKind: string;
  status: string;
  approvedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'onboarding.template_applied',
    organization_id: args.organizationId,
    application_id: args.applicationId,
    template_kind: args.templateKind,
    status: args.status,
    approved_by: args.approvedBy,
    occurred_at: nowIso(),
  });
}

export async function publishInvestigationSummaryGenerated(args: {
  organizationId: string;
  summaryId: string;
  investigationKind: string;
  subjectRef: string;
  generationMethod: string;
  contextTokensUsed: number | null;
}): Promise<void> {
  await publish({
    type: 'investigation.summary_generated',
    organization_id: args.organizationId,
    summary_id: args.summaryId,
    investigation_kind: args.investigationKind,
    subject_ref: args.subjectRef,
    generation_method: args.generationMethod,
    context_tokens_used: args.contextTokensUsed,
    occurred_at: nowIso(),
  });
}

export async function publishTrendMaterialized(args: {
  organizationId: string;
  trendKind: string;
  windowKind: string;
  windowStart: string;
  windowEnd: string;
  seriesPoints: number;
}): Promise<void> {
  await publish({
    type: 'trend.materialized',
    organization_id: args.organizationId,
    trend_kind: args.trendKind,
    window_kind: args.windowKind,
    window_start: args.windowStart,
    window_end: args.windowEnd,
    series_points: args.seriesPoints,
    occurred_at: nowIso(),
  });
}

export async function publishDisasterRecoveryExecuted(args: {
  organizationId: string;
  executionId: string;
  planKind: string;
  status: string;
  approvedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'disaster_recovery.executed',
    organization_id: args.organizationId,
    execution_id: args.executionId,
    plan_kind: args.planKind,
    status: args.status,
    approved_by: args.approvedBy,
    occurred_at: nowIso(),
  });
}

export async function publishComplianceExportGenerated(args: {
  organizationId: string;
  evidenceKind: string;
  certificationTarget: string;
  status: string;
  rowCount: number;
  byteSize: number;
}): Promise<void> {
  await publish({
    type: 'compliance.export_generated',
    organization_id: args.organizationId,
    evidence_kind: args.evidenceKind,
    certification_target: args.certificationTarget,
    status: args.status,
    row_count: args.rowCount,
    byte_size: args.byteSize,
    occurred_at: nowIso(),
  });
}

export async function publishAnalystTemplateExecuted(args: {
  organizationId: string;
  macroId: string;
  macroKind: string;
  status: string;
  executedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'analyst.template_executed',
    organization_id: args.organizationId,
    macro_id: args.macroId,
    macro_kind: args.macroKind,
    status: args.status,
    executed_by: args.executedBy,
    occurred_at: nowIso(),
  });
}

export async function publishSafeguardTriggered(args: {
  organizationId: string;
  safeguardKind: string;
  observedValue: number;
  thresholdValue: number;
  actedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'safeguard.triggered',
    organization_id: args.organizationId,
    safeguard_kind: args.safeguardKind,
    observed_value: args.observedValue,
    threshold_value: args.thresholdValue,
    acted_by: args.actedBy,
    occurred_at: nowIso(),
  });
}

export async function publishSafeguardRecovered(args: {
  organizationId: string;
  safeguardKind: string;
  actedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'safeguard.recovered',
    organization_id: args.organizationId,
    safeguard_kind: args.safeguardKind,
    acted_by: args.actedBy,
    occurred_at: nowIso(),
  });
}

// --- Phase 11 publishers ----------------------------------------------------

export async function publishRolloutPlanCreated(args: {
  organizationId: string;
  planId: string;
  planName: string;
  rolloutKind: string;
  stageCount: number;
}): Promise<void> {
  await publish({
    type: 'rollout.plan_created',
    organization_id: args.organizationId,
    plan_id: args.planId,
    plan_name: args.planName,
    rollout_kind: args.rolloutKind,
    stage_count: args.stageCount,
    occurred_at: nowIso(),
  });
}

export async function publishRolloutStageCompleted(args: {
  organizationId: string;
  planId: string;
  stageIndex: number;
  stageKind: string;
  status: string;
}): Promise<void> {
  await publish({
    type: 'rollout.stage_completed',
    organization_id: args.organizationId,
    plan_id: args.planId,
    stage_index: args.stageIndex,
    stage_kind: args.stageKind,
    status: args.status,
    occurred_at: nowIso(),
  });
}

export async function publishSafeguardThresholdTriggered(args: {
  organizationId: string;
  railKind: string;
  observedValue: number;
  thresholdValue: number;
  ackedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'safeguard.threshold_triggered',
    organization_id: args.organizationId,
    rail_kind: args.railKind,
    observed_value: args.observedValue,
    threshold_value: args.thresholdValue,
    acked_by: args.ackedBy,
    occurred_at: nowIso(),
  });
}

export async function publishSafeguardOverrideApplied(args: {
  organizationId: string;
  railKind: string;
  actorUserId: string | null;
  rationale: string;
}): Promise<void> {
  await publish({
    type: 'safeguard.override_applied',
    organization_id: args.organizationId,
    rail_kind: args.railKind,
    actor_user_id: args.actorUserId,
    rationale: args.rationale,
    occurred_at: nowIso(),
  });
}

export async function publishCopilotResponseGenerated(args: {
  organizationId: string;
  responseId: string;
  copilotIntent: string;
  subjectRef: string;
  contextTokensUsed: number;
  generationMethod: string;
}): Promise<void> {
  await publish({
    type: 'copilot.response_generated',
    organization_id: args.organizationId,
    response_id: args.responseId,
    copilot_intent: args.copilotIntent,
    subject_ref: args.subjectRef,
    context_tokens_used: args.contextTokensUsed,
    generation_method: args.generationMethod,
    occurred_at: nowIso(),
  });
}

export async function publishDeploymentHealthChanged(args: {
  organizationId: string;
  snapshotId: string;
  snapshotKind: string;
  previousState: string | null;
  newState: string;
}): Promise<void> {
  await publish({
    type: 'deployment.health_changed',
    organization_id: args.organizationId,
    snapshot_id: args.snapshotId,
    snapshot_kind: args.snapshotKind,
    previous_state: args.previousState,
    new_state: args.newState,
    occurred_at: nowIso(),
  });
}

export async function publishOnboardingStageCompleted(args: {
  organizationId: string;
  stageKind: string;
  status: string;
  readinessScore: number;
  acknowledgedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'onboarding.stage_completed',
    organization_id: args.organizationId,
    stage_kind: args.stageKind,
    status: args.status,
    readiness_score: args.readinessScore,
    acknowledged_by: args.acknowledgedBy,
    occurred_at: nowIso(),
  });
}

export async function publishMigrationPreviewGenerated(args: {
  organizationId: string;
  migrationIdentifier: string;
  migrationKind: string;
  status: string;
  dependencyChecks: number;
}): Promise<void> {
  await publish({
    type: 'migration.preview_generated',
    organization_id: args.organizationId,
    migration_identifier: args.migrationIdentifier,
    migration_kind: args.migrationKind,
    status: args.status,
    dependency_checks: args.dependencyChecks,
    occurred_at: nowIso(),
  });
}

export async function publishResilienceValidationCompleted(args: {
  organizationId: string;
  validationKind: string;
  status: string;
  failures: number;
}): Promise<void> {
  await publish({
    type: 'resilience.validation_completed',
    organization_id: args.organizationId,
    validation_kind: args.validationKind,
    status: args.status,
    failures: args.failures,
    occurred_at: nowIso(),
  });
}

export async function publishCertificationGenerated(args: {
  organizationId: string;
  certificationKind: string;
  certificationScore: number;
  status: string;
}): Promise<void> {
  await publish({
    type: 'certification.generated',
    organization_id: args.organizationId,
    certification_kind: args.certificationKind,
    certification_score: args.certificationScore,
    status: args.status,
    occurred_at: nowIso(),
  });
}

// --- Phase 12 publishers ----------------------------------------------------

export async function publishStabilizationWindowActivated(args: {
  organizationId: string;
  windowId: string;
  freezeMode: string;
  freezeScope: string;
  actorUserId: string | null;
}): Promise<void> {
  await publish({
    type: 'stabilization.window_activated',
    organization_id: args.organizationId,
    window_id: args.windowId,
    freeze_mode: args.freezeMode,
    freeze_scope: args.freezeScope,
    actor_user_id: args.actorUserId,
    occurred_at: nowIso(),
  });
}

export async function publishStabilizationWindowClosed(args: {
  organizationId: string;
  windowId: string;
  closedBy: string | null;
}): Promise<void> {
  await publish({
    type: 'stabilization.window_closed',
    organization_id: args.organizationId,
    window_id: args.windowId,
    closed_by: args.closedBy,
    occurred_at: nowIso(),
  });
}

export async function publishSreDegradationDetected(args: {
  organizationId: string;
  snapshotId: string;
  snapshotKind: string;
  healthState: string;
}): Promise<void> {
  await publish({
    type: 'sre.degradation_detected',
    organization_id: args.organizationId,
    snapshot_id: args.snapshotId,
    snapshot_kind: args.snapshotKind,
    health_state: args.healthState,
    occurred_at: nowIso(),
  });
}

export async function publishSupportSnapshotGenerated(args: {
  organizationId: string;
  snapshotId: string;
  snapshotKind: string;
  rowCount: number;
  byteSize: number;
}): Promise<void> {
  await publish({
    type: 'support.snapshot_generated',
    organization_id: args.organizationId,
    snapshot_id: args.snapshotId,
    snapshot_kind: args.snapshotKind,
    row_count: args.rowCount,
    byte_size: args.byteSize,
    occurred_at: nowIso(),
  });
}

export async function publishGovernanceDriftDetected(args: {
  organizationId: string;
  scopeKind: string;
  driftScore: number;
  convergenceScore: number;
}): Promise<void> {
  await publish({
    type: 'governance.drift_detected',
    organization_id: args.organizationId,
    scope_kind: args.scopeKind,
    drift_score: args.driftScore,
    convergence_score: args.convergenceScore,
    occurred_at: nowIso(),
  });
}

export async function publishResiliencePlanGenerated(args: {
  organizationId: string;
  planId: string;
  planKind: string;
  recommendedSteps: number;
}): Promise<void> {
  await publish({
    type: 'resilience.plan_generated',
    organization_id: args.organizationId,
    plan_id: args.planId,
    plan_kind: args.planKind,
    recommended_steps: args.recommendedSteps,
    occurred_at: nowIso(),
  });
}

export async function publishCustomerOpsScoreUpdated(args: {
  organizationId: string;
  scoreKind: string;
  scoreValue: number;
}): Promise<void> {
  await publish({
    type: 'customer_ops.score_updated',
    organization_id: args.organizationId,
    score_kind: args.scoreKind,
    score_value: args.scoreValue,
    occurred_at: nowIso(),
  });
}

export async function publishObservabilityConvergenceUpdated(args: {
  organizationId: string;
  projectionId: string;
  projectionKind: string;
  unifiedHealthState: string;
  driftDetected: boolean;
}): Promise<void> {
  await publish({
    type: 'observability.convergence_updated',
    organization_id: args.organizationId,
    projection_id: args.projectionId,
    projection_kind: args.projectionKind,
    unified_health_state: args.unifiedHealthState,
    drift_detected: args.driftDetected,
    occurred_at: nowIso(),
  });
}

export async function publishRuntimeFreezeApplied(args: {
  organizationId: string;
  windowId: string;
  freezeScope: string;
  actorUserId: string | null;
}): Promise<void> {
  await publish({
    type: 'runtime.freeze_applied',
    organization_id: args.organizationId,
    window_id: args.windowId,
    freeze_scope: args.freezeScope,
    actor_user_id: args.actorUserId,
    occurred_at: nowIso(),
  });
}

export async function publishRuntimeFreezeReleased(args: {
  organizationId: string;
  windowId: string;
  freezeScope: string;
  actorUserId: string | null;
}): Promise<void> {
  await publish({
    type: 'runtime.freeze_released',
    organization_id: args.organizationId,
    window_id: args.windowId,
    freeze_scope: args.freezeScope,
    actor_user_id: args.actorUserId,
    occurred_at: nowIso(),
  });
}

