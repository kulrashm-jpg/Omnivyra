/**
 * workspaceProjectionAdapter — Phase-2 Step-28.
 *
 * Pure. Extracts the Step-27 `workspace_projection` envelope from the
 * resolve payload and normalizes the canonical projection into the exact
 * UI-facing shape the workspace already consumes (isCreatorActivity,
 * hasCreatorAsset, readiness, scheduling, AI-asset, provenance, routing) —
 * so the UI can switch its source WITHOUT any layout/JSX change.
 *
 * No derivation here: every field traces 1:1 to the canonical projection.
 */

export interface WorkspaceProjectionEnvelope {
  mode: 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';
  fallback_active: boolean;
  projection: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
}

export interface WorkspaceUIView {
  // creator / upload authority
  isCreatorActivity: boolean;
  isVideoFlow: boolean;
  hasCreatorAsset: boolean;
  uploadRequired: boolean;
  uploadAssetState: string;
  // AI-asset authority
  aiAssetState: string;
  aiAssetOrigin: string | null;
  aiPreviewUrl: string | null;
  aiPreviewPending: boolean;
  aiFallbackMode: boolean;
  aiUploadOverrideAvailable: boolean;
  // readiness / scheduling authority
  readinessState: string;
  publishState: string;
  readinessScore: number;
  blockingReasons: string[];
  schedulingState: string;
  schedulable: boolean;
  // lineage
  provenance: {
    generation_source: string;
    generation_mode: string;
    fallback_active: boolean;
    rollback_triggered: boolean;
  };
  routingLineage: {
    execution_type: string | null;
    activity_type: string | null;
    workflow_type: string | null;
    asset_requirement: string | null;
  };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function strOrNull(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

/** Pull `payload.workspace_projection` (Step-27) defensively. */
export function extractWorkspaceProjection(
  payload: unknown,
): WorkspaceProjectionEnvelope | null {
  const wp = obj(obj(payload).workspace_projection);
  if (!wp.projection || typeof wp.projection !== 'object') return null;
  const mode = str(wp.mode).toUpperCase();
  return {
    mode: mode === 'AUTHORITATIVE' ? 'AUTHORITATIVE' : mode === 'LEGACY' ? 'LEGACY' : 'SHADOW',
    fallback_active: Boolean(wp.fallback_active),
    projection: wp.projection as Record<string, unknown>,
    diff: (wp.diff && typeof wp.diff === 'object' ? wp.diff : null) as Record<string, unknown> | null,
  };
}

/** Map a canonical projection → the UI-facing authoritative view. */
export function toWorkspaceUIView(projection: Record<string, unknown>): WorkspaceUIView {
  const ai = obj(projection.ai_asset);
  const creator = obj(projection.creator_state);
  const upload = obj(projection.upload_state);
  const readiness = obj(projection.readiness_state);
  const scheduling = obj(projection.scheduling_state);
  const prov = obj(projection.provenance);
  const routing = obj(projection.routing_lineage);

  return {
    isCreatorActivity: Boolean(creator.is_creator_flow),
    isVideoFlow: Boolean(creator.is_video_flow),
    hasCreatorAsset: Boolean(upload.has_asset),
    uploadRequired: Boolean(upload.upload_required),
    uploadAssetState: str(upload.asset_state) || 'NONE',

    aiAssetState: str(ai.state) || 'NONE',
    aiAssetOrigin: strOrNull(ai.origin),
    aiPreviewUrl: strOrNull(ai.preview_url),
    aiPreviewPending: Boolean(ai.preview_pending),
    aiFallbackMode: Boolean(ai.fallback_mode),
    aiUploadOverrideAvailable: Boolean(ai.upload_override_available),

    readinessState: str(readiness.orchestration_state) || 'UNKNOWN',
    publishState: str(readiness.publish_state) || 'UNKNOWN',
    readinessScore: Number(readiness.readiness_score ?? 0),
    blockingReasons: Array.isArray(readiness.blocking_reasons)
      ? readiness.blocking_reasons.map(String)
      : [],
    schedulingState: str(scheduling.scheduling_state) || 'UNSCHEDULED',
    schedulable: Boolean(scheduling.schedulable),

    provenance: {
      generation_source: str(prov.generation_source) || 'LEGACY',
      generation_mode: str(prov.generation_mode) || 'UNKNOWN',
      fallback_active: Boolean(prov.fallback_active),
      rollback_triggered: Boolean(prov.rollback_triggered),
    },
    routingLineage: {
      execution_type: strOrNull(routing.execution_type),
      activity_type: strOrNull(routing.activity_type),
      workflow_type: strOrNull(routing.workflow_type),
      asset_requirement: strOrNull(routing.asset_requirement),
    },
  };
}
