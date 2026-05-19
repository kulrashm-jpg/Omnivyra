/**
 * workspaceFallbackManager — Phase-2 Step-27.
 *
 * Decides the workspace authority mode and isolates legacy derivation so it
 * activates ONLY when (a) the authoritative projection is missing, (b)
 * rollback is triggered, (c) orchestration is incomplete, or (d) explicit
 * LEGACY cutover mode. Also produces a legacy-derived comparison snapshot
 * and the [WORKSPACE_EXECUTION_DIFF] category result so SHADOW can validate
 * authoritative fidelity WITHOUT changing behavior.
 */

import { resolveCutoverMode } from '../generation';
import type { WorkspaceExecutionProjection, WorkspaceMode } from './workspaceExecutionProjection';

export interface WorkspaceModeDecision {
  mode: WorkspaceMode;
  fallback_active: boolean;
  reason: string;
}

/**
 * SHADOW is the safe default (diff-only, zero behavior change). LEGACY when
 * the cutover is LEGACY, the projection is unavailable, or rollback fired.
 */
export function resolveWorkspaceMode(params: {
  projectionAvailable: boolean;
  rollbackTriggered: boolean;
  orchestrationComplete: boolean;
}): WorkspaceModeDecision {
  if (!params.projectionAvailable) {
    return { mode: 'LEGACY', fallback_active: true, reason: 'projection_unavailable' };
  }
  if (params.rollbackTriggered) {
    return { mode: 'LEGACY', fallback_active: true, reason: 'rollback_triggered' };
  }
  const cutover = resolveCutoverMode();
  if (cutover === 'LEGACY') {
    return { mode: 'LEGACY', fallback_active: true, reason: 'cutover_legacy' };
  }
  if (!params.orchestrationComplete) {
    return { mode: 'SHADOW', fallback_active: true, reason: 'orchestration_incomplete' };
  }
  if (cutover === 'AUTHORITATIVE') {
    return { mode: 'AUTHORITATIVE', fallback_active: false, reason: 'cutover_authoritative' };
  }
  return { mode: 'SHADOW', fallback_active: true, reason: 'cutover_shadow' };
}

export interface LegacyWorkspaceSnapshot {
  readiness_ready: boolean;
  upload_required: boolean;
  is_creator: boolean;
  ai_asset_state: string;
  scheduled: boolean;
}

/** Legacy-derived comparison snapshot (FALLBACK-ONLY — never authoritative). */
export function deriveLegacyWorkspaceSnapshot(
  legacyRaw: Record<string, unknown>,
): LegacyWorkspaceSnapshot {
  const status = String(legacyRaw.content_status ?? '').toLowerCase();
  const intentType = String(legacyRaw.intent_type ?? '').toLowerCase();
  const assetType = String(legacyRaw.asset_type ?? '').toLowerCase();
  const hasCreatorAsset =
    !!legacyRaw.creator_asset ||
    !!(legacyRaw.asset_payload as { override_asset?: unknown } | undefined)?.override_asset;
  const override = legacyRaw.ai_asset_override as { state?: unknown } | undefined;
  const aiState = override?.state
    ? String(override.state).toUpperCase()
    : (legacyRaw.ai_asset as { asset_state?: unknown } | undefined)?.asset_state
      ? String((legacyRaw.ai_asset as { asset_state?: unknown }).asset_state).toUpperCase()
      : 'NONE';

  return {
    readiness_ready: ['render_ready', 'ready', 'creator_ready', 'scheduled', 'published'].includes(status),
    upload_required:
      (intentType === 'creator' || ['video', 'reel', 'short'].includes(assetType)) && !hasCreatorAsset,
    is_creator: intentType === 'creator',
    ai_asset_state: aiState,
    scheduled: status === 'scheduled' || status === 'published' || !!legacyRaw.scheduled_post_id,
  };
}

export interface WorkspaceDiffResult {
  readiness_match: boolean;
  upload_match: boolean;
  creator_match: boolean;
  ai_asset_match: boolean;
  scheduling_match: boolean;
  orchestration_fidelity: boolean;
  mismatches: string[];
}

/** Category diff: authoritative projection vs legacy-derived snapshot. */
export function diffWorkspace(
  authoritative: WorkspaceExecutionProjection,
  legacy: LegacyWorkspaceSnapshot,
): WorkspaceDiffResult {
  const mismatches: string[] = [];

  const authReady =
    authoritative.readiness_state.orchestration_state === 'READY' ||
    authoritative.readiness_state.orchestration_state === 'COMPLETE';
  const readiness_match = authReady === legacy.readiness_ready;
  if (!readiness_match) mismatches.push('readiness');

  const upload_match = authoritative.upload_state.upload_required === legacy.upload_required;
  if (!upload_match) mismatches.push('upload');

  const creator_match = authoritative.creator_state.is_creator_flow === legacy.is_creator;
  if (!creator_match) mismatches.push('creator');

  const ai_asset_match = authoritative.ai_asset.state === legacy.ai_asset_state;
  if (!ai_asset_match) mismatches.push('ai_asset');

  const scheduling_match =
    (authoritative.scheduling_state.scheduling_state === 'SCHEDULED') === legacy.scheduled;
  if (!scheduling_match) mismatches.push('scheduling');

  const orchestration_fidelity = mismatches.length === 0;

  return {
    readiness_match,
    upload_match,
    creator_match,
    ai_asset_match,
    scheduling_match,
    orchestration_fidelity,
    mismatches,
  };
}
