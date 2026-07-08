/** Listening event types — capabilities, consent, signals, execution — split from listeningEvents.ts (barrel preserved; importers unchanged). */
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

import { type TrendMaterializedEvent, type DisasterRecoveryExecutedEvent, type ComplianceExportGeneratedEvent, type AnalystTemplateExecutedEvent, type SafeguardTriggeredEvent, type SafeguardRecoveredEvent } from './listeningEventsOps';

export const LISTENING_EVENT_TYPES = [
  'capability.changed',
  'listening_source.status_changed',
  'consent.recorded',
  'consent.revoked',
  'lead_signal.created',
  'execution.planned',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.blocked',
  'signals.detected',
  'moderation.blocked',
  'source.rate_limited',
  'recommendation.generated',
  'recommendation.approved',
  'recommendation.rejected',
  'recommendation.dismissed',
  'recommendation.activated',
  'opportunity.detected',
  'cluster.created',
  'feed.updated',
  'governance.policy_activated',
  'governance.policy_updated',
  'retention.preview_generated',
  'retention.execution_completed',
  'replay.requested',
  'replay.executed',
  'export.generated',
  'investigation.created',
  'investigation.updated',
  'semantic.indexed',
  'semantic.indexing_started',
  'semantic.indexing_completed',
  'semantic.embedding_failed',
  'execution.partition_assigned',
  'execution.partition_recovered',
  'sla.degraded',
  'sla.breach_detected',
  'cost.threshold_reached',
  'rollout.activated',
  'rollout.reverted',
  // Phase 9 — async runtime, replay coordination, analytics, incidents, reports
  'semantic.job_queued',
  'semantic.job_completed',
  'replay.partition_started',
  'replay.partition_completed',
  'analytics.materialized',
  'incident.created',
  'incident.updated',
  'report.generated',
  'runtime.congested',
  'runtime.recovered',
  // Phase 10 — marketplace, onboarding, AI investigation, trends, DR, compliance, macros, safeguards
  'connector.marketplace_registered',
  'connector.certification_updated',
  'onboarding.template_applied',
  'investigation.summary_generated',
  'trend.materialized',
  'disaster_recovery.executed',
  'compliance.export_generated',
  'analyst.template_executed',
  'safeguard.triggered',
  'safeguard.recovered',
  // Phase 11 — production rollout, safety rails, copilot, deployment health, onboarding runtime, migration, resilience, certification
  'rollout.plan_created',
  'rollout.stage_completed',
  'safeguard.threshold_triggered',
  'safeguard.override_applied',
  'copilot.response_generated',
  'deployment.health_changed',
  'onboarding.stage_completed',
  'migration.preview_generated',
  'resilience.validation_completed',
  'certification.generated',
  // Phase 12 — GA launch hardening
  'stabilization.window_activated',
  'stabilization.window_closed',
  'sre.degradation_detected',
  'support.snapshot_generated',
  'governance.drift_detected',
  'resilience.plan_generated',
  'customer_ops.score_updated',
  'observability.convergence_updated',
  'runtime.freeze_applied',
  'runtime.freeze_released',
] as const;
export type ListeningEventType = (typeof LISTENING_EVENT_TYPES)[number];

export type CapabilityChangedEvent = {
  type: 'capability.changed';
  organization_id: string;
  platform: string;
  capability: IntegrationCapability;
  previous_state: 'enabled' | 'disabled';
  new_state: 'enabled' | 'disabled';
  actor_user_id: string | null;
  occurred_at: string;
};

export type ListeningSourceStatusChangedEvent = {
  type: 'listening_source.status_changed';
  organization_id: string;
  listening_source_id: string;
  source_type: ListeningSourceType;
  previous_status: ListeningSourceStatus;
  new_status: ListeningSourceStatus;
  actor_user_id: string | null;
  occurred_at: string;
};

export type ConsentRecordedEvent = {
  type: 'consent.recorded';
  organization_id: string;
  consent_record_id: string;
  platform: string;
  capability: IntegrationCapability;
  granted_by: string | null;
  occurred_at: string;
};

export type ConsentRevokedEvent = {
  type: 'consent.revoked';
  organization_id: string;
  consent_record_id: string;
  platform: string;
  capability: IntegrationCapability;
  revoked_by: string | null;
  occurred_at: string;
};

export type LeadSignalCreatedEvent = {
  type: 'lead_signal.created';
  organization_id: string;
  lead_signal_id: string;
  platform: string;
  source_type: 'engagement' | 'listening';
  occurred_at: string;
};

