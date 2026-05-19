/**
 * dailyExecutionEnrichment — Phase-2 Step-17 orchestrator.
 *
 * Brings daily execution cards to fidelity parity: AI-asset-ready semantics,
 * creator visibility, workflow visibility, corrected orchestration counts,
 * and guidance enrichment. Derived from the centralized routing decision +
 * context. Never mutates legacy; pure transform over the authoritative cards.
 */

import type { GenerationExecutionContext } from '../../generationExecutionContextTypes';
import type { AuthoritativeDailyCard } from '../dailyGenerationMapper';
import { projectDailyAsset } from './dailyAssetProjection';
import { projectDailyCreator } from './dailyCreatorProjection';
import { projectDailyVisibility, correctedReadinessCounts } from './dailyVisibilityProjection';
import { dailyEnrichmentDiagnostics } from './dailyEnrichmentDiagnostics';
import { hydrateAiAsset } from '../../../assets';

export interface DailyParityResult {
  cards: AuthoritativeDailyCard[];
  corrected_counts: { blocked: number; pending_upload: number; ai_ready: number; reclassified: number };
  workflow_distribution: Record<string, number>;
}

export function enrichDailyExecutionParity(
  cards: AuthoritativeDailyCard[],
  ctx: GenerationExecutionContext,
): DailyParityResult {
  const objective = String(ctx.unified.strategy_context.objective ?? '');
  const readinessScore = ctx.readiness.readiness_score;
  const workflow_distribution: Record<string, number> = {};
  const perCard: Array<{ visibility: ReturnType<typeof projectDailyVisibility>; asset: ReturnType<typeof projectDailyAsset> }> = [];

  const out = cards.map((card) => {
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(card.content) || {}; } catch { blob = {}; }
    const routing = (blob.routing_metadata as Record<string, unknown>) ?? null;
    const title = String(blob.title ?? card.title ?? '');

    const asset = projectDailyAsset(routing as any, { has_uploaded_asset: false });
    // Phase-2 Step-18: real AI-asset hydration record (video/manual/text →
    // hydrator returns null → unchanged).
    const aiAsset = hydrateAiAsset({
      campaignId: ctx.campaign_id,
      executionId: card.execution_id,
      contentType: card.content_type,
      routing: routing as any,
      blob,
    });
    const creator = projectDailyCreator(card.content_type, routing as any, objective || title, title, asset);
    const approval_required = Boolean((blob.readiness_metadata as { directive?: string } | null)?.directive === 'approval_gated');
    const scheduling_ready = !asset.upload_required;
    const visibility = projectDailyVisibility({
      activity_type: card.activity_type,
      routing: routing as any,
      asset,
      approval_required,
      scheduling_ready,
    });
    perCard.push({ visibility, asset });
    workflow_distribution[visibility.workflow_mode] = (workflow_distribution[visibility.workflow_mode] ?? 0) + 1;

    if (asset.asset_state === 'AI_READY') {
      dailyEnrichmentDiagnostics.aiReady({ campaign_id: ctx.campaign_id, execution_id: card.execution_id, content_type: card.content_type, asset_origin: asset.asset_origin });
    }
    if (visibility.creator_workflow) {
      dailyEnrichmentDiagnostics.creatorVisible({ campaign_id: ctx.campaign_id, execution_id: card.execution_id, asset_family: creator?.asset_family ?? null });
    }
    if (asset.upload_override_available) {
      dailyEnrichmentDiagnostics.assetOverride({ campaign_id: ctx.campaign_id, execution_id: card.execution_id, asset_state: asset.asset_state });
    }
    dailyEnrichmentDiagnostics.workflowMode({ campaign_id: ctx.campaign_id, execution_id: card.execution_id, workflow_type: visibility.workflow_mode, activity_type: card.activity_type });

    const enrichedBlob = {
      ...blob,
      asset_projection: asset,
      ...(aiAsset ? { ai_asset: aiAsset } : {}),
      creator_projection: creator,
      workflow_visibility: visibility,
      daily_guidance: {
        hook_guidance: `Lead with the sharpest angle of "${title}"`,
        cta_guidance: 'Drive the next concrete reader step',
        creator_guidance: creator?.creator_guidance ?? 'Text-led, platform-native',
        visual_guidance: asset.asset_state === 'AI_READY' ? 'AI-generated visual attached; review & adapt' : 'platform-appropriate visual',
        platform_adaptation: (blob.platform_enrichment as { formatting_rules?: unknown })?.formatting_rules ?? null,
        orchestration_confidence: readinessScore,
        readiness_confidence: ctx.readiness.ready ? 100 : Math.max(0, readinessScore),
      },
      // corrected, AI-aware execution state surfaced for downstream/UI.
      execution_state_corrected: {
        asset_state: aiAsset ? aiAsset.asset_state : asset.asset_state,
        upload_required: aiAsset ? aiAsset.fallback_mode === true : asset.upload_required,
        ai_ready: aiAsset
          ? aiAsset.asset_state === 'AI_GENERATED' || aiAsset.asset_state === 'AI_READY'
          : asset.asset_state === 'AI_READY',
        preview_available: aiAsset?.generated_preview?.preview_pending === false,
        asset_origin: aiAsset?.asset_origin ?? null,
      },
    };
    return { ...card, content: JSON.stringify(enrichedBlob) };
  });

  const corrected_counts = correctedReadinessCounts(perCard);
  if (corrected_counts.reclassified > 0) {
    dailyEnrichmentDiagnostics.counterReclassify({
      campaign_id: ctx.campaign_id,
      reclassified: corrected_counts.reclassified,
      ai_ready: corrected_counts.ai_ready,
      blocked: corrected_counts.blocked,
      pending_upload: corrected_counts.pending_upload,
    });
  }
  dailyEnrichmentDiagnostics.enrichment({
    campaign_id: ctx.campaign_id,
    cards: out.length,
    workflow_distribution,
    ai_ready: corrected_counts.ai_ready,
  });

  return { cards: out, corrected_counts, workflow_distribution };
}
