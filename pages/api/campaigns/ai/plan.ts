import { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignAiPlan, CampaignAiMode } from '../../../../backend/services/campaignAiOrchestrator';
import { saveAiCampaignPlan, saveDraftBlueprint } from '../../../../backend/db/campaignPlanStore';
import { validateAndModerateUserMessage } from '../../../../backend/chatGovernance';
import { getCampaignPlanningInputs, saveCampaignPlanningInputs } from '../../../../backend/services/campaignPlanningInputsService';
import { normalizeCapacityCounts, normalizeCapacityCountsWithBreakdown } from '../../../../backend/services/campaignAiOrchestrator';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';

const MODES: CampaignAiMode[] = ['generate_plan', 'refine_day', 'platform_customize'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, companyId, mode, message, durationWeeks, targetDay, platforms, messages: conversationHistory, recommendationContext, optimizationContext, currentPlan, scopeWeeks, chatContext, vetScope, collectedPlanningContext, autopilot } = req.body || {};

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!mode || !MODES.includes(mode)) {
      return res.status(400).json({ error: 'mode is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const policyResult = await validateAndModerateUserMessage(message, {
      chatContext: 'campaign_planning',
    });
    if (!policyResult.allowed) {
      const preview = String(message).slice(0, 80) + (message.length > 80 ? '...' : '');
      console.warn('[plan] Chat moderation rejected. Message:', JSON.stringify(preview), 'Reason:', policyResult.reason, 'Code:', policyResult.code);
      return res.status(400).json({
        error: 'Your message couldn\'t be processed. Please rephrase and try again.',
      });
    }

    const planningInputs = await getCampaignPlanningInputs(campaignId);
    const deterministicPlanningContext: Record<string, unknown> = {};
    if (planningInputs) {
      if (typeof planningInputs.target_audience === 'string' && planningInputs.target_audience.trim()) {
        deterministicPlanningContext.target_audience = planningInputs.target_audience.trim();
      }
      if (typeof (planningInputs as any).audience_professional_segment === 'string' && (planningInputs as any).audience_professional_segment.trim()) {
        deterministicPlanningContext.audience_professional_segment = (planningInputs as any).audience_professional_segment.trim();
      }
      if (typeof (planningInputs as any).communication_style === 'string' && (planningInputs as any).communication_style.trim()) {
        deterministicPlanningContext.communication_style = (planningInputs as any).communication_style.trim();
      }
      if (typeof (planningInputs as any).action_expectation === 'string' && (planningInputs as any).action_expectation.trim()) {
        deterministicPlanningContext.action_expectation = (planningInputs as any).action_expectation.trim();
      }
      if (typeof (planningInputs as any).content_depth === 'string' && (planningInputs as any).content_depth.trim()) {
        deterministicPlanningContext.content_depth = (planningInputs as any).content_depth.trim();
      }
      if (typeof (planningInputs as any).topic_continuity === 'string' && (planningInputs as any).topic_continuity.trim()) {
        deterministicPlanningContext.topic_continuity = (planningInputs as any).topic_continuity.trim();
      }
      if (planningInputs.available_content != null) deterministicPlanningContext.available_content = planningInputs.available_content;
      if (planningInputs.weekly_capacity != null) deterministicPlanningContext.content_capacity = planningInputs.weekly_capacity;
      if (planningInputs.exclusive_campaigns != null) deterministicPlanningContext.exclusive_campaigns = planningInputs.exclusive_campaigns;
      if (planningInputs.selected_platforms != null) deterministicPlanningContext.platforms = planningInputs.selected_platforms;
      if (planningInputs.platform_content_requests != null) {
        deterministicPlanningContext.platform_content_requests = planningInputs.platform_content_requests;
      }
    }

    const existingCollectedPlanningContext =
      collectedPlanningContext && typeof collectedPlanningContext === 'object'
        ? (collectedPlanningContext as Record<string, unknown>)
        : undefined;

    let finalCollectedPlanningContext: Record<string, unknown> = {
      ...(existingCollectedPlanningContext ?? {}),
      ...deterministicPlanningContext,
    };

    const normalizeForMatch = (s: string): string => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const detectAskedKey = (aiMessage: string): string | null => {
      const n = normalizeForMatch(aiMessage);
      if (!n) return null;
      if (n.includes('primary target audience') || (n.includes('target audience') && n.includes('who is'))) return 'target_audience';
      if (n.includes('which professionals') && n.includes('mainly speaking')) return 'audience_professional_segment';
      if (n.includes('how do you want your content to sound')) return 'communication_style';
      if (n.includes('after reading your content') && n.includes('what should people do')) return 'action_expectation';
      if (n.includes('short easy reads') || (n.includes('detailed insights') && n.includes('short'))) return 'content_depth';
      if (n.includes('connected series') && n.includes('mostly independent')) return 'topic_continuity';
      if (n.includes('existing content') || n.includes('do you have any existing content')) return 'available_content';
      if (
        n.includes('produce per week') ||
        n.includes('produce each week') ||
        n.includes('production capacity') ||
        n.includes('weekly production capacity') ||
        n.includes('content capacity') ||
        n.includes('how much content')
      ) {
        return 'content_capacity';
      }
      if (n.includes('which platforms') || n.includes('platforms will you focus')) return 'platforms';
      if (n.includes('platform-exclusive campaigns')) return 'exclusive_campaigns';
      if (n.includes('content types') && n.includes('count per week')) return 'platform_content_requests';
      return null;
    };
    const extractLatestAnswer = (key: string): string | null => {
      const history = Array.isArray(conversationHistory) ? conversationHistory : [];
      const pairs: Array<{ ai: string; user: string }> = [];
      for (let i = 0; i < history.length - 1; i += 1) {
        const curr: any = history[i];
        const next: any = history[i + 1];
        if (curr?.type === 'ai' && next?.type === 'user') {
          pairs.push({ ai: String(curr?.message ?? ''), user: String(next?.message ?? '') });
        }
      }
      let last: string | null = null;
      for (const pair of pairs) {
        const asked = detectAskedKey(pair.ai);
        if (asked === key) last = pair.user;
      }
      return last && last.trim() ? last.trim() : null;
    };

    const targetAudienceAnswer =
      (existingCollectedPlanningContext as any)?.target_audience ?? extractLatestAnswer('target_audience');
    finalCollectedPlanningContext = {
      ...(existingCollectedPlanningContext ?? {}),
      ...(targetAudienceAnswer ? { target_audience: targetAudienceAnswer } : {}),
      ...deterministicPlanningContext,
    };

    const shouldPersistPlanningInputs =
      !!existingCollectedPlanningContext ||
      (Array.isArray(conversationHistory) && conversationHistory.length > 0);
    if (shouldPersistPlanningInputs) {
      // Persisting is best-effort; do not block weekly plan generation if companyId/DB is unavailable.
      if (!companyId || typeof companyId !== 'string') {
        console.warn('[plan] Skipping campaign_planning_inputs persistence (missing companyId).');
      } else {
      const availableContent =
        (existingCollectedPlanningContext as any)?.available_content ??
        extractLatestAnswer('available_content');
      const weeklyCapacity =
        (existingCollectedPlanningContext as any)?.weekly_capacity ??
        (existingCollectedPlanningContext as any)?.content_capacity ??
        extractLatestAnswer('content_capacity');
      const audienceProfessionalSegment =
        (existingCollectedPlanningContext as any)?.audience_professional_segment ??
        extractLatestAnswer('audience_professional_segment');
      const communicationStyle =
        (existingCollectedPlanningContext as any)?.communication_style ??
        extractLatestAnswer('communication_style');
      const actionExpectation =
        (existingCollectedPlanningContext as any)?.action_expectation ??
        extractLatestAnswer('action_expectation');
      const contentDepth =
        (existingCollectedPlanningContext as any)?.content_depth ??
        extractLatestAnswer('content_depth');
      const topicContinuity =
        (existingCollectedPlanningContext as any)?.topic_continuity ??
        extractLatestAnswer('topic_continuity');
      const platformContentRequests = (existingCollectedPlanningContext as any)?.platform_content_requests;
      const exclusiveCampaigns = (existingCollectedPlanningContext as any)?.exclusive_campaigns;

      const selectedPlatforms = (() => {
        const fromRequests =
          platformContentRequests && typeof platformContentRequests === 'object' && !Array.isArray(platformContentRequests)
            ? Object.keys(platformContentRequests as any)
            : [];
        if (fromRequests.length > 0) {
          return fromRequests.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
        }
        const fromExclusive = Array.isArray(exclusiveCampaigns)
          ? exclusiveCampaigns
              .map((it: any) => String(it?.platform ?? '').trim().toLowerCase())
              .filter(Boolean)
          : [];
        if (fromExclusive.length > 0) return Array.from(new Set(fromExclusive));

        const raw = (existingCollectedPlanningContext as any)?.platforms ?? extractLatestAnswer('platforms');
        if (Array.isArray(raw)) return raw.map((p: any) => String(p).trim().toLowerCase()).filter(Boolean);
        const s = typeof raw === 'string' ? raw : '';
        return s
          .split(/[,;/]+/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
      })();

      const hasMeaningfulValue = (v: unknown): boolean => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'number') return Number.isFinite(v);
        if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v as Record<string, unknown>).length > 0;
        return false;
      };

      const normalizedAvailableContent = hasMeaningfulValue(availableContent)
        ? normalizeCapacityCountsWithBreakdown(availableContent)
        : undefined;
      const normalizedWeeklyCapacity = hasMeaningfulValue(weeklyCapacity)
        ? normalizeCapacityCountsWithBreakdown(weeklyCapacity)
        : undefined;

      try {
        await saveCampaignPlanningInputs({
          campaignId,
          companyId,
          recommendation_snapshot:
            (recommendationContext && typeof recommendationContext === 'object'
              ? ((recommendationContext as any).context_payload ?? recommendationContext)
              : {}) ?? {},
          target_audience: targetAudienceAnswer ?? undefined,
          audience_professional_segment: audienceProfessionalSegment ?? undefined,
          communication_style: communicationStyle ?? undefined,
          action_expectation: actionExpectation ?? undefined,
          content_depth: contentDepth ?? undefined,
          topic_continuity: topicContinuity ?? undefined,
          available_content: normalizedAvailableContent,
          weekly_capacity: normalizedWeeklyCapacity,
          exclusive_campaigns: exclusiveCampaigns,
          platform_content_requests: platformContentRequests,
          selected_platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
          planning_stage: 'campaign_planning_chat',
          is_completed: false,
        });
      } catch (err) {
        // Persistence is best-effort: do not block plan generation (scenario runner + prod resilience).
        console.warn('[plan] saveCampaignPlanningInputs failed (continuing):', (err as any)?.message ?? err);
      }
      }
    }

    console.log('[PLAN INPUT SOURCE]', JSON.stringify(finalCollectedPlanningContext, null, 2));

    const effectiveMode = planningInputs ? 'generate_plan' : mode;
    const toneOnlyConversationHistory = Array.isArray(conversationHistory) ? conversationHistory : undefined;
    const messageForTone =
      planningInputs && toneOnlyConversationHistory?.length
        ? `${message}\n\nTone-only conversation history:\n${JSON.stringify(toneOnlyConversationHistory.slice(-20), null, 2)}`
        : message;

    const result = await runCampaignAiPlan({
      campaignId,
      mode: effectiveMode,
      message: messageForTone,
      durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : undefined,
      collectedPlanningContext: finalCollectedPlanningContext,
      targetDay: typeof targetDay === 'string' ? targetDay : undefined,
      platforms: Array.isArray(platforms) ? platforms : undefined,
      // Always pass conversationHistory so QA gating can detect answered questions
      // (even when planningInputs exist and we only use history for tone/context).
      conversationHistory: toneOnlyConversationHistory?.slice(-50),
      recommendationContext: recommendationContext && typeof recommendationContext === 'object' ? recommendationContext : undefined,
        optimizationContext:
        optimizationContext && typeof optimizationContext === 'object' && Array.isArray(optimizationContext.headlines)
          ? { roiScore: Number(optimizationContext.roiScore) || 50, headlines: optimizationContext.headlines }
          : undefined,
      currentPlan: currentPlan && typeof currentPlan === 'object' ? currentPlan : undefined,
      scopeWeeks: Array.isArray(scopeWeeks) ? scopeWeeks : undefined,
      chatContext: typeof chatContext === 'string' ? chatContext : undefined,
      vetScope: vetScope && typeof vetScope === 'object' && Array.isArray(vetScope.selectedWeeks) ? vetScope : undefined,
      autopilot: autopilot === true,
    });

    if (result?.validation_result?.status === 'invalid' && effectiveMode === 'generate_plan' && !result?.plan) {
      return res.status(422).json({
        error: 'CAPACITY_VALIDATION_FAILED',
        conversationalResponse: result.conversationalResponse,
        validation_result: result.validation_result,
      });
    }

    if (mode === 'generate_plan' && result?.plan?.weeks?.length) {
      const w1: any = result.plan.weeks.find((w: any) => Number(w?.week) === 1) ?? result.plan.weeks[0];
      try {
        console.log(
          '[weekly-debug][ai-plan-api-week1]',
          JSON.stringify(
            {
              week: w1?.week,
              platform_allocation: w1?.platform_allocation ?? null,
              content_type_mix: w1?.content_type_mix ?? null,
              platform_content_breakdown: w1?.platform_content_breakdown ?? null,
            },
            null,
            2
          )
        );
      } catch {
        console.log('[weekly-debug][ai-plan-api-week1]', {
          week: w1?.week,
          platform_allocation: w1?.platform_allocation ?? null,
          content_type_mix: w1?.content_type_mix ?? null,
          platform_content_breakdown: w1?.platform_content_breakdown ?? null,
        });
      }
    }

    if (typeof saveAiCampaignPlan === 'function') {
      try {
        await saveAiCampaignPlan({
          campaignId,
          snapshot_hash: result.snapshot_hash,
          mode: result.mode,
          response: result.raw_plan_text,
          omnivyre_decision: result.omnivyre_decision,
        });
      } catch (err) {
        console.warn('[plan] Failed to persist AI plan (continuing):', (err as any)?.message ?? err);
      }
    }

    // Best-effort: keep backend draft blueprint aligned with the exact structured weeks returned to the UI.
    if (result?.mode === 'generate_plan' && Array.isArray(result?.plan?.weeks) && result.plan.weeks.length > 0) {
      try {
        const blueprint = fromStructuredPlan({ weeks: result.plan.weeks, campaign_id: campaignId });
        await saveDraftBlueprint({ campaignId, blueprint });
      } catch (err) {
        console.warn('[plan] Failed to persist draft blueprint (continuing):', (err as any)?.message ?? err);
      }
    }

    return res.status(200).json({
      mode: result.mode,
      snapshot_hash: result.snapshot_hash,
      omnivyre_decision: result.omnivyre_decision,
      validation_result: result.validation_result,
      plan: result.plan,
      autopilot_result: result.autopilot_result,
      day: result.day,
      platform_content: result.platform_content,
      conversationalResponse: result.conversationalResponse,
      collectedPlanningContext: finalCollectedPlanningContext,
    });
  } catch (error: any) {
    console.error('Error in campaign AI plan API:', error);
    const message = error?.message && typeof error.message === 'string'
      ? error.message
      : 'Failed to generate campaign plan';
    return res.status(500).json({ error: message });
  }
}
