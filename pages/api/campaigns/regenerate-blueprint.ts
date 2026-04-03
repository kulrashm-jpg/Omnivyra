
/**
 * POST /api/campaigns/regenerate-blueprint
 * Regenerates blueprint after duration change.
 * Requires blueprint_status === INVALIDATED.
 * Calls orchestrator with campaigns.duration_weeks, saves blueprint, sets ACTIVE.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { runCampaignAiPlan } from '../../../backend/services/campaignAiOrchestrator';
import { saveCampaignBlueprintFromLegacy } from '../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getRecommendedTopicsForCompany } from '../../../backend/services/recommendationEngineService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import { getStrategicThemesAsOpportunities } from '../../../backend/services/strategicThemeEngine';
import { getCampaignPlanningInputs } from '../../../backend/services/campaignPlanningInputsService';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import {
  getStoredStrategicThemeTitle,
  normalizeStoredStrategicTheme,
} from '../../../lib/recommendationStrategicCard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (await isGovernanceLocked()) {
    return res.status(423).json({
      code: 'GOVERNANCE_LOCKED',
      message: 'Governance lockdown active. Mutations disabled.',
    });
  }

  try {
    const { campaignId, companyId, planningContext } = req.body || {};

    if (!campaignId || !companyId) {
      return res.status(400).json({
        error: 'campaignId and companyId are required',
      });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, blueprint_status, duration_weeks, execution_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const executionStatus = normalizeExecutionState((campaign as any).execution_status);
    try {
      assertCampaignNotFinalized(executionStatus);
    } catch (err: any) {
      if (err instanceof CampaignFinalizedError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId, execution_status: executionStatus },
        });
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    try {
      await assertBlueprintMutable(campaignId);
    } catch (err: any) {
      if (err instanceof BlueprintExecutionFreezeError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'BLUEPRINT_FREEZE_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: {
            campaignId,
            hoursUntilExecution: err.hoursUntilExecution,
            freezeWindowHours: err.freezeWindowHours,
          },
        });
        return res.status(409).json({
          code: 'EXECUTION_WINDOW_FROZEN',
          message: 'Blueprint modifications are locked within 24 hours of execution.',
        });
      }
      if (err instanceof BlueprintImmutableError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'BLUEPRINT_MUTATION_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: {
            campaignId,
            execution_status: (campaign as any).execution_status ?? 'ACTIVE',
            blueprint_status: (campaign as any).blueprint_status ?? 'ACTIVE',
          },
        });
        return res.status(409).json({
          code: 'BLUEPRINT_IMMUTABLE',
          message: 'Blueprint cannot be modified while campaign is in execution.',
        });
      }
      throw err;
    }

    if (campaign.duration_weeks == null) {
      return res.status(412).json({
        code: 'PRE_PLANNING_REQUIRED',
        message: 'Campaign duration not initialized. Run pre-planning first.',
      });
    }

    const existingBlueprint = await getUnifiedCampaignBlueprint(campaignId);
    const hasNoPlan =
      !existingBlueprint ||
      !existingBlueprint.weeks ||
      existingBlueprint.weeks.length === 0;
    const allowFromStoredContext =
      hasNoPlan &&
      (campaign.blueprint_status == null ||
        campaign.blueprint_status === 'draft' ||
        campaign.blueprint_status === '');
    const allowInvalidated = campaign.blueprint_status === 'INVALIDATED';

    if (!allowInvalidated && !allowFromStoredContext) {
      return res.status(400).json({
        error: 'INVALID_STATE',
        message:
          'Blueprint can only be regenerated when status is INVALIDATED, or when no plan exists yet (create from stored strategic theme/context).',
        current_status: campaign.blueprint_status ?? 'unknown',
      });
    }

    const durationWeeks = campaign.duration_weeks ?? 12;

    const version = await getLatestCampaignVersionByCampaignId(campaignId);
    const companyIdForTopics = (req.body?.companyId as string) || version?.company_id;

    let mergedPlanningContext: Record<string, unknown> =
      planningContext && typeof planningContext === 'object' && Object.keys(planningContext).length > 0
        ? { ...planningContext }
        : {};

    // Derive topics for content blueprint: card first (Trend recommendation), then company context
    // Uses pre-planning form data (already in planningContext). No UI — all backend.
    if (companyIdForTopics) {
      const topicSet = new Set<string>();
      let profile: Awaited<ReturnType<typeof getProfile>> = null;

      try {
        profile = await getProfile(companyIdForTopics, { autoRefine: false, languageRefine: true });

        const snapshot = (version?.campaign_snapshot ?? {}) as {
          source_recommendation_id?: string;
          source_strategic_theme?: Record<string, unknown>;
        };
        const sourceRecId = snapshot?.source_recommendation_id;
        const sourceTheme = snapshot?.source_strategic_theme;
        const normalizedSourceTheme = normalizeStoredStrategicTheme(sourceTheme);

        // 0. Strategic theme from selected recommendation card (Build Campaign Blueprint): use this first
        if (sourceTheme && typeof sourceTheme === 'object' && normalizedSourceTheme) {
          const themeTopic = getStoredStrategicThemeTitle(sourceTheme);
          if (themeTopic) topicSet.add(themeTopic);
          const primary = normalizedSourceTheme.blueprint.primary_recommendations;
          const supporting = normalizedSourceTheme.blueprint.supporting_recommendations;
          primary.forEach((t) => topicSet.add(t.trim()));
          supporting.forEach((t) => topicSet.add(t.trim()));
          if (normalizedSourceTheme.blueprint.progression_summary?.trim()) {
            mergedPlanningContext.strategic_theme_progression = normalizedSourceTheme.blueprint.progression_summary.trim();
          }
          if (normalizedSourceTheme.blueprint.duration_weeks != null) {
            mergedPlanningContext.strategic_theme_duration_weeks = normalizedSourceTheme.blueprint.duration_weeks;
          }
          const intel = normalizedSourceTheme.intelligence;
          if (intel) {
            const parts: string[] = [];
            if (intel.problem_being_solved?.trim()) parts.push(`Problem: ${intel.problem_being_solved.slice(0, 400)}`);
            if (intel.expected_transformation?.trim()) parts.push(`Transformation: ${intel.expected_transformation.slice(0, 300)}`);
            if (intel.campaign_angle?.trim()) parts.push(`Campaign angle: ${intel.campaign_angle}`);
            if (parts.length > 0) {
              mergedPlanningContext.strategic_theme_intelligence = parts.join('\n');
            }
          }
          const themeList = [themeTopic, ...primary, ...supporting].filter(Boolean).map((t) => String(t).trim());
          if (themeList.length > 0) {
            mergedPlanningContext.strategic_themes = themeList;
          }
        }

        // 1. Card next: if campaign originated from Trend recommendation (DB row), use its topic
        if (sourceRecId && topicSet.size === 0) {
          const { data: rec } = await supabase
            .from('recommendation_snapshots')
            .select('trend_topic, category')
            .eq('id', sourceRecId)
            .maybeSingle();
          const recRow = rec as { trend_topic?: string; category?: string } | null;
          if (recRow?.trend_topic) {
            topicSet.add(String(recRow.trend_topic).trim());
          }
          if (recRow?.category && typeof recRow.category === 'string') {
            topicSet.add(String(recRow.category).trim());
          }
        }

        // 2. Company topics from past recommendation snapshots
        const companyTopics = await getRecommendedTopicsForCompany(companyIdForTopics, 15);
        companyTopics.forEach((t) => topicSet.add(t.trim()));

        // 3. Strategic themes from intelligence pipeline (replaces legacy LLM trend generation)
        const themes = await getStrategicThemesAsOpportunities({
          companyId: companyIdForTopics,
          limit: 20,
        });
        themes.forEach((t) => {
          if (t.title?.trim()) topicSet.add(t.title.trim());
        });
      } catch (e) {
        console.warn('[regenerate-blueprint] topic derivation failed:', e);
      }

      const recommendedTopics = Array.from(topicSet).filter(Boolean).slice(0, 20);
      if (recommendedTopics.length > 0) {
        mergedPlanningContext.recommended_topics = recommendedTopics;
      }

      const strategicThemes =
        (profile as { content_themes_list?: string[] })?.content_themes_list ??
        (profile && typeof (profile as { content_themes?: string }).content_themes === 'string'
          ? (profile as { content_themes: string }).content_themes.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
          : []);
      if (strategicThemes.length > 0) {
        mergedPlanningContext.strategic_themes = strategicThemes;
      }
    }

    const hasNoContextOrTopic =
      !Array.isArray(mergedPlanningContext.recommended_topics) ||
      mergedPlanningContext.recommended_topics.length === 0;
    const hasNoStrategicThemes =
      !Array.isArray(mergedPlanningContext.strategic_themes) ||
      mergedPlanningContext.strategic_themes.length === 0;
    const useBlankBlueprint = hasNoContextOrTopic && hasNoStrategicThemes;

    const effectiveDurationWeeks =
      (mergedPlanningContext.strategic_theme_duration_weeks as number | undefined) ?? durationWeeks;

    let result: { plan?: { weeks: any[]; campaign_id?: string } };
    if (useBlankBlueprint) {
      const planningInputs = await getCampaignPlanningInputs(campaignId);
      if (planningInputs?.platform_content_requests) {
        throw new Error('BLANK_BLUEPRINT_NOT_ALLOWED_WITH_DETERMINISTIC_INPUTS');
      }
      // Name + geo only: create blank content blueprint with weeks as per selection
      const blankWeeks = Array.from({ length: effectiveDurationWeeks }, (_, i) => ({
        week: i + 1,
        phase_label: `Week ${i + 1}`,
        theme: `Week ${i + 1}`,
        primary_objective: '',
        topics_to_cover: [],
        platform_allocation: {},
        content_type_mix: ['post'],
        cta_type: 'None',
        weekly_kpi_focus: '',
      }));
      result = { plan: { weeks: blankWeeks, campaign_id: campaignId } };
    } else {
      const planningInputs = await getCampaignPlanningInputs(campaignId);
      const deterministicPlanningContext = planningInputs
        ? {
            available_content: planningInputs.available_content,
            content_capacity: planningInputs.weekly_capacity,
            exclusive_campaigns: planningInputs.exclusive_campaigns,
            platforms: planningInputs.selected_platforms,
            platform_content_requests: planningInputs.platform_content_requests,
          }
        : {};
      const existingCollectedPlanningContext =
        Object.keys(mergedPlanningContext).length > 0 ? mergedPlanningContext : undefined;
      const finalCollectedPlanningContext = {
        ...(existingCollectedPlanningContext ?? {}),
        ...deterministicPlanningContext,
      };

      console.log('[PLAN INPUT SOURCE]', JSON.stringify(finalCollectedPlanningContext, null, 2));

      const aiResult = await runCampaignAiPlan({
        campaignId,
        mode: 'generate_plan',
        message: `Regenerate campaign plan for ${effectiveDurationWeeks} weeks. Use the strategic theme from the selected recommendation card when present.`,
        durationWeeks: effectiveDurationWeeks,
        collectedPlanningContext: finalCollectedPlanningContext,
      });
      result = { plan: aiResult.plan };
    }

    if (!result.plan?.weeks || result.plan.weeks.length === 0) {
      return res.status(500).json({
        error: 'ORCHESTRATOR_NO_PLAN',
        message: 'Orchestrator did not return a valid plan.',
      });
    }

    const blueprint = fromStructuredPlan({
      weeks: result.plan.weeks,
      campaign_id: campaignId,
    });

    await saveCampaignBlueprintFromLegacy({
      campaignId,
      blueprint,
      source: 'regenerate-blueprint',
    });

    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to set blueprint status to ACTIVE',
        details: updateError.message,
      });
    }

    return res.status(200).json({
      success: true,
      blueprint_status: 'ACTIVE',
      duration_weeks: blueprint.duration_weeks,
      message: 'Blueprint regenerated successfully.',
    });
  } catch (err: any) {
    console.error('[regenerate-blueprint]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}
