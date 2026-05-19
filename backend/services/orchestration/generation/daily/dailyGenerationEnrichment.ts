/**
 * dailyGenerationEnrichment — Phase-2 Step-13.
 *
 * Adds daily enrichment parity (platform adaptation, hook/CTA/storytelling,
 * creator guidance, orchestration/readiness/execution confidence) onto the
 * authoritative daily cards. Deterministic, derived from context — reuses
 * the Step-12 weekly enrichment primitives (no duplication).
 */

import type { GenerationExecutionContext } from '../generationExecutionContextTypes';
import type { AuthoritativeDailyCard } from './dailyGenerationMapper';

export interface DailyEnrichmentScores {
  enrichment_score: number;
  creator_projection_score: number;
  readiness_confidence: number;
  platform_adaptation_score: number;
}

export function enrichDailyCards(
  cards: AuthoritativeDailyCard[],
  ctx: GenerationExecutionContext,
): { cards: AuthoritativeDailyCard[]; scores: DailyEnrichmentScores } {
  const objective = String(ctx.unified.strategy_context.objective ?? '');
  const owned = ctx.owned_content_directives.map((d) => `${d.source_type}:${d.directive}`);
  const readinessConfidence = ctx.readiness.ready ? 100 : Math.max(0, ctx.readiness.readiness_score);
  const platformScores: number[] = [];
  const creatorScores: number[] = [];

  const enriched = cards.map((card) => {
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(card.content) || {}; } catch { blob = {}; }
    const pe = (blob.platform_enrichment as { score?: number }) ?? {};
    const cm = (blob.creator_metadata as { score?: number } | null) ?? null;
    platformScores.push(Number(pe.score) || 0);
    if (cm) creatorScores.push(Number(cm.score) || 0);

    const enrichedBlob = {
      ...blob,
      daily_enrichment: {
        platform_adaptation: (blob.platform_enrichment as { formatting_rules?: unknown })?.formatting_rules ?? null,
        hook_guidance: `Lead with the sharpest angle of "${card.title}"`,
        cta_guidance: 'Drive the next concrete step for the reader',
        storytelling_guidance: objective || card.title,
        creator_guidance: cm ? 'Follow the creator workspace projection for production' : 'Text-led, platform-native',
        owned_content_reuse: owned,
        execution_confidence: Math.round(((Number(pe.score) || 0) + (cm ? Number(cm.score) || 0 : 100)) / 2),
        orchestration_confidence: ctx.readiness.readiness_score,
        readiness_confidence: readinessConfidence,
      },
    };
    return { ...card, content: JSON.stringify(enrichedBlob) };
  });

  const avg = (ns: number[]) => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0);
  const platform_adaptation_score = avg(platformScores);
  const creator_projection_score = creatorScores.length ? avg(creatorScores) : 100;
  const enrichment_score = Math.round(
    platform_adaptation_score * 0.45 + creator_projection_score * 0.3 + readinessConfidence * 0.25,
  );
  return {
    cards: enriched,
    scores: { enrichment_score, creator_projection_score, readiness_confidence: readinessConfidence, platform_adaptation_score },
  };
}
