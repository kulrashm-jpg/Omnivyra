/**
 * dailyGenerationMapper — Phase-2 Step-13.
 *
 * Pure: GenerationExecutionContext → day-addressable authoritative daily
 * execution cards. Decomposes the (already-converged) context routes into
 * per-day cards carrying activity-type + routing + creator + readiness +
 * owned-content + scheduling metadata. Consumes ONLY the context (no
 * blueprint / planning_context / inline strategy/routing/platform parsing).
 */

import type { GenerationExecutionContext } from '../generationExecutionContextTypes';
import { enrichPlatform } from '../weekly/enrichment/weeklyPlatformEnrichment';
import { projectCreator } from '../weekly/enrichment/weeklyCreatorProjection';
import { projectScheduling } from '../weekly/enrichment/weeklySchedulingProjection';
import { buildAuthoritativeProvenance } from '../../provenance/provenanceMapper';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface AuthoritativeDailyCard {
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  platform: string;
  content_type: string;
  activity_type: string;
  title: string;
  topic: string;
  content: string; // JSON
  status: string;
  ai_generated: boolean;
  execution_id: string;
}

export interface AuthoritativeDailyPlan {
  cards: AuthoritativeDailyCard[];
  execution_count: number;
  activity_distribution: Record<string, number>;
  routing_distribution: Record<string, number>;
  readiness_distribution: Record<string, number>;
  creator_distribution: Record<string, number>;
  owned_content_usage: string[];
}

function themeForWeek(ctx: GenerationExecutionContext, week: number): Record<string, unknown> {
  const themes = (ctx.unified.strategy_context.themes ?? []) as Array<Record<string, unknown>>;
  return themes.find((t) => Number(t.week) === week) ?? {};
}

export function mapContextToDailyPlan(ctx: GenerationExecutionContext): AuthoritativeDailyPlan {
  const activity_distribution: Record<string, number> = {};
  const routing_distribution: Record<string, number> = {};
  const readiness_distribution: Record<string, number> = {};
  const creator_distribution: Record<string, number> = {};
  const freq = (ctx.unified.skeleton_context.frequency ?? {}) as Record<string, unknown>;
  const ownedByType = ctx.owned_content_directives.map((d) => `${d.source_type}:${d.directive}`);

  const readinessTag = ctx.readiness_directives.includes('pending_upload_workflow')
    ? 'pending_upload'
    : ctx.readiness_directives.includes('approval_gated')
      ? 'approval_gated'
      : ctx.readiness_directives.includes('restrict_scope')
        ? 'restricted'
        : ctx.readiness_directives.includes('minimal_skeleton_safe')
          ? 'minimal_safe'
          : 'proceed';

  const cards: AuthoritativeDailyCard[] = ctx.routes.map((r, i) => {
    const week = Number(String(r.week_id).replace(/^wk/, '')) || 1;
    const platform = String(r.platform || 'linkedin').toLowerCase();
    const content_type = String(r.content_type || 'post').toLowerCase();
    const activity_type = String(r.routing.activity_type || 'TEXT_ONLY');
    const day = DAYS[i % 7];

    activity_distribution[activity_type] = (activity_distribution[activity_type] ?? 0) + 1;
    routing_distribution[r.routing.execution_type] = (routing_distribution[r.routing.execution_type] ?? 0) + 1;
    readiness_distribution[readinessTag] = (readiness_distribution[readinessTag] ?? 0) + 1;

    const theme = themeForWeek(ctx, week);
    const title = String(theme.title ?? ctx.unified.strategy_context.objective ?? `Week ${week} ${day} ${i + 1}`);
    const objective = String(theme.objective ?? ctx.unified.strategy_context.objective ?? title);

    const platformEnr = enrichPlatform(platform, content_type, r.routing);
    const creator = projectCreator(content_type, r.routing, objective, title);
    if (creator) creator_distribution[creator.asset_family] = (creator_distribution[creator.asset_family] ?? 0) + 1;
    const cadence = Number(freq?.[platform]) || 0;
    const scheduling = projectScheduling(platform, cadence, r.routing);

    const blob = {
      generation_source: 'authoritative_daily',
      execution_id: r.execution_id ?? `wk${week}-${platform}-${content_type}-${i}`,
      platform,
      content_type,
      activity_type,
      title,
      topic: title,
      objective,
      routing_metadata: {
        execution_type: r.routing.execution_type,
        workflow_type: r.routing.workflow_type,
        asset_requirement: r.routing.asset_requirement,
        creator_requirement: r.routing.creator_requirement,
      },
      creator_metadata: creator,
      readiness_metadata: { directive: readinessTag, readiness_score: ctx.readiness.readiness_score, blocking_reasons: ctx.readiness.blocking_reasons },
      orchestration_metadata: { generation_mode: ctx.generation_mode, resolution_sources: ctx.metadata.resolution_sources },
      scheduling_metadata: scheduling,
      owned_content_linkage: ownedByType,
      platform_enrichment: platformEnr,
      // Phase-2 Step-16: TRUE execution provenance (no heuristic detection).
      provenance: buildAuthoritativeProvenance({
        execution_id: r.execution_id ?? `wk${week}-${platform}-${content_type}-${i}`,
        stage: 'DAILY',
        generation_mode: ctx.generation_mode,
        authoritative_confidence: ctx.readiness?.readiness_score ?? 0,
        lineage: {
          originating_strategy_id: ctx.unified.strategy_context.strategy_id,
          originating_week_id: `wk${week}`,
          originating_theme: title,
        },
        metadata: { resolution_sources: ctx.metadata.resolution_sources },
      }),
      ...(creator ? { creator_workspace: creator.creator_workspace, content_status: 'guidance_ready' } : {}),
    };

    return {
      campaign_id: ctx.campaign_id,
      week_number: week,
      day_of_week: day,
      platform,
      content_type,
      activity_type,
      title,
      topic: title,
      content: JSON.stringify(blob),
      status: 'planned',
      ai_generated: false,
      execution_id: blob.execution_id,
    };
  });

  return {
    cards,
    execution_count: cards.length,
    activity_distribution,
    routing_distribution,
    readiness_distribution,
    creator_distribution,
    owned_content_usage: ownedByType,
  };
}
