/**
 * workspaceRenderAuthority — Phase-2 Step-29.
 *
 * Pure. Produces the render-ready values every workspace panel needs, with
 * per-signal fallback isolation: when the UI mode is AUTHORITATIVE the
 * canonical projection (Step-27/28 `WorkspaceUIView`) is the rendering
 * source; otherwise the legacy-derived values render (fallback-only). Also
 * derives the canonical execution-mode from routing/creator lineage (no
 * inline `inferExecutionMode`) and an extended render diff.
 *
 * NOTHING here re-derives readiness/upload/creator inline — every
 * authoritative field traces to the canonical view; legacy is passed in.
 */

import type { WorkspaceUIView } from './workspaceProjectionAdapter';
import type { WorkspaceUIMode } from './workspaceFallbackAdapter';

export type ExecutionModeValue = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export interface LegacyRenderInputs {
  executionMode: string;
  isCreatorActivity: boolean;
  hasCreatorAsset: boolean;
  uploadRequired: boolean;
  aiAssetState: string;
  schedulingState: string;
  readinessReady: boolean;
}

/** Canonical execution-mode from routing/creator lineage ONLY. */
export function deriveAuthoritativeExecutionMode(view: WorkspaceUIView): ExecutionModeValue {
  const wf = String(view.routingLineage.workflow_type ?? '').toUpperCase();
  const assetReq = String(view.routingLineage.asset_requirement ?? '').toUpperCase();
  if (view.isVideoFlow || (view.uploadRequired && wf === 'MANUAL_UPLOAD') || assetReq === 'REQUIRED_MANUAL') {
    return 'CREATOR_REQUIRED';
  }
  if (view.isCreatorActivity && wf === 'AUTONOMOUS') return 'CONDITIONAL_AI';
  return 'AI_AUTOMATED';
}

export interface WorkspaceRenderAuthority {
  source: 'authoritative' | 'legacy';
  // creator / upload
  executionMode: string;
  isCreatorActivity: boolean;
  hasCreatorAsset: boolean;
  uploadRequired: boolean;
  uploadAssetState: string;
  // readiness / scheduling
  readinessState: string;
  publishState: string;
  readinessScore: number;
  blockingReasons: string[];
  schedulingState: string;
  schedulable: boolean;
  // AI-asset
  aiAssetState: string;
  aiAssetOrigin: string | null;
  aiPreviewUrl: string | null;
  aiPreviewPending: boolean;
  aiFallbackMode: boolean;
  aiUploadOverrideAvailable: boolean;
  // lineage
  routingLineage: WorkspaceUIView['routingLineage'];
  provenance: WorkspaceUIView['provenance'];
}

export interface RenderDiffResult {
  readiness_match: boolean;
  scheduling_match: boolean;
  upload_match: boolean;
  creator_match: boolean;
  ai_asset_match: boolean;
  blocker_visibility_match: boolean;
  orchestration_fidelity: boolean;
  mismatches: string[];
  mismatch_count: number;
}

export function buildRenderAuthority(params: {
  mode: WorkspaceUIMode;
  view: WorkspaceUIView | null;
  legacy: LegacyRenderInputs;
}): { render: WorkspaceRenderAuthority; diff: RenderDiffResult | null } {
  const { mode, view, legacy } = params;
  const authoritative = mode === 'AUTHORITATIVE' && !!view;

  const render: WorkspaceRenderAuthority = authoritative
    ? {
        source: 'authoritative',
        executionMode: deriveAuthoritativeExecutionMode(view!),
        isCreatorActivity: view!.isCreatorActivity,
        hasCreatorAsset: view!.hasCreatorAsset,
        uploadRequired: view!.uploadRequired,
        uploadAssetState: view!.uploadAssetState,
        readinessState: view!.readinessState,
        publishState: view!.publishState,
        readinessScore: view!.readinessScore,
        blockingReasons: view!.blockingReasons,
        schedulingState: view!.schedulingState,
        schedulable: view!.schedulable,
        aiAssetState: view!.aiAssetState,
        aiAssetOrigin: view!.aiAssetOrigin,
        aiPreviewUrl: view!.aiPreviewUrl,
        aiPreviewPending: view!.aiPreviewPending,
        aiFallbackMode: view!.aiFallbackMode,
        aiUploadOverrideAvailable: view!.aiUploadOverrideAvailable,
        routingLineage: view!.routingLineage,
        provenance: view!.provenance,
      }
    : {
        source: 'legacy',
        executionMode: legacy.executionMode,
        isCreatorActivity: legacy.isCreatorActivity,
        hasCreatorAsset: legacy.hasCreatorAsset,
        uploadRequired: legacy.uploadRequired,
        uploadAssetState: legacy.hasCreatorAsset ? 'UPLOADED' : 'NONE',
        readinessState: legacy.readinessReady ? 'READY' : 'ACTIVE',
        publishState: legacy.readinessReady ? 'READY' : 'NOT_READY',
        readinessScore: legacy.readinessReady ? 100 : 0,
        blockingReasons: [],
        schedulingState: legacy.schedulingState,
        schedulable: legacy.schedulingState === 'SCHEDULED',
        aiAssetState: legacy.aiAssetState,
        aiAssetOrigin: null,
        aiPreviewUrl: null,
        aiPreviewPending: false,
        aiFallbackMode: false,
        aiUploadOverrideAvailable: false,
        routingLineage: { execution_type: null, activity_type: null, workflow_type: null, asset_requirement: null },
        provenance: { generation_source: 'LEGACY', generation_mode: 'UNKNOWN', fallback_active: true, rollback_triggered: false },
      };

  // Diff is computed whenever a canonical view exists (incl. SHADOW) so
  // fidelity is validated without changing what renders.
  let diff: RenderDiffResult | null = null;
  if (view) {
    const mismatches: string[] = [];
    const authReady = view.readinessState === 'READY' || view.readinessState === 'COMPLETE';
    const readiness_match = authReady === legacy.readinessReady;
    if (!readiness_match) mismatches.push('readiness');
    const scheduling_match =
      (view.schedulingState === 'SCHEDULED') === (legacy.schedulingState === 'SCHEDULED');
    if (!scheduling_match) mismatches.push('scheduling');
    const upload_match =
      view.uploadRequired === legacy.uploadRequired &&
      view.hasCreatorAsset === legacy.hasCreatorAsset;
    if (!upload_match) mismatches.push('upload');
    const creator_match = view.isCreatorActivity === legacy.isCreatorActivity;
    if (!creator_match) mismatches.push('creator');
    const ai_asset_match = view.aiAssetState === legacy.aiAssetState;
    if (!ai_asset_match) mismatches.push('ai_asset');
    // Legacy never surfaced blockers → visibility matches only when the
    // canonical view also has none.
    const blocker_visibility_match = view.blockingReasons.length === 0;
    if (!blocker_visibility_match) mismatches.push('blocker_visibility');

    diff = {
      readiness_match,
      scheduling_match,
      upload_match,
      creator_match,
      ai_asset_match,
      blocker_visibility_match,
      orchestration_fidelity: mismatches.length === 0,
      mismatches,
      mismatch_count: mismatches.length,
    };
  }

  return { render, diff };
}
