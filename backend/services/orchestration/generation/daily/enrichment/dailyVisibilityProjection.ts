/**
 * dailyVisibilityProjection — Phase-2 Step-17.
 * Derives the visible workflow badges + the corrected orchestration counts
 * (AI-creatable assets must NOT inflate blocked / pending-upload). Pure.
 */

import type { DailyAssetProjection } from './dailyAssetProjection';

export type DailyWorkflowMode =
  | 'AI_ASSET_READY'
  | 'CREATOR_WORKFLOW'
  | 'UPLOAD_REQUIRED'
  | 'MANUAL_WORKFLOW'
  | 'HYBRID_WORKFLOW'
  | 'OWNED_CONTENT'
  | 'TEXT_ONLY';

export interface DailyVisibility {
  workflow_mode: DailyWorkflowMode;
  badges: string[];
  ai_asset_ready: boolean;
  creator_workflow: boolean;
  upload_required: boolean;
  owned_content: boolean;
  approval_required: boolean;
  scheduling_ready: boolean;
}

export function projectDailyVisibility(input: {
  activity_type: string;
  routing: { execution_type?: string; workflow_type?: string; creator_requirement?: boolean } | null;
  asset: DailyAssetProjection;
  approval_required: boolean;
  scheduling_ready: boolean;
}): DailyVisibility {
  const { activity_type, routing, asset } = input;
  const owned = activity_type === 'OWNED_CONTENT';
  const exec = String(routing?.execution_type ?? '');
  const isCreator = exec === 'BOLT_CREATOR' || exec === 'VIDEO_WORKFLOW' ||
    (exec === 'HYBRID' && routing?.creator_requirement === true);
  const aiReady = asset.asset_state === 'AI_READY';
  const uploadReq = asset.upload_required;

  let workflow_mode: DailyWorkflowMode = 'TEXT_ONLY';
  if (owned) workflow_mode = 'OWNED_CONTENT';
  else if (exec === 'HYBRID') workflow_mode = 'HYBRID_WORKFLOW';
  else if (aiReady) workflow_mode = 'AI_ASSET_READY';
  else if (exec === 'VIDEO_WORKFLOW' || uploadReq) workflow_mode = 'UPLOAD_REQUIRED';
  else if (isCreator) workflow_mode = 'CREATOR_WORKFLOW';
  else if (activity_type === 'ASSET_ONLY') workflow_mode = 'MANUAL_WORKFLOW';

  const badges: string[] = [];
  if (aiReady) badges.push('AI Asset Ready');
  if (isCreator) badges.push('Creator Workflow');
  if (uploadReq) badges.push('Upload Required');
  if (workflow_mode === 'MANUAL_WORKFLOW') badges.push('Manual Workflow');
  if (exec === 'HYBRID') badges.push('Hybrid Workflow');
  if (owned) badges.push('Owned Content');
  if (input.approval_required) badges.push('Approval Required');
  if (input.scheduling_ready) badges.push('Scheduling Ready');

  return {
    workflow_mode,
    badges,
    ai_asset_ready: aiReady,
    creator_workflow: isCreator,
    upload_required: uploadReq,
    owned_content: owned,
    approval_required: input.approval_required,
    scheduling_ready: input.scheduling_ready,
  };
}

/**
 * Corrected counts: a card is "blocked"/"pending_upload" ONLY when it is
 * genuinely so — AI-creatable (AI_READY) assets are excluded unless degraded.
 */
export function correctedReadinessCounts(
  cards: Array<{ visibility: DailyVisibility; asset: DailyAssetProjection }>,
): { blocked: number; pending_upload: number; ai_ready: number; reclassified: number } {
  let blocked = 0;
  let pending_upload = 0;
  let ai_ready = 0;
  let reclassified = 0;
  for (const c of cards) {
    if (c.asset.asset_state === 'AI_READY') {
      ai_ready += 1;
      reclassified += 1; // would have been pending/blocked under legacy aggregation
      continue;
    }
    if (c.asset.asset_state === 'PENDING_UPLOAD' && c.asset.upload_required) pending_upload += 1;
  }
  return { blocked, pending_upload, ai_ready, reclassified };
}
