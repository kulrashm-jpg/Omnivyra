/**
 * weeklyGenerationMapper — Phase-2 Step-11.
 *
 * Pure: GenerationExecutionContext → authoritative weekly row plan.
 * Consumes ONLY the context (routes / unified strategy+skeleton / readiness
 * directives / owned-content directives). NO blueprint parsing, NO
 * planning_context parsing, NO inline strategy/platform/routing/readiness
 * extraction — those decisions already live in the context.
 */

import type { GenerationExecutionContext } from '../generationExecutionContextTypes';
import { buildAuthoritativeProvenance } from '../../provenance/provenanceMapper';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface AuthoritativeWeeklyRow {
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  platform: string;
  content_type: string;
  title: string;
  topic: string;
  content: string; // JSON
  status: string;
  ai_generated: boolean;
  execution_id: string;
}

export interface AuthoritativeWeeklyPlan {
  rows: AuthoritativeWeeklyRow[];
  weeks: number[];
  platform_distribution: Record<string, number>;
  routing_distribution: Record<string, number>;
  readiness_distribution: Record<string, number>;
  owned_content_usage: string[];
}

function themeForWeek(ctx: GenerationExecutionContext, week: number): Record<string, unknown> {
  const themes = (ctx.unified.strategy_context.themes ?? []) as Array<Record<string, unknown>>;
  return themes.find((t) => Number(t.week) === week) ?? {};
}

/**
 * Build the weekly structure from the context's per-slot routes. Routes are
 * mode-agnostic (Step-6 already converged strategy-first vs skeleton-first),
 * so this is order-independent by construction.
 */
export function mapContextToWeeklyPlan(
  ctx: GenerationExecutionContext,
): AuthoritativeWeeklyPlan {
  const platform_distribution: Record<string, number> = {};
  const routing_distribution: Record<string, number> = {};
  const readiness_distribution: Record<string, number> = {};
  const weeksSet = new Set<number>();
  const rows: AuthoritativeWeeklyRow[] = [];

  const directiveTag = ctx.readiness_directives.includes('pending_upload_workflow')
    ? 'pending_upload'
    : ctx.readiness_directives.includes('approval_gated')
      ? 'approval_gated'
      : ctx.readiness_directives.includes('restrict_scope')
        ? 'restricted'
        : ctx.readiness_directives.includes('minimal_skeleton_safe')
          ? 'minimal_safe'
          : 'proceed';

  const ownedByType = ctx.owned_content_directives.map((d) => `${d.source_type}:${d.directive}`);

  ctx.routes.forEach((r, i) => {
    const week = Number(String(r.week_id).replace(/^wk/, '')) || 1;
    weeksSet.add(week);
    const platform = String(r.platform || 'linkedin').toLowerCase();
    const content_type = String(r.content_type || 'post').toLowerCase();
    platform_distribution[platform] = (platform_distribution[platform] ?? 0) + 1;
    routing_distribution[r.routing.execution_type] =
      (routing_distribution[r.routing.execution_type] ?? 0) + 1;
    readiness_distribution[directiveTag] = (readiness_distribution[directiveTag] ?? 0) + 1;

    const theme = themeForWeek(ctx, week);
    const title =
      String(theme.title ?? '') ||
      String((ctx.unified.strategy_context.objective ?? '') || `Week ${week} content ${i + 1}`);
    const objective = String(theme.objective ?? ctx.unified.strategy_context.objective ?? title);
    const audience = (() => {
      const a = ctx.unified.strategy_context.audiences?.[0];
      if (a && typeof a === 'object' && 'primary' in (a as object)) return String((a as any).primary || 'the target audience');
      return String(a ?? 'the target audience');
    })();

    // Workflow gating from readiness/routing — NO inline creator/text/video
    // branching; the routing decision is consumed verbatim.
    const requiresAsset = r.routing.asset_requirement === 'REQUIRED';
    const isVideoBrief = r.routing.execution_type === 'VIDEO_WORKFLOW';
    const content_status =
      isVideoBrief || (requiresAsset && r.routing.workflow_type === 'MANUAL_UPLOAD')
        ? 'guidance_ready'
        : null;

    const contentBlob = {
      generation_source: 'authoritative_weekly',
      execution_id: r.execution_id ?? `wk${week}-${platform}-${content_type}-${i}`,
      platform,
      content_type,
      title,
      topic: title,
      objective,
      dailyObjective: objective,
      target_audience: audience,
      whatProblemAreWeAddressing: `Key challenge ${audience} faces re: "${title}".`,
      whatShouldReaderLearn: `${audience} should understand "${title}" and why it matters now.`,
      desiredAction: 'Encourage the next relevant step',
      intent: {
        objective,
        pain_point: `Key challenge ${audience} faces re: "${title}".`,
        outcome_promise: `${audience} should understand "${title}".`,
        cta_type: 'Encourage the next relevant step',
        target_audience: audience,
        brief_summary: objective,
      },
      writer_content_brief: {
        topicTitle: title,
        title,
        tone: 'Clear, helpful, on-brand',
        intent_type: 'educational',
        core_message: objective,
        writingIntent: objective,
        whatShouldReaderLearn: `${audience} should understand "${title}".`,
        whatProblemAreWeAddressing: `Key challenge ${audience} faces re: "${title}".`,
        desiredAction: 'Encourage the next relevant step',
        narrativeStyle: '',
        topicGoal: objective,
      },
      // orchestration provenance
      routing_decision: {
        execution_type: r.routing.execution_type,
        workflow_type: r.routing.workflow_type,
        asset_requirement: r.routing.asset_requirement,
        creator_requirement: r.routing.creator_requirement,
      },
      readiness_workflow: directiveTag,
      owned_content_workflows: ownedByType,
      // Phase-2 Step-16: TRUE execution provenance (no heuristic detection).
      provenance: buildAuthoritativeProvenance({
        execution_id: r.execution_id ?? `wk${week}-${platform}-${content_type}-${i}`,
        stage: 'WEEKLY',
        generation_mode: ctx.generation_mode,
        authoritative_confidence: ctx.readiness?.readiness_score ?? 0,
        lineage: {
          originating_strategy_id: ctx.unified.strategy_context.strategy_id,
          originating_week_id: `wk${week}`,
          originating_theme: title,
        },
        metadata: { resolution_sources: ctx.metadata.resolution_sources },
      }),
      ...(content_status ? { content_status } : {}),
    };

    rows.push({
      campaign_id: ctx.campaign_id,
      week_number: week,
      day_of_week: DAYS[i % 7],
      platform,
      content_type,
      title,
      topic: title,
      content: JSON.stringify(contentBlob),
      status: 'planned',
      ai_generated: false,
      execution_id: contentBlob.execution_id,
    });
  });

  return {
    rows,
    weeks: [...weeksSet].sort((a, b) => a - b),
    platform_distribution,
    routing_distribution,
    readiness_distribution,
    owned_content_usage: ownedByType,
  };
}