export type ExecutionPlannedEvent = {
  type: 'execution.planned';
  organization_id: string;
  listening_execution_id: string;
  listening_source_id: string;
  execution_mode: 'ON_DEMAND' | 'SCHEDULED';
  estimated_credit_cost: number;
  actor_user_id: string | null;
  occurred_at: string;
};

export type ExecutionStartedEvent = {
  type: 'execution.started';
  organization_id: string;
  listening_execution_id: string;
  listening_source_id: string;
  occurred_at: string;
};

export type ExecutionCompletedEvent = {
  type: 'execution.completed';
  organization_id: string;
  listening_execution_id: string;
  listening_source_id: string;
  signals_persisted: number;
  signals_detected: number;
  actual_credit_cost: number;
  partial: boolean;
  occurred_at: string;
};

export type ExecutionFailedEvent = {
  type: 'execution.failed';
  organization_id: string;
  listening_execution_id: string;
  listening_source_id: string;
  reason: string;
  occurred_at: string;
};

export type ExecutionBlockedEvent = {
  type: 'execution.blocked';
  organization_id: string;
  listening_source_id: string;
  reason:
    | 'consent_blocked'
    | 'scope_blocked'
    | 'budget_blocked'
    | 'capability_disabled'
    | 'source_not_ready'
    | 'overlap_prevented'
    | 'rate_limited';
  detail: string;
  occurred_at: string;
};

export type SignalsDetectedEvent = {
  type: 'signals.detected';
  organization_id: string;
  listening_execution_id: string;
  platform: string;
  count: number;
  occurred_at: string;
};

export type ModerationBlockedEvent = {
  type: 'moderation.blocked';
  organization_id: string;
  listening_execution_id: string;
  platform: string;
  content_hash: string;
  reasons: string[];
  occurred_at: string;
};

export type SourceRateLimitedEvent = {
  type: 'source.rate_limited';
  organization_id: string;
  listening_source_id: string;
  platform: string;
  reset_at: string | null;
  occurred_at: string;
};

export type RecommendationLifecycleEvent = {
  type:
    | 'recommendation.generated'
    | 'recommendation.approved'
    | 'recommendation.rejected'
    | 'recommendation.dismissed'
    | 'recommendation.activated';
  organization_id: string;
  recommendation_id: string;
  source_type: string;
  source_identifier: string;
  actor_user_id: string | null;
  occurred_at: string;
};

export type OpportunityDetectedEvent = {
  type: 'opportunity.detected';
  organization_id: string;
  opportunity_feed_item_id: string;
  signal_id: string;
  opportunity_type: string;
  opportunity_score: number;
  cluster_id: string | null;
  occurred_at: string;
};

export type ClusterCreatedEvent = {
  type: 'cluster.created';
  organization_id: string;
  cluster_id: string;
  cluster_key: string;
  opportunity_type: string;
  occurred_at: string;
};

export type FeedUpdatedEvent = {
  type: 'feed.updated';
  organization_id: string;
  items_added: number;
  occurred_at: string;
};

// --- Phase 9 payloads --------------------------------------------------------

export type SemanticJobQueuedEvent = {
  type: 'semantic.job_queued';
  organization_id: string;
  semantic_indexing_job_id: string;
  partitions: number;
  total_sources: number;
  occurred_at: string;
};

export type SemanticJobCompletedEvent = {
  type: 'semantic.job_completed';
  organization_id: string;
  semantic_indexing_job_id: string;
  chunks_indexed: number;
  chunks_failed: number;
  cost_units: number;
  final_status: 'complete' | 'failed' | 'cancelled';
  occurred_at: string;
};

export type ReplayPartitionStartedEvent = {
  type: 'replay.partition_started';
  organization_id: string;
  replay_operation_id: string;
  partition_id: string;
  partition_index: number;
  occurred_at: string;
};

export type ReplayPartitionCompletedEvent = {
  type: 'replay.partition_completed';
  organization_id: string;
  replay_operation_id: string;
  partition_id: string;
  partition_index: number;
  processed_count: number;
  skipped_count: number;
  final_status: 'complete' | 'failed' | 'cancelled';
  occurred_at: string;
};

export type AnalyticsMaterializedEvent = {
  type: 'analytics.materialized';
  organization_id: string;
  fact_kind: string;
  window_start: string;
  window_end: string;
  rows_written: number;
  status: 'complete' | 'partial' | 'failed';
  occurred_at: string;
};

