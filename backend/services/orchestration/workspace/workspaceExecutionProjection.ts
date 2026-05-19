/**
 * workspaceExecutionProjection — Phase-2 Step-27.
 *
 * THE canonical workspace projection. Pure, deterministic, no I/O. Composes
 * the already-canonical orchestration surfaces (execution state projection +
 * routing decision + AI-asset hydration + provenance) into the single shape
 * an execution workspace consumes. It NEVER re-derives readiness / upload /
 * creator / routing inline — every field traces to an authoritative source.
 *
 * Video/manual: aiAsset is null upstream (hydrateAiAsset) so ai_asset.state
 * is NONE and creator/upload state flow straight from the canonical routing
 * decision — i.e. the existing video/manual workflow is reflected, never
 * altered.
 */

import type { CanonicalExecutionItem } from '../../../types/orchestration/CanonicalExecutionItem';
import type { ExecutionStateProjection } from '../synchronization';
import type { AIAssetProjection } from '../assets';

export type WorkspaceMode = 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';

export interface WorkspaceExecutionProjection {
  campaign_id: string;
  execution_id: string;
  workspace_mode: WorkspaceMode;
  orchestration_version: string;

  provenance: {
    generation_source: string;
    generation_mode: string;
    fallback_active: boolean;
    rollback_triggered: boolean;
  };

  ai_asset: {
    state: string;            // AI_GENERATED | USER_UPLOADED | USER_REPLACED | USER_REMOVED | GENERATION_FAILED | NONE
    origin: string | null;
    preview_url: string | null;
    preview_pending: boolean;
    fallback_mode: boolean;
    upload_override_available: boolean;
  };

  creator_state: {
    is_creator_flow: boolean;
    is_video_flow: boolean;
    creator_requirement: string | null;
    workflow_type: string | null;
    lifecycle_state: string | null;
  };

  upload_state: {
    upload_required: boolean;
    has_asset: boolean;
    asset_state: string;      // canonical ExecutionStateProjection.asset_state
  };

  readiness_state: {
    orchestration_state: string;
    publish_state: string;
    readiness_score: number;
    blocking_reasons: string[];
  };

  scheduling_state: {
    scheduling_state: string;
    schedulable: boolean;
  };

  routing_lineage: {
    execution_type: string | null;
    activity_type: string | null;
    workflow_type: string | null;
    asset_requirement: string | null;
  };

  owned_content_lineage: {
    is_owned_content: boolean;
    source_type: string | null;
  };
}

function s(v: unknown): string | null {
  return v == null ? null : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function buildWorkspaceExecutionProjection(input: {
  campaignId: string;
  executionId: string;
  mode: WorkspaceMode;
  orchestrationVersion: string;
  item: CanonicalExecutionItem;
  routing: unknown;
  state: ExecutionStateProjection;
  aiAsset: AIAssetProjection | null;
  provenance: unknown;
  legacyRaw: Record<string, unknown>;
}): WorkspaceExecutionProjection {
  const { item, state, aiAsset, legacyRaw } = input;
  // Read the canonical routing/provenance surfaces structurally (no
  // coupling to their exact exported types; we still consume ONLY them).
  const routing = obj(input.routing);
  const provenance = obj(input.provenance);

  const ai_state = aiAsset
    ? aiAsset.asset_state
    : (state.asset_state === 'NONE' ? 'NONE' : 'NONE');

  const ownedSource =
    s(routing.activity_type) === 'OWNED_CONTENT'
      ? s((legacyRaw.owned_content as { source_type?: unknown } | undefined)?.source_type) ?? 'linked'
      : null;

  return {
    campaign_id: input.campaignId,
    execution_id: input.executionId,
    workspace_mode: input.mode,
    orchestration_version: input.orchestrationVersion,

    provenance: {
      generation_source: String(provenance.generation_source ?? 'LEGACY'),
      generation_mode: String(provenance.generation_mode ?? 'UNKNOWN'),
      fallback_active: Boolean(provenance.fallback_active),
      rollback_triggered: Boolean(provenance.rollback_triggered),
    },

    ai_asset: {
      state: ai_state,
      origin: aiAsset?.asset_origin ?? null,
      preview_url: aiAsset?.generated_preview?.preview_url ?? null,
      preview_pending: Boolean(aiAsset?.generated_preview?.preview_pending),
      fallback_mode: Boolean(aiAsset?.fallback_mode),
      upload_override_available: Boolean(aiAsset?.upload_override_available),
    },

    creator_state: {
      is_creator_flow: Boolean(state.derived_flags?.is_creator_flow),
      is_video_flow: Boolean(state.derived_flags?.is_video_flow),
      creator_requirement: s(routing.creator_requirement),
      workflow_type: s(routing.workflow_type),
      lifecycle_state: s(item.creator_lifecycle_state),
    },

    upload_state: {
      upload_required:
        Boolean(state.derived_flags?.requires_asset) &&
        !state.derived_flags?.has_asset &&
        ai_state !== 'AI_GENERATED',
      has_asset: Boolean(state.derived_flags?.has_asset),
      asset_state: state.asset_state,
    },

    readiness_state: {
      orchestration_state: state.orchestration_state,
      publish_state: state.publish_state,
      readiness_score: state.readiness_score,
      blocking_reasons: Array.isArray(state.blocking_reasons) ? state.blocking_reasons : [],
    },

    scheduling_state: {
      scheduling_state: state.scheduling_state,
      schedulable: state.scheduling_state === 'READY' || state.scheduling_state === 'SCHEDULED',
    },

    routing_lineage: {
      execution_type: s(routing.execution_type),
      activity_type: s(routing.activity_type),
      workflow_type: s(routing.workflow_type),
      asset_requirement: s(routing.asset_requirement),
    },

    owned_content_lineage: {
      is_owned_content: s(routing.activity_type) === 'OWNED_CONTENT',
      source_type: ownedSource,
    },
  };
}
