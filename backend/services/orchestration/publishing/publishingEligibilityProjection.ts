/**
 * publishingEligibilityProjection — Phase-2 Step-31.
 *
 * THE canonical CMS/scheduler projection. Pure, deterministic, no I/O.
 * Composes the already-canonical orchestration surfaces (execution state +
 * routing + AI-asset + provenance) into the single eligibility shape the
 * scheduler/CMS consume. NEVER re-derives readiness/upload/creator/schedule
 * inline — every field traces to an authoritative source.
 *
 * Video/manual: aiAsset is null upstream (hydrateAiAsset) so ai_asset
 * eligibility is NONE and creator/upload flow straight from the canonical
 * routing decision — the existing video/manual publish path is reflected,
 * never altered.
 */

import type { CanonicalExecutionItem } from '../../../types/orchestration/CanonicalExecutionItem';
import type { ExecutionStateProjection } from '../synchronization';
import type { AIAssetProjection } from '../assets';

export type PublishingMode = 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';

/** Canonical scheduler status — the ONLY vocabulary the scheduler needs. */
export type SchedulerStatus =
  | 'PUBLISH_READY'
  | 'AI_READY'
  | 'SCHEDULABLE'
  | 'WAITING_UPLOAD'
  | 'WAITING_APPROVAL'
  | 'WAITING_GENERATION'
  | 'BLOCKED';

export interface PublishingExecutionProjection {
  campaign_id: string;
  execution_id: string;
  platform: string;
  publishing_mode: PublishingMode;
  orchestration_version: string;

  readiness_state: string;
  publish_state: string;
  readiness_score: number;

  scheduler_status: SchedulerStatus;
  schedulable: boolean;
  blocked: boolean;
  blocking_reasons: string[];

  creator_eligibility: { is_creator_flow: boolean; is_video_flow: boolean; creator_requirement: string | null };
  upload_eligibility: { upload_required: boolean; has_asset: boolean; asset_state: string };
  ai_asset_eligibility: { state: string; ai_ready: boolean; preview_pending: boolean; fallback_mode: boolean };
  owned_content_eligibility: { is_owned_content: boolean; source_type: string | null };

  platform_payload_ready: boolean;

  provenance: {
    generation_source: string;
    generation_mode: string;
    fallback_active: boolean;
    rollback_triggered: boolean;
  };
  routing_lineage: {
    execution_type: string | null;
    activity_type: string | null;
    workflow_type: string | null;
    asset_requirement: string | null;
  };
}

