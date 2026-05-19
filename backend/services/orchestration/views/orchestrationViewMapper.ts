/**
 * orchestrationViewMapper — Phase-2 Step-14.
 *
 * Pure-ish read composition of the canonical planner/calendar visibility
 * models from existing orchestration feeds (readiness, execution state,
 * generation context, authoritative decision, routing). READ-ONLY — no
 * mutation, no UI coupling.
 */

import { getUnifiedCampaignReadiness } from '../context';
import { getCampaignExecutionState, projectExecutionState } from '../synchronization';
import { getExecutionItems } from '../canonicalExecutionAdapter';
import { resolveExecutionRouting } from '../routing';
import {
  resolveGenerationExecutionContext,
  getAuthoritativeGenerationDecision,
  resolveCutoverMode,
} from '../generation';
import { deriveProvenanceFromContent, getCampaignProvenanceSummary } from '../provenance';
import { hydrateAiAsset } from '../assets';
import type { AIAssetProjection } from '../assets';

export interface PlannerExecutionView {
  campaign_id: string;
  readiness_summary: unknown;
  execution_summary: {
    total: number;
    ready: number;
    blocked: number;
    pending_assets: number;
    creator_flows: number;
    owned_content_flows: number;
  };
  strategy_visibility: {
    strategy_present: boolean;
    skeleton_present: boolean;
    generation_mode: string;
  };
  orchestration_visibility: {
    authoritative_available: boolean;
    fallback_active: boolean;
    rollback_active: boolean;
  };
  weekly_overview: unknown[];
  blockers: string[];
  /** Phase-2 Step-16: real provenance coverage (replaces heuristics). */
  provenance_summary: unknown;
  metadata: Record<string, unknown>;
}

export interface CalendarExecutionView {
  execution_id: string;
  activity_type: string;
  workflow_type: string;
  readiness_state: string;
  creator_state: string;
  scheduling_state: string;
  owned_content_state: string;
  platform: string;
  day_projection: { week_id: string; day: string };
  orchestration_flags: {
    blocked: boolean;
    pending_asset: boolean;
    approval_required: boolean;
    authoritative_generated: boolean;
  };
  /** Phase-2 Step-16: real provenance (no heuristic detection). */
  provenance: {
    generation_source: string;
    generation_mode: string;
    fallback_active: boolean;
    rollback_triggered: boolean;
  };
  /**
   * Phase-2 Step-20: per-execution AI-asset projection so the read-only
   * orchestration surface can render the real generated preview. null for
   * non-AI-creatable executions (video/manual → unchanged).
   */
  ai_asset: AIAssetProjection | null;
}

export async function buildPlannerExecutionView(
  campaignId: string,
): Promise<PlannerExecutionView> {
  const [readiness, campaignState, ctx, decision] = await Promise.all([
    getUnifiedCampaignReadiness(campaignId).catch(() => null),
    getCampaignExecutionState(campaignId).catch(() => null),
    resolveGenerationExecutionContext(campaignId, 'plannerView').catch(() => null),
    getAuthoritativeGenerationDecision(campaignId, 'plannerView').catch(() => null),
  ]);

  const items = await getExecutionItems(campaignId).catch(() => []);
  const projections = items.map(projectExecutionState);
  const execution_summary = {
    total: projections.length,
    ready: projections.filter((p) => p.orchestration_state === 'READY').length,
    blocked: projections.filter((p) => p.orchestration_state === 'BLOCKED').length,
    pending_assets: projections.filter((p) => p.asset_state === 'PENDING').length,
    creator_flows: projections.filter((p) => p.derived_flags.is_creator_flow).length,
    owned_content_flows: ctx ? ctx.owned_content_directives.length : 0,
  };

  const mode = resolveCutoverMode();
  const authoritative_available = Boolean(ctx && ctx.metadata.resolution_sources.length > 0);
  const rollback_active = Boolean(decision?.rollback_triggered);
  const fallback_active = mode !== 'AUTHORITATIVE' || !decision?.use_authoritative;
  const provenance_summary = await getCampaignProvenanceSummary(campaignId).catch(() => null);

  return {
    campaign_id: campaignId,
    readiness_summary: readiness,
    execution_summary,
    strategy_visibility: {
      strategy_present: Boolean(ctx?.unified.metadata.strategy_presence),
      skeleton_present: Boolean(ctx?.unified.metadata.skeleton_presence),
      generation_mode: ctx?.generation_mode ?? 'EMPTY',
    },
    orchestration_visibility: { authoritative_available, fallback_active, rollback_active },
    weekly_overview: campaignState?.weeks ?? [],
    blockers: readiness?.blocking_reasons ?? [],
    provenance_summary,
    metadata: {
      cutover_mode: mode,
      resolution_sources: ctx?.metadata.resolution_sources ?? [],
      flow_shape: ctx?.metadata.flow_shape ?? 'empty',
      generated_at: new Date().toISOString(),
    },
  };
}

export async function buildCalendarExecutionView(
  campaignId: string,
): Promise<CalendarExecutionView[]> {
  const items = await getExecutionItems(campaignId).catch(() => []);
  return items.map((it) => {
    const proj = projectExecutionState(it);
    const routing = resolveExecutionRouting({
      platform: it.platform,
      content_type: it.content_type,
      asset_type: String(it.metadata?.asset_type ?? '') || undefined,
      campaign_context: { campaign_id: campaignId, execution_id: it.execution_id },
    });
    // Phase-2 Step-16: real provenance (replaces the heuristic regex).
    const legacyRaw = it.metadata?.__legacy_raw && typeof it.metadata.__legacy_raw === 'object'
      ? (it.metadata.__legacy_raw as Record<string, unknown>) : null;
    const { provenance } = deriveProvenanceFromContent(it.execution_id, legacyRaw, {
      reconciledWithBlueprint: Boolean(it.metadata?.reconciled_with_blueprint),
    });
    // Step-20: hydrate the real AI-asset projection from the persisted
    // execution blob. Returns null for video/manual/text (untouched).
    const ai_asset = hydrateAiAsset({
      campaignId,
      executionId: it.execution_id,
      contentType: it.content_type,
      routing: { execution_type: routing.execution_type, workflow_type: routing.workflow_type, asset_requirement: routing.asset_requirement },
      blob: legacyRaw ?? {},
    });
    return {
      execution_id: it.execution_id,
      activity_type: routing.activity_type,
      workflow_type: routing.workflow_type,
      readiness_state: proj.orchestration_state,
      creator_state: proj.derived_flags.is_creator_flow ? proj.asset_state : 'NONE',
      scheduling_state: proj.scheduling_state,
      owned_content_state: routing.activity_type === 'OWNED_CONTENT' ? 'LINKED' : 'NONE',
      platform: it.platform,
      day_projection: { week_id: it.week_id, day: it.day_id },
      orchestration_flags: {
        blocked: proj.orchestration_state === 'BLOCKED',
        pending_asset: proj.asset_state === 'PENDING',
        approval_required: proj.derived_flags.requires_approval,
        authoritative_generated: provenance.generation_source !== 'LEGACY',
      },
      provenance: {
        generation_source: provenance.generation_source,
        generation_mode: provenance.generation_mode,
        fallback_active: provenance.fallback_active,
        rollback_triggered: provenance.rollback_triggered,
      },
      ai_asset,
    };
  });
}
