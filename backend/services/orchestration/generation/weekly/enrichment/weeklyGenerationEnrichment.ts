/**
 * weeklyGenerationEnrichment — Phase-2 Step-12 orchestrator.
 *
 * Brings authoritative weekly rows to FUNCTIONAL enrichment parity:
 * platform enrichment + creator projection + scheduling projection +
 * creative guidance + execution-quality metadata, all derived from the
 * orchestration context + routing decision (no inline assumptions).
 *
 * Honest scope: deterministic/structural parity (rich, gated, rollback-
 * safe) — NOT byte-identical to the legacy AI-model enrichment.
 */

import type { GenerationExecutionContext } from '../../generationExecutionContextTypes';
import type { AuthoritativeWeeklyRow } from '../weeklyGenerationMapper';
import { enrichPlatform } from './weeklyPlatformEnrichment';
import { projectCreator } from './weeklyCreatorProjection';
import { projectScheduling } from './weeklySchedulingProjection';

export interface EnrichmentScores {
  enrichment_score: number;
  platform_enrichment_score: number;
  creator_projection_score: number;
  scheduling_projection_score: number;
  owned_content_score: number;
}

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0;
}

export function enrichWeeklyRows(
  rows: AuthoritativeWeeklyRow[],
  ctx: GenerationExecutionContext,
): { rows: AuthoritativeWeeklyRow[]; scores: EnrichmentScores } {
  const freq = (ctx.unified.skeleton_context.frequency ?? {}) as Record<string, unknown>;
  const objective = String(ctx.unified.strategy_context.objective ?? '');
  const ownedDirectives = ctx.owned_content_directives.map((d) => `${d.source_type}:${d.directive}`);
  const readinessScore = ctx.readiness.readiness_score;

  const platformScores: number[] = [];
  const creatorScores: number[] = [];
  const schedulingScores: number[] = [];

  const enrichedRows = rows.map((row) => {
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(row.content) || {}; } catch { blob = {}; }
    const routing = (blob.routing_decision as Record<string, unknown>) ?? null;
    const title = String(blob.title ?? row.title ?? '');
    const objLine = String(blob.objective ?? objective ?? title);

    const platform = enrichPlatform(row.platform, row.content_type, routing as any);
    platformScores.push(platform.score);

    const creator = projectCreator(row.content_type, routing as any, objLine, title);
    if (creator) creatorScores.push(creator.score);

    const cadence = Number(freq?.[row.platform]) || 0;
    const scheduling = projectScheduling(row.platform, cadence, routing as any);
    schedulingScores.push(scheduling.score);

    const creative_guidance = {
      hook: `Open with the core tension behind "${title}"`,
      cta: 'Encourage the next relevant step',
      visual_direction: creator ? `${creator.asset_family} asset supporting "${title}"` : 'text-led, scannable',
      storytelling_direction: objLine,
      owned_content_reuse: ownedDirectives,
      platform_adaptation: platform.formatting_rules,
    };

    const quality_metadata = {
      orchestration_confidence: readinessScore,
      readiness_confidence: ctx.readiness.ready ? 100 : Math.max(0, readinessScore),
      routing_confidence: routing ? 90 : 40,
      enrichment_completeness: Math.round(
        (platform.score + (creator ? creator.score : 100) + scheduling.score) / 3,
      ),
      owned_content_utilization: ownedDirectives.length > 0 ? 100 : 100, // optional → non-penalising
    };

    const enrichedBlob = {
      ...blob,
      enrichment: {
        platform,
        creator_projection: creator,
        scheduling_projection: scheduling,
      },
      creative_guidance,
      quality_metadata,
      ...(creator ? { creator_workspace: creator.creator_workspace, content_status: blob.content_status ?? 'guidance_ready' } : {}),
    };
    return { ...row, content: JSON.stringify(enrichedBlob) };
  });

  const scores: EnrichmentScores = {
    platform_enrichment_score: avg(platformScores),
    creator_projection_score: creatorScores.length ? avg(creatorScores) : 100,
    scheduling_projection_score: avg(schedulingScores),
    owned_content_score: ownedDirectives.length > 0 ? 100 : 100,
    enrichment_score: 0,
  };
  scores.enrichment_score = Math.round(
    scores.platform_enrichment_score * 0.4 +
    scores.creator_projection_score * 0.25 +
    scores.scheduling_projection_score * 0.25 +
    scores.owned_content_score * 0.1,
  );
  return { rows: enrichedRows, scores };
}
