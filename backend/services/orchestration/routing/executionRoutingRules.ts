/**
 * Execution Routing — pure decision rules (Phase-2 Step-2).
 *
 * Registries/config are INPUTS here, not authorities:
 *   - lib/shared/contentTypeClassification (bolt_text / creator_autonomous / video_brief)
 *   - lib/shared/creatorGovernanceRegistry  (Group A/B, media_upload_required)
 *   - backend/utils/boltTextContentConfig    (BOLT text formats)
 *
 * No DB, no side effects — safe to call from anywhere.
 */

import { classifyContentType } from '../../../../lib/shared/contentTypeClassification';
import { getCreatorGovernance } from '../../../../lib/shared/creatorGovernanceRegistry';
import { isBoltTextContentType } from '../../../utils/boltTextContentConfig';
import type {
  AssetRequirement,
  ExecutionRoutingDecision,
  ExecutionRoutingInput,
  ExecutionType,
  PublishReadiness,
  RoutingActivityType,
  RoutingWorkflowType,
  SchedulingReadiness,
} from './executionRoutingTypes';

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

export function computeRoutingDecision(input: ExecutionRoutingInput): ExecutionRoutingDecision {
  const reasoning: string[] = [];
  const contentType = norm(input.content_type);
  const assetType = norm(input.asset_type);
  const platform = norm(input.platform);
  const approval = norm((input.campaign_context as Record<string, unknown> | null)?.approval_status);

  const cls = classifyContentType(contentType || assetType);
  const gov = getCreatorGovernance(contentType || assetType);
  const isText = cls.mode === 'bolt_text' || isBoltTextContentType(contentType);
  const isAutonomousCreator = cls.mode === 'creator_autonomous';
  const isVideo =
    input.requires_video === true || cls.isVideoBrief || gov?.media_upload_required === true;
  const isEmbedded = contentType === 'post_with_asset' || contentType === 'thread_with_asset';
  const hasExternal = input.has_external_content === true;
  const validConfig = Boolean(platform && contentType);

  // ── execution_type ────────────────────────────────────────────────────────
  let execution_type: ExecutionType;
  if (hasExternal) { execution_type = 'MANUAL'; reasoning.push('external owned content → MANUAL'); }
  else if (isVideo) { execution_type = 'VIDEO_WORKFLOW'; reasoning.push('video / media-upload format → VIDEO_WORKFLOW'); }
  else if (isText && (isAutonomousCreator || isEmbedded || input.has_uploaded_asset)) { execution_type = 'HYBRID'; reasoning.push('text + asset → HYBRID'); }
  else if (isAutonomousCreator) { execution_type = 'BOLT_CREATOR'; reasoning.push('autonomous creator format → BOLT_CREATOR'); }
  else if (isText) { execution_type = 'BOLT_TEXT'; reasoning.push('BOLT text format → BOLT_TEXT'); }
  else { execution_type = 'MANUAL'; reasoning.push('unclassified → MANUAL'); }

  // ── activity_type ─────────────────────────────────────────────────────────
  let activity_type: RoutingActivityType;
  if (hasExternal) activity_type = 'OWNED_CONTENT';
  else if (isEmbedded) activity_type = 'EMBEDDED_TEXT_ASSET';
  else if (isText && (isAutonomousCreator || input.has_uploaded_asset)) activity_type = 'TEXT_PLUS_ASSET';
  else if (isAutonomousCreator || isVideo) activity_type = 'ASSET_ONLY';
  else activity_type = 'TEXT_ONLY';

  // ── workflow_type ─────────────────────────────────────────────────────────
  let workflow_type: RoutingWorkflowType;
  if (hasExternal) workflow_type = 'EXTERNAL_REFERENCE';
  else if (isVideo) workflow_type = 'MANUAL_UPLOAD';
  else if (isAutonomousCreator || isText) workflow_type = 'AUTONOMOUS';
  else workflow_type = 'ASSISTED';

  // ── asset_requirement ─────────────────────────────────────────────────────
  let asset_requirement: AssetRequirement;
  if (isVideo) asset_requirement = 'REQUIRED';
  else if (isAutonomousCreator) asset_requirement = 'REQUIRED';
  else if (isText && (isEmbedded || input.has_uploaded_asset)) asset_requirement = 'OPTIONAL';
  else asset_requirement = 'NONE';

  const creator_requirement =
    execution_type === 'BOLT_CREATOR' || execution_type === 'VIDEO_WORKFLOW' ||
    (execution_type === 'HYBRID' && isAutonomousCreator);

  // ── scheduling_readiness ──────────────────────────────────────────────────
  let scheduling_readiness: SchedulingReadiness;
  if (!validConfig) scheduling_readiness = 'BLOCKED';
  else if (isVideo && !input.has_uploaded_asset) scheduling_readiness = 'PENDING_ASSET';
  else if (approval === 'pending' || approval === 'reapproval_required') scheduling_readiness = 'PENDING_APPROVAL';
  else scheduling_readiness = 'READY';

  // ── publish_readiness ─────────────────────────────────────────────────────
  let publish_readiness: PublishReadiness;
  if (!validConfig) publish_readiness = 'INVALID_CONFIGURATION';
  else if ((isVideo || (isAutonomousCreator && asset_requirement === 'REQUIRED')) && !input.has_uploaded_asset && isVideo) publish_readiness = 'MISSING_ASSET';
  else if (isText && input.has_text === false) publish_readiness = 'MISSING_COPY';
  else if (approval === 'pending' || approval === 'reapproval_required') publish_readiness = 'PENDING_APPROVAL';
  else publish_readiness = 'READY';

  return {
    execution_type,
    activity_type,
    workflow_type,
    asset_requirement,
    creator_requirement,
    scheduling_readiness,
    publish_readiness,
    routing_source: 'executionRoutingEngine.v1',
    reasoning,
    diagnostics: {
      content_type: contentType,
      asset_type: assetType,
      platform,
      classification_mode: cls.mode,
      classification_asset_family: cls.assetFamily ?? null,
      governance_found: !!gov,
      media_upload_required: gov?.media_upload_required ?? false,
      autonomous_renderable: gov?.autonomous_renderable ?? false,
      is_text: isText,
      is_autonomous_creator: isAutonomousCreator,
      is_video: isVideo,
      has_external_content: hasExternal,
      has_uploaded_asset: input.has_uploaded_asset ?? false,
      approval_status: approval || null,
    },
  };
}

/**
 * Behaviour-preserving helper for the legacy `requiresMediaIntent` set in
 * generate-weekly-structure.ts. Equivalent to the old hard-coded list
 * ['carousel','image','story','banner','infographic','pdf','slider']:
 * autonomous creator (Group A) and NOT video/text.
 */
export function isLegacyAutonomousMediaRoute(contentType: string): boolean {
  const d = computeRoutingDecision({ content_type: contentType, platform: 'linkedin' });
  return (
    d.execution_type === 'BOLT_CREATOR' &&
    d.asset_requirement === 'REQUIRED' &&
    d.workflow_type === 'AUTONOMOUS'
  );
}
