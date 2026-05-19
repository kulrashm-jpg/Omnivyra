/**
 * authoritativeWorkspaceResolver — Phase-2 Step-27.
 *
 * THE single entrypoint an execution workspace calls to obtain canonical
 * execution authority. Composes ONLY canonical orchestration surfaces
 * (getExecutionItem → projectExecutionState + resolveExecutionRouting +
 * hydrateAiAsset + deriveProvenanceFromContent) — no inline upload/creator/
 * readiness/routing derivation. Fail-soft: any failure ⇒ null projection so
 * the caller transparently keeps its legacy path (SHADOW/rollback safe).
 */

import { getExecutionItem } from '../canonicalExecutionAdapter';
import { projectExecutionState } from '../synchronization';
import { resolveExecutionRouting } from '../routing';
import { hydrateAiAsset } from '../assets';
import { deriveProvenanceFromContent, ORCHESTRATION_VERSION } from '../provenance';
import {
  buildWorkspaceExecutionProjection,
  type WorkspaceExecutionProjection,
} from './workspaceExecutionProjection';
import {
  resolveWorkspaceMode,
  deriveLegacyWorkspaceSnapshot,
  diffWorkspace,
  type WorkspaceDiffResult,
} from './workspaceFallbackManager';
import { workspaceDiagnostics } from './workspaceDiagnostics';

export interface AuthoritativeWorkspaceResult {
  mode: 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';
  fallback_active: boolean;
  projection: WorkspaceExecutionProjection | null;
  diff: WorkspaceDiffResult | null;
}

export async function resolveAuthoritativeWorkspace(
  campaignId: string,
  executionId: string,
): Promise<AuthoritativeWorkspaceResult> {
  const FAILED: AuthoritativeWorkspaceResult = {
    mode: 'LEGACY', fallback_active: true, projection: null, diff: null,
  };
  if (!campaignId || !executionId) return FAILED;

  try {
    const item = await getExecutionItem(campaignId, executionId).catch(() => null);
    if (!item) {
      workspaceDiagnostics.fallback({
        campaign_id: campaignId, execution_id: executionId,
        workspace_mode: 'LEGACY', fallback_active: true, reason: 'canonical_item_missing',
      });
      return FAILED;
    }

    const legacyRaw: Record<string, unknown> =
      item.metadata && typeof item.metadata.__legacy_raw === 'object' && item.metadata.__legacy_raw
        ? (item.metadata.__legacy_raw as Record<string, unknown>)
        : {};

    const state = projectExecutionState(item);
    const routing = resolveExecutionRouting({
      platform: item.platform,
      content_type: item.content_type,
      asset_type: String(item.metadata?.asset_type ?? '') || undefined,
      campaign_context: { campaign_id: campaignId, execution_id: executionId },
    });
    const aiAsset = hydrateAiAsset({
      campaignId,
      executionId,
      contentType: item.content_type,
      routing: {
        execution_type: routing.execution_type,
        workflow_type: routing.workflow_type,
        asset_requirement: routing.asset_requirement,
      },
      blob: legacyRaw,
    });
    const { provenance } = deriveProvenanceFromContent(executionId, legacyRaw, {
      reconciledWithBlueprint: Boolean(item.metadata?.reconciled_with_blueprint),
    });

    const orchestrationComplete =
      state.orchestration_state !== 'BLOCKED' && Boolean(provenance);
    const decision = resolveWorkspaceMode({
      projectionAvailable: true,
      rollbackTriggered: Boolean(provenance?.rollback_triggered),
      orchestrationComplete,
    });

    if (decision.reason === 'rollback_triggered') {
      workspaceDiagnostics.rollback({
        campaign_id: campaignId, execution_id: executionId,
        workspace_mode: decision.mode, fallback_active: true,
      });
    }

    const projection = buildWorkspaceExecutionProjection({
      campaignId,
      executionId,
      mode: decision.mode,
      orchestrationVersion: ORCHESTRATION_VERSION,
      item,
      routing,
      state,
      aiAsset,
      provenance,
      legacyRaw,
    });

    // SHADOW validation — compare authoritative vs legacy-derived snapshot.
    const legacySnapshot = deriveLegacyWorkspaceSnapshot(legacyRaw);
    const diff = diffWorkspace(projection, legacySnapshot);

    workspaceDiagnostics.projection({
      campaign_id: campaignId,
      execution_id: executionId,
      workspace_mode: decision.mode,
      readiness_state: projection.readiness_state.orchestration_state,
      creator_state: projection.creator_state.is_creator_flow ? 'creator' : 'non_creator',
      upload_state: projection.upload_state.upload_required ? 'required' : 'not_required',
      orchestration_version: ORCHESTRATION_VERSION,
      fallback_active: decision.fallback_active,
    });
    workspaceDiagnostics.aiAsset({
      campaign_id: campaignId,
      execution_id: executionId,
      ai_asset_state: projection.ai_asset.state,
      ai_asset_origin: projection.ai_asset.origin,
      preview_pending: projection.ai_asset.preview_pending,
      fallback_mode: projection.ai_asset.fallback_mode,
    });
    workspaceDiagnostics.executionDiff({
      campaign_id: campaignId,
      execution_id: executionId,
      workspace_mode: decision.mode,
      orchestration_fidelity: diff.orchestration_fidelity,
      mismatches: diff.mismatches,
      readiness_match: diff.readiness_match,
      upload_match: diff.upload_match,
      creator_match: diff.creator_match,
      ai_asset_match: diff.ai_asset_match,
      scheduling_match: diff.scheduling_match,
    });
    if (decision.mode === 'AUTHORITATIVE') {
      workspaceDiagnostics.authoritative({
        campaign_id: campaignId, execution_id: executionId,
        workspace_mode: 'AUTHORITATIVE', orchestration_version: ORCHESTRATION_VERSION,
        fallback_active: false,
      });
    }

    return {
      mode: decision.mode,
      fallback_active: decision.fallback_active,
      projection,
      diff,
    };
  } catch (e) {
    workspaceDiagnostics.fallback({
      campaign_id: campaignId,
      execution_id: executionId,
      workspace_mode: 'LEGACY',
      fallback_active: true,
      reason: `exception:${(e as Error)?.message ?? 'unknown'}`,
    });
    return FAILED;
  }
}
