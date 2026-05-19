/**
 * workspaceFallbackAdapter — Phase-2 Step-28.
 *
 * Pure. Decides whether the UI consumes the authoritative projection as
 * PRIMARY or stays on legacy derivation (fallback-only), and produces the
 * [WORKSPACE_UI_DIFF] category result.
 *
 * Authority gate (preserves SHADOW safety + rollback):
 *   AUTHORITATIVE cutover + valid projection + no rollback → projection PRIMARY
 *   SHADOW                                                  → legacy primary,
 *                                                             projection diffed
 *   LEGACY / missing / rollback / invalid                   → legacy only
 */

import type {
  WorkspaceProjectionEnvelope,
  WorkspaceUIView,
} from './workspaceProjectionAdapter';

export type WorkspaceUIMode = 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';

export interface LegacyUISnapshot {
  isCreatorActivity: boolean;
  hasCreatorAsset: boolean;
  uploadRequired: boolean;
  aiAssetState: string;
  schedulingState: string;
  readinessReady: boolean;
}

export function isProjectionValid(view: WorkspaceUIView | null): view is WorkspaceUIView {
  return Boolean(view) && typeof view!.readinessState === 'string';
}

/**
 * Resolve the effective UI authority mode. Authoritative consumption only
 * when the server cut over to AUTHORITATIVE, the projection is valid, and
 * rollback is not active — otherwise legacy stays primary.
 */
export function resolveUIMode(
  envelope: WorkspaceProjectionEnvelope | null,
  view: WorkspaceUIView | null,
): WorkspaceUIMode {
  if (!envelope || !isProjectionValid(view)) return 'LEGACY';
  if (view.provenance.rollback_triggered) return 'LEGACY';
  if (envelope.mode === 'LEGACY') return 'LEGACY';
  if (envelope.mode === 'AUTHORITATIVE') return 'AUTHORITATIVE';
  return 'SHADOW';
}

export interface WorkspaceUIDiffResult {
  creator_match: boolean;
  upload_match: boolean;
  ai_asset_match: boolean;
  scheduling_match: boolean;
  readiness_match: boolean;
  orchestration_fidelity: boolean;
  mismatches: string[];
}

/** Diff the authoritative UI view vs what legacy derivation would render. */
export function diffWorkspaceUI(
  view: WorkspaceUIView,
  legacy: LegacyUISnapshot,
): WorkspaceUIDiffResult {
  const mismatches: string[] = [];

  const creator_match = view.isCreatorActivity === legacy.isCreatorActivity;
  if (!creator_match) mismatches.push('creator');

  const upload_match =
    view.hasCreatorAsset === legacy.hasCreatorAsset &&
    view.uploadRequired === legacy.uploadRequired;
  if (!upload_match) mismatches.push('upload');

  const ai_asset_match = view.aiAssetState === legacy.aiAssetState;
  if (!ai_asset_match) mismatches.push('ai_asset');

  const scheduling_match =
    (view.schedulingState === 'SCHEDULED') === (legacy.schedulingState === 'SCHEDULED');
  if (!scheduling_match) mismatches.push('scheduling');

  const authReady = view.readinessState === 'READY' || view.readinessState === 'COMPLETE';
  const readiness_match = authReady === legacy.readinessReady;
  if (!readiness_match) mismatches.push('readiness');

  return {
    creator_match,
    upload_match,
    ai_asset_match,
    scheduling_match,
    readiness_match,
    orchestration_fidelity: mismatches.length === 0,
    mismatches,
  };
}