function s(v: unknown): string | null {
  return v == null ? null : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Pure scheduler-status derivation from canonical signals ONLY. Order
 * matters: terminal/blocked first, then waiting gates, then ready tiers.
 */
function deriveSchedulerStatus(input: {
  state: ExecutionStateProjection;
  aiAsset: AIAssetProjection | null;
  requiresApproval: boolean;
  approved: boolean;
}): SchedulerStatus {
  const { state, aiAsset } = input;
  if (state.orchestration_state === 'BLOCKED' || state.blocking_reasons.length > 0) return 'BLOCKED';
  if (input.requiresApproval && !input.approved) return 'WAITING_APPROVAL';
  if (aiAsset && aiAsset.asset_state === 'GENERATION_FAILED') return 'WAITING_UPLOAD';
  if (aiAsset && aiAsset.generated_preview?.preview_pending) return 'WAITING_GENERATION';
  if (
    state.derived_flags?.requires_asset &&
    !state.derived_flags?.has_asset &&
    !(aiAsset && (aiAsset.asset_state === 'AI_GENERATED' || aiAsset.asset_state === 'AI_READY'))
  ) {
    return 'WAITING_UPLOAD';
  }
  if (state.publish_state === 'READY') return 'PUBLISH_READY';
  if (aiAsset && (aiAsset.asset_state === 'AI_GENERATED' || aiAsset.asset_state === 'AI_READY')) return 'AI_READY';
  if (state.scheduling_state === 'READY' || state.scheduling_state === 'SCHEDULED') return 'SCHEDULABLE';
  return 'WAITING_GENERATION';
}

export function buildPublishingExecutionProjection(input: {
  campaignId: string;
  executionId: string;
  platform: string;
  mode: PublishingMode;
  orchestrationVersion: string;
  item: CanonicalExecutionItem;
  routing: unknown;
  state: ExecutionStateProjection;
  aiAsset: AIAssetProjection | null;
  provenance: unknown;
  legacyRaw: Record<string, unknown>;
}): PublishingExecutionProjection {
  const { item, state, aiAsset, legacyRaw } = input;
  const routing = obj(input.routing);
  const provenance = obj(input.provenance);

  const requiresApproval = Boolean(state.derived_flags?.requires_approval);
  const approved = String(legacyRaw.approval_status ?? '').toLowerCase() === 'approved';
  const scheduler_status = deriveSchedulerStatus({ state, aiAsset, requiresApproval, approved });

  const ai_state = aiAsset ? aiAsset.asset_state : 'NONE';
  const ai_ready =
    !!aiAsset && (aiAsset.asset_state === 'AI_GENERATED' || aiAsset.asset_state === 'AI_READY');
  const is_owned = s(routing.activity_type) === 'OWNED_CONTENT';

  return {
    campaign_id: input.campaignId,
    execution_id: input.executionId,
    platform: String(input.platform || item.platform || 'linkedin').toLowerCase(),
    publishing_mode: input.mode,
    orchestration_version: input.orchestrationVersion,

    readiness_state: state.orchestration_state,
    publish_state: state.publish_state,
    readiness_score: state.readiness_score,

    scheduler_status,
    schedulable: scheduler_status === 'PUBLISH_READY' || scheduler_status === 'SCHEDULABLE' || scheduler_status === 'AI_READY',
    blocked: scheduler_status === 'BLOCKED',
    blocking_reasons: Array.isArray(state.blocking_reasons) ? state.blocking_reasons : [],

    creator_eligibility: {
      is_creator_flow: Boolean(state.derived_flags?.is_creator_flow),
      is_video_flow: Boolean(state.derived_flags?.is_video_flow),
      creator_requirement: s(routing.creator_requirement),
    },
    upload_eligibility: {
      upload_required:
        Boolean(state.derived_flags?.requires_asset) &&
        !state.derived_flags?.has_asset &&
        !ai_ready,
      has_asset: Boolean(state.derived_flags?.has_asset),
      asset_state: state.asset_state,
    },
    ai_asset_eligibility: {
      state: ai_state,
      ai_ready,
      preview_pending: Boolean(aiAsset?.generated_preview?.preview_pending),
      fallback_mode: Boolean(aiAsset?.fallback_mode),
    },
    owned_content_eligibility: {
      is_owned_content: is_owned,
      source_type: is_owned
        ? s((obj(legacyRaw.owned_content)).source_type) ?? 'linked'
        : null,
    },

    // Platform-payload READINESS (not adapter rewrite): true when content
    // is ready and the asset gate is satisfied (uploaded OR AI-ready OR
    // not required). CMS adapters consume this as the canonical gate.
    platform_payload_ready:
      state.content_state === 'READY' &&
      (!state.derived_flags?.requires_asset || Boolean(state.derived_flags?.has_asset) || ai_ready) &&
      scheduler_status !== 'BLOCKED',

    provenance: {
      generation_source: String(provenance.generation_source ?? 'LEGACY'),
      generation_mode: String(provenance.generation_mode ?? 'UNKNOWN'),
      fallback_active: Boolean(provenance.fallback_active),
      rollback_triggered: Boolean(provenance.rollback_triggered),
    },
    routing_lineage: {
      execution_type: s(routing.execution_type),
      activity_type: s(routing.activity_type),
      workflow_type: s(routing.workflow_type),
      asset_requirement: s(routing.asset_requirement),
    },
  };
}
