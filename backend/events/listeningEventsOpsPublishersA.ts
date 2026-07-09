/** Part of listeningEventsOps (Agent-B split — the original path is a curated barrel). */
import type { IntegrationCapability } from '../types/integrationCapabilities';
import type {
  ListeningSourceStatus,
  ListeningSourceType,
} from '../types/listeningSource';

import { type ListeningEventType, type CapabilityChangedEvent, type ListeningSourceStatusChangedEvent, type ConsentRecordedEvent, type ConsentRevokedEvent, type LeadSignalCreatedEvent, type ExecutionPlannedEvent, type ExecutionStartedEvent, type ExecutionCompletedEvent, type ExecutionFailedEvent, type ExecutionBlockedEvent, type SignalsDetectedEvent, type ModerationBlockedEvent, type SourceRateLimitedEvent, type RecommendationLifecycleEvent, type OpportunityDetectedEvent, type ClusterCreatedEvent, type FeedUpdatedEvent, type ListeningEventPayload } from './listeningEventsCore';
import { publish, nowIso } from './listeningEventsBus';

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

