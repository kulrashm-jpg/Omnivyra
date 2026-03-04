import { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignAiPlan, CampaignAiMode } from '../../../../backend/services/campaignAiOrchestrator';
import { saveAiCampaignPlan, saveDraftBlueprint, getLatestDraftPlan } from '../../../../backend/db/campaignPlanStore';
import { validateAndModerateUserMessage } from '../../../../backend/chatGovernance';
import { getCampaignPlanningInputs, saveCampaignPlanningInputs } from '../../../../backend/services/campaignPlanningInputsService';
import { normalizeCapacityCounts, normalizeCapacityCountsWithBreakdown } from '../../../../backend/services/campaignAiOrchestrator';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { detectCampaignConflicts, suggestAvailableDateRange } from '../../../../backend/services/schedulingService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUserCompanyRole, getCompanyRoleIncludingInvited } from '../../../../backend/services/rbacService';
import { resolveEffectiveCampaignRole, isCompanyOverrideRole } from '../../../../backend/services/campaignRoleService';

const MODES: CampaignAiMode[] = ['generate_plan', 'refine_day', 'platform_customize'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const {
      campaignId,
      companyId,
      mode: bodyMode,
      message: bodyMessage,
      durationWeeks,
      targetDay,
      platforms,
      messages: bodyMessages,
      recommendationContext,
      optimizationContext,
      currentPlan,
      scopeWeeks,
      chatContext,
      vetScope,
      collectedPlanningContext: bodyCollectedPlanningContext,
      autopilot,
      forceFreshPlanningThread,
      prefilledPlanning: bodyPrefilledPlanning,
      conversationHistory: bodyConversationHistory,
      context: bodyContext,
    } = body;

    const conversationHistory = Array.isArray(bodyConversationHistory)
      ? bodyConversationHistory
      : Array.isArray(bodyMessages)
        ? bodyMessages
        : [];

    let mode = bodyMode;
    let message = typeof bodyMessage === 'string' ? bodyMessage : '';

    if (
      bodyContext === 'campaign-planning' &&
      forceFreshPlanningThread === true &&
      Array.isArray(conversationHistory) &&
      conversationHistory.length > 0
    ) {
      mode = mode ?? 'generate_plan';
      const lastUser = [...conversationHistory].reverse().find((m: any) => m?.type === 'user' || m?.role === 'user');
      const lastUserText = lastUser && (typeof (lastUser as any).message === 'string' ? (lastUser as any).message : typeof (lastUser as any).content === 'string' ? (lastUser as any).content : null);
      message = message || lastUserText || 'Yes, generate my full 12-week plan now.';
    }

    const collectedPlanningContext =
      bodyPrefilledPlanning != null && typeof bodyPrefilledPlanning === 'object' && !Array.isArray(bodyPrefilledPlanning)
        ? bodyPrefilledPlanning
        : bodyCollectedPlanningContext;

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

    // Multi-tenant: verify user has access to this campaign (company + campaign role). Align with RBAC used by list/other campaign APIs.
    const { data: versionForAccess } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!versionForAccess?.company_id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const resolvedCompanyId = String(versionForAccess.company_id);
    let { role, userId } = await getUserCompanyRole(req, resolvedCompanyId);
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (!role) {
      // Plan API: allow invited users with any company role (getUserCompanyRole only uses invited for ADMIN/COMPANY_ADMIN/SUPER_ADMIN)
      const invitedRole = await getCompanyRoleIncludingInvited(userId, resolvedCompanyId);
      if (invitedRole) role = invitedRole;
    }
    if (!role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }

    // Company override roles (e.g. COMPANY_ADMIN, SUPER_ADMIN, Content Architect) have full access; skip campaign-level check.
    if (!isCompanyOverrideRole(role)) {
      const campaignAuthResult = await resolveEffectiveCampaignRole(userId, campaignId, resolvedCompanyId);
      if (campaignAuthResult.error === 'CAMPAIGN_ROLE_REQUIRED') {
        return res.status(403).json({ error: 'CAMPAIGN_ROLE_REQUIRED' });
      }
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
      collectedPlanningContext != null && typeof collectedPlanningContext === 'object' && !Array.isArray(collectedPlanningContext)
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
      if (n.includes('key messages') || n.includes('pain points') || n.includes('one thing you want people to remember')) return 'key_messages';
      if (n.includes('primary target audience') || n.includes('who will see your content') || (n.includes('target audience') && n.includes('who is'))) return 'target_audience';
      if (n.includes('target audience')) return 'target_audience';
      if ((n.includes('which professionals') && n.includes('mainly speaking')) || n.includes('which group fits')) return 'audience_professional_segment';
      if (n.includes('how do you want your content to sound') || n.includes('how should your posts sound')) return 'communication_style';
      if ((n.includes('after reading your content') && n.includes('what should people do')) || n.includes('what do you want people to do after')) return 'action_expectation';
      if (n.includes('short easy reads') || (n.includes('detailed insights') && n.includes('short')) || n.includes('short reads or longer') || n.includes('longer pieces')) return 'content_depth';
      if (n.includes('connected series') && n.includes('mostly independent')) return 'topic_continuity';
      if (n.includes('ongoing story') || n.includes('different topics each time')) return 'topic_continuity';
      if (n.includes('existing content') || n.includes('do you have any existing content')) return 'available_content';
      if (
        n.includes('produce per week') ||
        n.includes('produce each week') ||
        n.includes('production capacity') ||
        n.includes('weekly production capacity') ||
        n.includes('content capacity') ||
        n.includes('how much content') ||
        n.includes('how will you create') ||
        n.includes('how many pieces per week')
      ) {
        return 'content_capacity';
      }
      if (n.includes('which platforms') || n.includes('platforms will you focus') || n.includes('where will you post')) return 'platforms';
      if (n.includes('platform-exclusive campaigns') || n.includes('only for one platform') || n.includes('anything only for one platform')) return 'exclusive_campaigns';
      if (n.includes('content types') && n.includes('count per week')) return 'platform_content_requests';
      if (n.includes('how many of each type per week')) return 'platform_content_requests';
      if (n.includes('set how often') || n.includes('same topic across platforms') || n.includes('publish same day on all platforms') || n.includes('let AI decide')) return 'platform_content_requests';
      if (n.includes('content types') && n.includes('platform')) return 'platform_content_types';
      if (n.includes('what will you post on each') || n.includes('which content types will you use') || n.includes('for each platform you selected')) return 'platform_content_types';
      if ((n.includes('start') && n.includes('date')) || n.includes('when do you want to start') || n.includes('yyyy-mm-dd')) return 'tentative_start';
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
    const isoDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : null;
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];
    const lastAiEntry = history.filter((m: any) => m?.type === 'ai').pop();
    const lastAiAsksStartDate = lastAiEntry && detectAskedKey(String(lastAiEntry?.message ?? '')) === 'tentative_start';
    const tentativeStartFromCurrentMessage = lastAiAsksStartDate && isoDateOnly(message) ? message.trim() : null;
    const tentativeStartAnswer =
      (existingCollectedPlanningContext as any)?.tentative_start
      ?? tentativeStartFromCurrentMessage
      ?? (isoDateOnly(extractLatestAnswer('tentative_start') ?? '') || extractLatestAnswer('tentative_start'));
    // Extract all Q&A answers from conversation (and existing body) so plan generation has full context, not just target_audience/tentative_start.
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

    // Merge extracted/conversation-derived context into finalCollectedPlanningContext so runCampaignAiPlan has full info for week plan (not superficial).
    finalCollectedPlanningContext = {
      ...(existingCollectedPlanningContext ?? {}),
      ...(targetAudienceAnswer ? { target_audience: targetAudienceAnswer } : {}),
      ...(tentativeStartAnswer ? { tentative_start: tentativeStartAnswer } : {}),
      ...deterministicPlanningContext,
      ...(audienceProfessionalSegment ? { audience_professional_segment: audienceProfessionalSegment } : {}),
      ...(communicationStyle ? { communication_style: communicationStyle } : {}),
      ...(actionExpectation ? { action_expectation: actionExpectation } : {}),
      ...(contentDepth ? { content_depth: contentDepth } : {}),
      ...(topicContinuity ? { topic_continuity: topicContinuity } : {}),
      ...(availableContent != null && String(availableContent).trim() !== '' ? { available_content: availableContent } : {}),
      ...(weeklyCapacity != null && String(weeklyCapacity).trim() !== '' ? { content_capacity: weeklyCapacity } : {}),
      ...(selectedPlatforms.length > 0 ? { platforms: selectedPlatforms.join(', ') } : {}),
      ...(platformContentRequests && typeof platformContentRequests === 'object' ? { platform_content_requests: platformContentRequests } : {}),
      ...(Array.isArray(exclusiveCampaigns) ? { exclusive_campaigns: exclusiveCampaigns } : {}),
    };

    const shouldPersistPlanningInputs =
      !!existingCollectedPlanningContext ||
      (Array.isArray(conversationHistory) && conversationHistory.length > 0);
    if (shouldPersistPlanningInputs && resolvedCompanyId) {
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
          companyId: resolvedCompanyId,
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
        console.warn('[plan] saveCampaignPlanningInputs failed (continuing):', (err as any)?.message ?? err);
      }
    }

    console.log('[PLAN INPUT SOURCE]', JSON.stringify(finalCollectedPlanningContext, null, 2));

    // Restore point: when user retries (e.g. after timeout) with "continue" or "try again", return existing draft if it matches requested duration — avoid reprocessing with no changes.
    const requestedWeeks = typeof durationWeeks === 'number' ? durationWeeks : null;
    const isRetryMessage = /^\s*continue\s*$/i.test(String(message).trim()) || /try again|retry/i.test(String(message));
    if (mode === 'generate_plan' && isRetryMessage && requestedWeeks != null) {
      const existingDraft = await getLatestDraftPlan(campaignId);
      if (existingDraft?.weeks?.length === requestedWeeks) {
        console.log('[plan] Restore: returning existing draft plan (same duration) to avoid reprocessing.');
        return res.status(200).json({
          mode: 'generate_plan',
          snapshot_hash: `restore-${campaignId}`,
          omnivyre_decision: { status: 'ok', recommendation: 'proceed' as const },
          plan: { weeks: existingDraft.weeks },
          collectedPlanningContext: finalCollectedPlanningContext,
          startDateConflictWarning: undefined,
        });
      }
    }

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

    let startDateConflictWarning: string | null = null;
    const tentativeStart = typeof finalCollectedPlanningContext?.tentative_start === 'string'
      ? finalCollectedPlanningContext.tentative_start.trim()
      : null;
    if (tentativeStart && /^\d{4}-\d{2}-\d{2}$/.test(tentativeStart) && supabase) {
      try {
        const { data: campaignRow } = await supabase
          .from('campaigns')
          .select('user_id')
          .eq('id', campaignId)
          .maybeSingle();
        const userId = campaignRow?.user_id;
        if (userId) {
          const startDate = new Date(tentativeStart);
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 12 * 7);
          const conflicts = await detectCampaignConflicts(
            userId,
            startDate,
            endDate,
            campaignId
          );
          if (conflicts.length > 0) {
            const lines = conflicts.map(
              (c) => `• "${c.campaign_name}" (${c.start_date.toLocaleDateString()} – ${c.end_date.toLocaleDateString()}, ${c.overlap_days} day overlap)`
            );
            startDateConflictWarning = `⚠️ **Date conflict:** This start date overlaps with ${conflicts.length} existing campaign(s):\n\n${lines.join('\n')}\n\nConsider choosing a different start date or finishing the overlapping campaign(s) first.`;
            const suggestion = await suggestAvailableDateRange(userId, 12 * 7, startDate);
            if (suggestion) {
              startDateConflictWarning += `\n\nSuggested alternative: start **${suggestion.start_date.toLocaleDateString()}** (after current campaigns).`;
            }
          }
        }
      } catch (err) {
        console.warn('[plan] Start date conflict check failed (non-blocking):', (err as any)?.message ?? err);
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
      startDateConflictWarning: startDateConflictWarning ?? undefined,
    });
  } catch (error: any) {
    console.error('Error in campaign AI plan API:', error);
    const message = error?.message && typeof error.message === 'string'
      ? error.message
      : 'Failed to generate campaign plan';
    return res.status(500).json({ error: message });
  }
}