export type IncidentCreatedEvent = {
  type: 'incident.created';
  organization_id: string;
  incident_id: string;
  severity: string;
  category: string;
  created_by: string | null;
  occurred_at: string;
};

export type IncidentUpdatedEvent = {
  type: 'incident.updated';
  organization_id: string;
  incident_id: string;
  status: string;
  severity: string;
  actor_user_id: string | null;
  occurred_at: string;
};

export type ReportGeneratedEvent = {
  type: 'report.generated';
  organization_id: string;
  report_execution_id: string;
  report_kind: string;
  row_count: number | null;
  byte_size: number | null;
  status: 'complete' | 'failed' | 'cancelled';
  occurred_at: string;
};

export type RuntimeCongestedEvent = {
  type: 'runtime.congested';
  organization_id: string;
  queue: string;
  depth: number;
  threshold: number;
  occurred_at: string;
};

export type RuntimeRecoveredEvent = {
  type: 'runtime.recovered';
  organization_id: string;
  queue: string;
  depth: number;
  occurred_at: string;
};

export type ListeningEventPayload =
  | CapabilityChangedEvent
  | ListeningSourceStatusChangedEvent
  | ConsentRecordedEvent
  | ConsentRevokedEvent
  | LeadSignalCreatedEvent
  | ExecutionPlannedEvent
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | ExecutionBlockedEvent
  | SignalsDetectedEvent
  | ModerationBlockedEvent
  | SourceRateLimitedEvent
  | RecommendationLifecycleEvent
  | OpportunityDetectedEvent
  | ClusterCreatedEvent
  | FeedUpdatedEvent
  | SemanticJobQueuedEvent
  | SemanticJobCompletedEvent
  | ReplayPartitionStartedEvent
  | ReplayPartitionCompletedEvent
  | AnalyticsMaterializedEvent
  | IncidentCreatedEvent
  | IncidentUpdatedEvent
  | ReportGeneratedEvent
  | RuntimeCongestedEvent
  | RuntimeRecoveredEvent
  | ConnectorMarketplaceRegisteredEvent
  | ConnectorCertificationUpdatedEvent
  | OnboardingTemplateAppliedEvent
  | InvestigationSummaryGeneratedEvent
  | TrendMaterializedEvent
  | DisasterRecoveryExecutedEvent
  | ComplianceExportGeneratedEvent
  | AnalystTemplateExecutedEvent
  | SafeguardTriggeredEvent
  | SafeguardRecoveredEvent
  | RolloutPlanCreatedEvent
  | RolloutStageCompletedEvent
  | SafeguardThresholdTriggeredEvent
  | SafeguardOverrideAppliedEvent
  | CopilotResponseGeneratedEvent
  | DeploymentHealthChangedEvent
  | OnboardingStageCompletedEvent
  | MigrationPreviewGeneratedEvent
  | ResilienceValidationCompletedEvent
  | CertificationGeneratedEvent
  | StabilizationWindowActivatedEvent
  | StabilizationWindowClosedEvent
  | SreDegradationDetectedEvent
  | SupportSnapshotGeneratedEvent
  | GovernanceDriftDetectedEvent
  | ResiliencePlanGeneratedEvent
  | CustomerOpsScoreUpdatedEvent
  | ObservabilityConvergenceUpdatedEvent
  | RuntimeFreezeAppliedEvent
  | RuntimeFreezeReleasedEvent;

// --- Phase 12 payloads ------------------------------------------------------

export type StabilizationWindowActivatedEvent = {
  type: 'stabilization.window_activated';
  organization_id: string;
  window_id: string;
  freeze_mode: string;
  freeze_scope: string;
  actor_user_id: string | null;
  occurred_at: string;
};

export type StabilizationWindowClosedEvent = {
  type: 'stabilization.window_closed';
  organization_id: string;
  window_id: string;
  closed_by: string | null;
  occurred_at: string;
};

export type SreDegradationDetectedEvent = {
  type: 'sre.degradation_detected';
  organization_id: string;
  snapshot_id: string;
  snapshot_kind: string;
  health_state: string;
  occurred_at: string;
};

export type SupportSnapshotGeneratedEvent = {
  type: 'support.snapshot_generated';
  organization_id: string;
  snapshot_id: string;
  snapshot_kind: string;
  row_count: number;
  byte_size: number;
  occurred_at: string;
};

export type GovernanceDriftDetectedEvent = {
  type: 'governance.drift_detected';
  organization_id: string;
  scope_kind: string;
  drift_score: number;
  convergence_score: number;
  occurred_at: string;
};

