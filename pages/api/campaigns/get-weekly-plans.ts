import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { detectExecutionDrift, type PublishedContent } from '../../../backend/services/executionDriftDetector';
import type { WeekPlanLike } from '../../../backend/services/executionMomentumTracker';
import { computeExecutionHealthScore } from '../../../backend/services/executionHealthScorer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId: campaignIdQuery, raw } = req.query;
    const campaignId = typeof campaignIdQuery === 'string' ? campaignIdQuery : Array.isArray(campaignIdQuery) ? campaignIdQuery[0] : '';
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    // Blueprint (twelve_week_plan) is source of truth for committed plans — check first
    const blueprint = await getUnifiedCampaignBlueprint(access.campaignId);
    const rawFlag = Array.isArray(raw) ? raw[0] : raw;
    const wantsRawBlueprint =
      rawFlag === '1' || rawFlag === 'true' || rawFlag === 'yes' || rawFlag === 'blueprint';
    if (wantsRawBlueprint) {
      return res.status(200).json({
        source: blueprint?.weeks?.length ? 'unified_blueprint' : 'legacy_or_empty',
        campaignId: access.campaignId,
        blueprint: blueprint ?? null,
      });
    }
    let source: any[] = [];
    if (blueprint?.weeks && blueprint.weeks.length > 0) {
      source = blueprint.weeks.map((w) => ({
        week_number: w.week_number,
        phase: w.phase_label,
        theme: w.phase_label,
        focus_area: w.primary_objective || w.phase_label,
        key_messaging: w.topics_to_cover?.join('; ') ?? null,
        content_types: w.content_type_mix ?? [],
        platform_strategy: null,
        refinement_status: 'ai_enhanced',
        completion_percentage: 0,
        platform_allocation: w.platform_allocation ?? {},
        platform_content_breakdown: w.platform_content_breakdown ?? {},
        topics_to_cover: w.topics_to_cover ?? [],
        weeklyContextCapsule: (w as any).weeklyContextCapsule ?? null,
        topics: Array.isArray((w as any).topics) ? (w as any).topics : [],
        // Additive: expose deterministic execution units when present (backward-compatible).
        execution_items: Array.isArray((w as any).execution_items) ? (w as any).execution_items : [],
        posting_execution_map: Array.isArray((w as any).posting_execution_map) ? (w as any).posting_execution_map : [],
        resolved_postings: Array.isArray((w as any).resolved_postings) ? (w as any).resolved_postings : [],
        week_extras: (w as any).week_extras ?? null,
        distribution_strategy: (w as any).distribution_strategy ?? null,
        distribution_reason: (w as any).distribution_reason ?? null,
        planning_adjustment_reason: (w as any).planning_adjustment_reason ?? null,
        planning_adjustments_summary: (w as any).planning_adjustments_summary ?? null,
        momentum_adjustments: (w as any).momentum_adjustments ?? null,
      }));
    }
    // Fallback to legacy tables when no committed blueprint
    if (source.length === 0) {
      const { data: plans, error: plansError } = await supabase
        .from('weekly_content_plans')
        .select('*')
        .eq('campaign_id', access.campaignId)
        .order('week_number');
      if (!plansError && plans && plans.length > 0) {
        source = plans;
      } else {
        const { data: refinements, error: refError } = await supabase
          .from('weekly_content_refinements')
          .select('*')
          .eq('campaign_id', access.campaignId)
          .order('week_number');
        if (!refError && refinements && refinements.length > 0) {
          source = refinements;
        }
      }
    }

    // Format response (supports both weekly_content_plans and weekly_content_refinements schemas)
    const response = source.map(plan => ({
      weekNumber: plan.week_number,
      phase: plan.phase ?? null,
      theme: plan.theme ?? plan.focus_area ?? null,
      focusArea: plan.focus_area ?? plan.theme ?? null,
      keyMessaging: plan.key_messaging ?? null,
      contentTypes: plan.content_types ?? [],
      platformStrategy: plan.platform_strategy ?? null,
      callToAction: plan.call_to_action ?? null,
      targetMetrics: plan.target_metrics ?? null,
      contentGuidelines: plan.content_guidelines ?? null,
      hashtagSuggestions: plan.hashtag_suggestions ?? [],
      status: plan.status ?? plan.refinement_status ?? 'planned',
      completionPercentage: plan.completion_percentage ?? 0,
      platform_allocation: plan.platform_allocation ?? {},
      platform_content_breakdown: plan.platform_content_breakdown ?? {},
      topics_to_cover: plan.topics_to_cover ?? [],
      weeklyContextCapsule: plan.weeklyContextCapsule ?? null,
      topics: Array.isArray(plan.topics) ? plan.topics : [],
      // Additive passthrough for unified-blueprint enriched fields (no-ops for legacy rows).
      execution_items: Array.isArray((plan as any).execution_items) ? (plan as any).execution_items : [],
      posting_execution_map: Array.isArray((plan as any).posting_execution_map) ? (plan as any).posting_execution_map : [],
      resolved_postings: Array.isArray((plan as any).resolved_postings) ? (plan as any).resolved_postings : [],
      week_extras: (plan as any).week_extras ?? null,
      distribution_strategy: (plan as any).distribution_strategy ?? null,
      distribution_reason: (plan as any).distribution_reason ?? null,
      planning_adjustment_reason: (plan as any).planning_adjustment_reason ?? null,
      planning_adjustments_summary: (plan as any).planning_adjustments_summary ?? null,
      momentum_adjustments: (plan as any).momentum_adjustments ?? null,
    }));

    try {
      console.log('[weekly-debug][api-response-week]', JSON.stringify(response[0] ?? null, null, 2));
    } catch {
      console.log('[weekly-debug][api-response-week]', response[0] ?? null);
    }

    const executionIntelligence =
      blueprint && typeof blueprint === 'object'
        ? (blueprint as { executionIntelligence?: { executionPressure?: unknown; executionMomentum?: unknown } }).executionIntelligence
        : null;
    const executionPressure =
      executionIntelligence?.executionPressure ??
      (blueprint && typeof blueprint === 'object' ? (blueprint as { executionPressure?: unknown }).executionPressure ?? null) ??
      null;
    const executionMomentum =
      executionIntelligence?.executionMomentum ?? null;
    const executionMomentumRecovery =
      executionIntelligence && typeof executionIntelligence === 'object'
        ? (executionIntelligence as { momentumRecovery?: unknown }).momentumRecovery ?? null
        : null;

    // Execution drift: run when we have planned weeks and can load actual published posts
    let executionDrift: { state: string; signals: { schedule: number; topic: number; format: number }; driftScore: number; warnings?: string[] } | null = null;
    const plannedWeeks: WeekPlanLike[] = Array.isArray(blueprint?.weeks) ? blueprint.weeks as WeekPlanLike[] : [];
    if (plannedWeeks.length > 0) {
      const { data: campaignRow } = await supabase
        .from('campaigns')
        .select('start_date')
        .eq('id', access.campaignId)
        .maybeSingle();
      const campaignStart = campaignRow?.start_date ? new Date(String(campaignRow.start_date)).getTime() : null;
      const { data: publishedRows } = await supabase
        .from('scheduled_posts')
        .select('title, content, content_type, scheduled_for')
        .eq('campaign_id', access.campaignId)
        .eq('status', 'published');
      const actualPosts: PublishedContent[] = (publishedRows ?? []).map((row: { title?: string | null; content?: string | null; content_type?: string | null; scheduled_for?: string | null }) => {
        let week: number | undefined;
        if (campaignStart != null && row.scheduled_for) {
          const postDate = new Date(String(row.scheduled_for)).getTime();
          const msPerWeek = 7 * 24 * 60 * 60 * 1000;
          week = Math.floor((postDate - campaignStart) / msPerWeek) + 1;
        }
        return {
          title: row.title ?? null,
          content: row.content ?? null,
          content_type: row.content_type ?? null,
          week: week ?? undefined,
        };
      });
      executionDrift = detectExecutionDrift(plannedWeeks, actualPosts);
    }

    const executionHealth = computeExecutionHealthScore(
      executionPressure ?? undefined,
      executionMomentum ?? undefined,
      executionDrift ?? undefined
    );

    res.status(200).json({
      plans: response,
      executionPressure,
      executionMomentum,
      executionMomentumRecovery,
      executionDrift,
      executionHealth,
    });

  } catch (error) {
    console.error('Error in get-weekly-plans API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



