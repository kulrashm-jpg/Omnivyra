/**
 * orchestrationStateProjector — THE only canonical state derivation engine.
 * Phase-2 Step-4. Pure, deterministic, no I/O.
 *
 * Inputs: a reconciled CanonicalExecutionItem (carries legacy raw + routing
 * surface). It re-derives the routing decision through the centralized
 * engine so state derivation and routing never disagree.
 */

import { resolveExecutionRouting } from '../routing';
import type { CanonicalExecutionItem } from '../../../types/orchestration/CanonicalExecutionItem';
import type {
  AssetState,
  ContentState,
  ExecutionStateDerivedFlags,
  ExecutionStateProjection,
  OrchestrationState,
  PublishState,
  SchedulingState,
  WorkflowState,
} from './orchestrationStateTypes';

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function nonEmptyArr(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

export function projectExecutionState(item: CanonicalExecutionItem): ExecutionStateProjection {
  const legacy = obj(item.metadata?.__legacy_raw);
  const lifecycle = String(item.creator_lifecycle_state ?? '').toLowerCase();
  const status = String(item.status ?? '').toLowerCase();
  const approval = String(item.approval_status ?? '').toLowerCase();

  const routing = resolveExecutionRouting({
    platform: item.platform,
    content_type: item.content_type,
    asset_type: String(item.metadata?.asset_type ?? '') || undefined,
    has_text: undefined,
    has_uploaded_asset: !!item.asset_payload || !!legacy.creator_asset || lifecycle === 'media_uploaded' || lifecycle === 'ready_for_schedule' || lifecycle === 'scheduled',
    requires_video: undefined,
    campaign_context: { campaign_id: item.campaign_id, execution_id: item.execution_id, approval_status: approval },
  });

  const is_creator_flow =
    item.execution_type === 'creator' ||
    routing.execution_type === 'BOLT_CREATOR' ||
    routing.execution_type === 'VIDEO_WORKFLOW';
  const is_video_flow =
    item.asset_requirements?.media_upload_required === true ||
    routing.execution_type === 'VIDEO_WORKFLOW';
  const requires_asset =
    routing.asset_requirement === 'REQUIRED' ||
    item.asset_requirements?.media_upload_required === true;
  // Boolean(...) wrapper intentionally breaks TS aliased-condition narrowing
  // so later `approval === 'approved'` comparisons remain valid.
  const requires_approval = Boolean(approval === 'pending' || approval === 'reapproval_required');

  const has_copy =
    !!item.writer_content_brief ||
    !!legacy.master_content ||
    nonEmptyArr(legacy.platform_variants) ||
    (!is_creator_flow && (!!item.title?.trim() || !!item.objective?.trim()));
  const has_asset =
    !!item.asset_payload ||
    !!legacy.creator_asset ||
    lifecycle === 'media_uploaded' ||
    lifecycle === 'ready_for_schedule' ||
    lifecycle === 'scheduled';
  const has_schedule =
    !!item.scheduled_at ||
    item.scheduling_status === 'scheduled' ||
    !!item.source_reference?.scheduled_post_id;

  const derived_flags: ExecutionStateDerivedFlags = {
    has_copy, has_asset, has_schedule, requires_asset, requires_approval,
    is_creator_flow, is_video_flow,
  };

  // ── content_state ─────────────────────────────────────────────────────────
  const content_state: ContentState =
    has_copy ? 'READY'
    : (item.writer_content_brief || item.objective?.trim()) ? 'PARTIAL'
    : 'EMPTY';

  // ── asset_state ───────────────────────────────────────────────────────────
  let asset_state: AssetState;
  if (!requires_asset && !has_asset) asset_state = 'NONE';
  else if (has_asset && (lifecycle === 'ready_for_schedule' || lifecycle === 'scheduled')) asset_state = 'READY';
  else if (has_asset) asset_state = 'UPLOADED';
  else asset_state = 'PENDING';

  // ── workflow_state ────────────────────────────────────────────────────────
  let workflow_state: WorkflowState;
  if (status === 'published' || lifecycle === 'published') workflow_state = 'PUBLISHED';
  else if (status === 'failed' || lifecycle === 'render_failed' || lifecycle === 'upload_failed') workflow_state = 'FAILED';
  else if (status === 'scheduled' || lifecycle === 'scheduled' || has_schedule) workflow_state = 'SCHEDULED';
  else if (approval === 'approved') workflow_state = 'APPROVED';
  else if (requires_approval && content_state === 'READY' && (!requires_asset || asset_state === 'READY' || asset_state === 'UPLOADED')) workflow_state = 'READY_FOR_APPROVAL';
  else if (content_state === 'READY' || asset_state === 'UPLOADED' || asset_state === 'READY') workflow_state = 'IN_PROGRESS';
  else workflow_state = 'DRAFT';

  // ── scheduling_state ──────────────────────────────────────────────────────
  let scheduling_state: SchedulingState;
  if (item.scheduling_status === 'scheduled' || has_schedule) scheduling_state = 'SCHEDULED';
  else if (status === 'failed') scheduling_state = 'FAILED';
  else if (item.scheduling_status === 'schedulable') scheduling_state = 'READY';
  else scheduling_state = 'UNSCHEDULED';

  // ── blocking_reasons ──────────────────────────────────────────────────────
  const blocking_reasons: string[] = [];
  if (!has_copy && !is_video_flow) blocking_reasons.push('MISSING_COPY');
  if (requires_asset && !has_asset) blocking_reasons.push('MISSING_ASSET');
  if (routing.publish_readiness === 'INVALID_CONFIGURATION') blocking_reasons.push('INVALID_ROUTING');
  if (requires_approval && approval !== 'approved') blocking_reasons.push('MISSING_APPROVAL');
  if (item.scheduling_status === 'blocked') blocking_reasons.push('SCHEDULING_CONFLICT');

  // ── publish_state ─────────────────────────────────────────────────────────
  let publish_state: PublishState;
  if (workflow_state === 'PUBLISHED') publish_state = 'PUBLISHED';
  else if (workflow_state === 'FAILED') publish_state = 'FAILED';
  else if (blocking_reasons.length === 0 && (content_state === 'READY' || (is_video_flow && asset_state === 'READY'))) publish_state = 'READY';
  else publish_state = 'NOT_READY';

  // ── readiness_score (deterministic 0..100) ────────────────────────────────
  let score = 0;
  score += has_copy ? 40 : 0;
  score += requires_asset ? (asset_state === 'READY' ? 30 : asset_state === 'UPLOADED' ? 20 : 0) : 30;
  score += has_schedule ? 20 : (scheduling_state === 'READY' ? 10 : 0);
  score += requires_approval ? (approval === 'approved' ? 10 : 0) : 10;
  if (workflow_state === 'PUBLISHED') score = 100;
  if (workflow_state === 'FAILED') score = Math.min(score, 25);
  const readiness_score = Math.max(0, Math.min(100, score));

  // ── orchestration_state ───────────────────────────────────────────────────
  let orchestration_state: OrchestrationState;
  if (workflow_state === 'PUBLISHED') orchestration_state = 'COMPLETE';
  else if (blocking_reasons.length > 0) orchestration_state = 'BLOCKED';
  else if (readiness_score >= 90 || publish_state === 'READY' || scheduling_state === 'SCHEDULED') orchestration_state = 'READY';
  else orchestration_state = 'ACTIVE';

  return {
    execution_id: item.execution_id,
    content_state,
    asset_state,
    workflow_state,
    orchestration_state,
    scheduling_state,
    publish_state,
    readiness_score,
    blocking_reasons,
    derived_flags,
    updated_at: new Date().toISOString(),
  };
}