export type ResiliencePlanGeneratedEvent = {
  type: 'resilience.plan_generated';
  organization_id: string;
  plan_id: string;
  plan_kind: string;
  recommended_steps: number;
  occurred_at: string;
};

export type CustomerOpsScoreUpdatedEvent = {
  type: 'customer_ops.score_updated';
  organization_id: string;
  score_kind: string;
  score_value: number;
  occurred_at: string;
};

export type ObservabilityConvergenceUpdatedEvent = {
  type: 'observability.convergence_updated';
  organization_id: string;
  projection_id: string;
  projection_kind: string;
  unified_health_state: string;
  drift_detected: boolean;
  occurred_at: string;
};

export type RuntimeFreezeAppliedEvent = {
  type: 'runtime.freeze_applied';
  organization_id: string;
  window_id: string;
  freeze_scope: string;
  actor_user_id: string | null;
  occurred_at: string;
};

export type RuntimeFreezeReleasedEvent = {
  type: 'runtime.freeze_released';
  organization_id: string;
  window_id: string;
  freeze_scope: string;
  actor_user_id: string | null;
  occurred_at: string;
};

// --- Phase 11 payloads ------------------------------------------------------

export type RolloutPlanCreatedEvent = {
  type: 'rollout.plan_created';
  organization_id: string;
  plan_id: string;
  plan_name: string;
  rollout_kind: string;
  stage_count: number;
  occurred_at: string;
};

export type RolloutStageCompletedEvent = {
  type: 'rollout.stage_completed';
  organization_id: string;
  plan_id: string;
  stage_index: number;
  stage_kind: string;
  status: string;
  occurred_at: string;
};

export type SafeguardThresholdTriggeredEvent = {
  type: 'safeguard.threshold_triggered';
  organization_id: string;
  rail_kind: string;
  observed_value: number;
  threshold_value: number;
  acked_by: string | null;
  occurred_at: string;
};

export type SafeguardOverrideAppliedEvent = {
  type: 'safeguard.override_applied';
  organization_id: string;
  rail_kind: string;
  actor_user_id: string | null;
  rationale: string;
  occurred_at: string;
};

export type CopilotResponseGeneratedEvent = {
  type: 'copilot.response_generated';
  organization_id: string;
  response_id: string;
  copilot_intent: string;
  subject_ref: string;
  context_tokens_used: number;
  generation_method: string;
  occurred_at: string;
};

export type DeploymentHealthChangedEvent = {
  type: 'deployment.health_changed';
  organization_id: string;
  snapshot_id: string;
  snapshot_kind: string;
  previous_state: string | null;
  new_state: string;
  occurred_at: string;
};

export type OnboardingStageCompletedEvent = {
  type: 'onboarding.stage_completed';
  organization_id: string;
  stage_kind: string;
  status: string;
  readiness_score: number;
  acknowledged_by: string | null;
  occurred_at: string;
};

export type MigrationPreviewGeneratedEvent = {
  type: 'migration.preview_generated';
  organization_id: string;
  migration_identifier: string;
  migration_kind: string;
  status: string;
  dependency_checks: number;
  occurred_at: string;
};

export type ResilienceValidationCompletedEvent = {
  type: 'resilience.validation_completed';
  organization_id: string;
  validation_kind: string;
  status: string;
  failures: number;
  occurred_at: string;
};

export type CertificationGeneratedEvent = {
  type: 'certification.generated';
  organization_id: string;
  certification_kind: string;
  certification_score: number;
  status: string;
  occurred_at: string;
};

export type ConnectorMarketplaceRegisteredEvent = {
  type: 'connector.marketplace_registered';
  organization_id: string;
  marketplace_connector_id: string;
  connector_slug: string;
  version: string;
  signature_hash: string;
  occurred_at: string;
};

export type ConnectorCertificationUpdatedEvent = {
  type: 'connector.certification_updated';
  organization_id: string;
  marketplace_connector_id: string;
  previous_state: string | null;
  new_state: string;
  actor_user_id: string | null;
  occurred_at: string;
};

export type OnboardingTemplateAppliedEvent = {
  type: 'onboarding.template_applied';
  organization_id: string;
  application_id: string;
  template_kind: string;
  status: string;
  approved_by: string | null;
  occurred_at: string;
};

export type InvestigationSummaryGeneratedEvent = {
  type: 'investigation.summary_generated';
  organization_id: string;
  summary_id: string;
  investigation_kind: string;
  subject_ref: string;
  generation_method: string;
  context_tokens_used: number | null;
  occurred_at: string;
};

