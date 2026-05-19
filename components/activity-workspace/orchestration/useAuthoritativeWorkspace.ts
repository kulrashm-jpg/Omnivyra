/**
 * useAuthoritativeWorkspace — Phase-2 Step-28.
 *
 * The workspace UI's single authority hook. Returns the canonical
 * projection as the PRIMARY view when the server cut over to AUTHORITATIVE
 * (valid projection, no rollback); otherwise returns `view: null` so the
 * caller keeps its legacy derivation (fallback-only). In SHADOW it stays
 * legacy-primary but emits [WORKSPACE_UI_DIFF] for fidelity validation.
 *
 * Read-only, fail-soft: any malformed payload → LEGACY, never throws.
 */

import { useEffect, useMemo } from 'react';
import {
  extractWorkspaceProjection,
  toWorkspaceUIView,
  type WorkspaceUIView,
} from './workspaceProjectionAdapter';
import {
  resolveUIMode,
  diffWorkspaceUI,
  type WorkspaceUIMode,
  type LegacyUISnapshot,
  type WorkspaceUIDiffResult,
} from './workspaceFallbackAdapter';
import { workspaceUIDiagnostics } from './workspaceUIDiagnostics';

export interface AuthoritativeWorkspaceResultUI {
  mode: WorkspaceUIMode;
  /** Non-null ONLY when mode === 'AUTHORITATIVE' (legacy stays primary otherwise). */
  view: WorkspaceUIView | null;
  /** Always present when a projection exists (used for diffing/visibility). */
  shadowView: WorkspaceUIView | null;
  fallbackActive: boolean;
  diff: WorkspaceUIDiffResult | null;
}

export function useAuthoritativeWorkspace(
  payload: unknown,
  legacy: LegacyUISnapshot | null,
  ids?: { campaignId?: string | null; executionId?: string | null },
): AuthoritativeWorkspaceResultUI {
  const result = useMemo<AuthoritativeWorkspaceResultUI>(() => {
    const envelope = extractWorkspaceProjection(payload);
    const shadowView = envelope?.projection ? toWorkspaceUIView(envelope.projection) : null;
    const mode = resolveUIMode(envelope, shadowView);
    const diff =
      shadowView && legacy ? diffWorkspaceUI(shadowView, legacy) : null;
    return {
      mode,
      view: mode === 'AUTHORITATIVE' ? shadowView : null,
      shadowView,
      fallbackActive: mode !== 'AUTHORITATIVE',
      diff,
    };
  }, [payload, legacy]);

  useEffect(() => {
    const base = {
      campaign_id: ids?.campaignId ?? null,
      execution_id: ids?.executionId ?? null,
      workspace_mode: result.mode,
      fallback_active: result.fallbackActive,
    };
    if (!result.shadowView) {
      workspaceUIDiagnostics.fallback({ ...base, reason: 'no_projection' });
      return;
    }
    const v = result.shadowView;
    const rendered = {
      ...base,
      rendered_readiness: v.readinessState,
      rendered_creator_state: v.isCreatorActivity ? 'creator' : 'non_creator',
      rendered_upload_state: v.uploadRequired ? 'required' : 'not_required',
      rendered_ai_asset_state: v.aiAssetState,
    };
    workspaceUIDiagnostics.projection(rendered);
    workspaceUIDiagnostics.aiAsset({
      ...base,
      rendered_ai_asset_state: v.aiAssetState,
      ai_asset_origin: v.aiAssetOrigin,
      preview_pending: v.aiPreviewPending,
      fallback_mode: v.aiFallbackMode,
    });
    if (v.provenance.rollback_triggered) workspaceUIDiagnostics.rollback(rendered);
    if (result.mode === 'AUTHORITATIVE') workspaceUIDiagnostics.authoritative(rendered);
    if (result.diff) {
      workspaceUIDiagnostics.diff({
        ...base,
        orchestration_fidelity: result.diff.orchestration_fidelity,
        mismatches: result.diff.mismatches,
      });
    }
  }, [result, ids?.campaignId, ids?.executionId]);

  return result;
}
