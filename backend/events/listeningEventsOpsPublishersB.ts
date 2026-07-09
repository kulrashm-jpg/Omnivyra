/** Part of listeningEventsOps (Agent-B split — the original path is a curated barrel). */
import type { IntegrationCapability } from '../types/integrationCapabilities';
import type {
  ListeningSourceStatus,
  ListeningSourceType,
} from '../types/listeningSource';

import { type ListeningEventType, type CapabilityChangedEvent, type ListeningSourceStatusChangedEvent, type ConsentRecordedEvent, type ConsentRevokedEvent, type LeadSignalCreatedEvent, type ExecutionPlannedEvent, type ExecutionStartedEvent, type ExecutionCompletedEvent, type ExecutionFailedEvent, type ExecutionBlockedEvent, type SignalsDetectedEvent, type ModerationBlockedEvent, type SourceRateLimitedEvent, type RecommendationLifecycleEvent, type OpportunityDetectedEvent, type ClusterCreatedEvent, type FeedUpdatedEvent, type ListeningEventPayload } from './listeningEventsCore';
import { publish, nowIso } from './listeningEventsBus';

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

