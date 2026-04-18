import { useCallback } from 'react';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { clearWizardState } from '../../utils/campaignWizardStorage';
import type { Campaign, RecommendationSummary } from './types';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export function usePrePlanningActions({
  campaign,
  effectiveCompanyId,
  requestedWeeksForPreplan,
  setAiSuggestionLoading,
  setAiSuggestion,
  setRequestedWeeksForPreplan,
  setPrePlanningLoading,
  setPrePlanningResult,
  plannedStartDate,
  questionnaireAnswers,
  crossPlatformSharingEnabled,
  setBlueprintRegenerateFailedMsg,
  setShowAIChat,
  setBlueprintGeneratedSuccess,
  loadCampaignDetails,
  notify,
  prePlanningResult,
}: {
  campaign: Campaign | null;
  effectiveCompanyId: string;
  requestedWeeksForPreplan: number;
  setAiSuggestionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setAiSuggestion: React.Dispatch<
    React.SetStateAction<{ suggested_weeks: number; rationale: string } | null>
  >;
  setRequestedWeeksForPreplan: React.Dispatch<React.SetStateAction<number>>;
  setPrePlanningLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setPrePlanningResult: React.Dispatch<React.SetStateAction<RecommendationSummary | any>>;
  plannedStartDate: string;
  questionnaireAnswers: {
    availableVideo: number;
    availablePost: number;
    availableBlog: number;
    availableSong: number;
    videoPerWeek: number;
    postPerWeek: number;
    blogPerWeek: number;
    songPerWeek: number;
  };
  crossPlatformSharingEnabled: boolean;
  setBlueprintRegenerateFailedMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setShowAIChat: React.Dispatch<React.SetStateAction<boolean>>;
  setBlueprintGeneratedSuccess: React.Dispatch<React.SetStateAction<boolean>>;
  loadCampaignDetails: (campaignId: string) => Promise<void>;
  notify: Notify;
  prePlanningResult: any;
}) {
  const fetchAiDurationSuggestion = useCallback(async () => {
    if (!campaign || !effectiveCompanyId) return;
    setAiSuggestionLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/suggest-duration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion({ suggested_weeks: data.suggested_weeks, rationale: data.rationale });
        setRequestedWeeksForPreplan(data.suggested_weeks);
      }
    } catch (err) {
      console.error('AI suggestion failed', err);
    } finally {
      setAiSuggestionLoading(false);
    }
  }, [campaign, effectiveCompanyId, setAiSuggestion, setAiSuggestionLoading, setRequestedWeeksForPreplan]);

  const runPrePlanningFlow = useCallback(
    async (weeksOverride?: number) => {
      if (!campaign || !effectiveCompanyId) return;
      const weeks = weeksOverride ?? requestedWeeksForPreplan;
      setPrePlanningLoading(true);
      setPrePlanningResult(null);
      try {
        const res = await fetchWithAuth('/api/campaigns/run-preplanning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: campaign.id,
            companyId: effectiveCompanyId,
            requested_weeks: weeks,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPrePlanningResult(data);
        }
      } catch (err) {
        console.error('Pre-planning failed', err);
      } finally {
        setPrePlanningLoading(false);
      }
    },
    [campaign, effectiveCompanyId, requestedWeeksForPreplan, setPrePlanningLoading, setPrePlanningResult],
  );

  const acceptDuration = useCallback(
    async (weeks: number) => {
      if (!campaign || !effectiveCompanyId) return;
      setPrePlanningLoading(true);
      try {
        const res = await fetchWithAuth('/api/campaigns/update-duration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: campaign.id,
            companyId: effectiveCompanyId,
            requested_weeks: weeks,
            start_date: plannedStartDate || undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'REGENERATION_REQUIRED' || data.status === 'APPROVED') {
            setPrePlanningResult(null);
            try {
              const q = questionnaireAnswers;
              const planningContext: Record<string, unknown> = {
                campaign_duration: weeks,
                tentative_start: plannedStartDate || campaign?.start_date,
                preplanning_form_completed: true,
                cross_platform_sharing: { enabled: crossPlatformSharingEnabled },
              };
              const hasAvailable =
                q.availableVideo > 0 || q.availablePost > 0 || q.availableBlog > 0 || q.availableSong > 0;
              if (hasAvailable) {
                const parts: string[] = [];
                if (q.availableVideo > 0) parts.push(`${q.availableVideo} videos`);
                if (q.availablePost > 0) parts.push(`${q.availablePost} posts`);
                if (q.availableBlog > 0) parts.push(`${q.availableBlog} blogs`);
                if (q.availableSong > 0) parts.push(`${q.availableSong} songs/audio`);
                planningContext.available_content = parts.join(', ');
              } else {
                planningContext.available_content = 'No existing content';
              }
              const hasCapacity =
                q.videoPerWeek > 0 || q.postPerWeek > 0 || q.blogPerWeek > 0 || q.songPerWeek > 0;
              if (hasCapacity) {
                const parts: string[] = [];
                if (q.videoPerWeek > 0) parts.push(`${q.videoPerWeek} videos/week`);
                if (q.postPerWeek > 0) parts.push(`${q.postPerWeek} posts/week`);
                if (q.blogPerWeek > 0) parts.push(`${q.blogPerWeek} blogs/week`);
                if (q.songPerWeek > 0) parts.push(`${q.songPerWeek} songs/audio per week`);
                planningContext.content_capacity = parts.join(', ');
              }
              if (typeof window !== 'undefined') {
                sessionStorage.setItem(`campaign_planning_context_${campaign.id}`, JSON.stringify(planningContext));
              }
              const regRes = await fetchWithAuth('/api/campaigns/regenerate-blueprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  campaignId: campaign.id,
                  companyId: effectiveCompanyId,
                  planningContext,
                }),
              });
              if (!regRes.ok) {
                const errData = await regRes.json().catch(() => ({}));
                const msg = errData?.message || errData?.error || regRes.statusText || 'Blueprint generation failed';
                setBlueprintRegenerateFailedMsg(msg);
                if (typeof window !== 'undefined') {
                  sessionStorage.setItem(`campaign_blueprint_failed_${campaign.id}`, msg);
                }
                setShowAIChat(true);
              } else {
                setBlueprintRegenerateFailedMsg(null);
                setBlueprintGeneratedSuccess(true);
                setTimeout(() => setBlueprintGeneratedSuccess(false), 6000);
                clearWizardState(campaign.id);
                setShowAIChat(true);
              }
            } catch (regErr: unknown) {
              console.error('Auto-regenerate blueprint failed', regErr);
              const msg = regErr instanceof Error ? regErr.message : 'Blueprint generation failed';
              setBlueprintRegenerateFailedMsg(msg);
              if (typeof window !== 'undefined') {
                sessionStorage.setItem(`campaign_blueprint_failed_${campaign.id}`, msg);
              }
              setShowAIChat(true);
            }
            await loadCampaignDetails(campaign.id);
          } else if (data?.status === 'NEGOTIATE' || data?.status === 'REJECTED') {
            setPrePlanningResult(
              (prePlanningResult
                ? {
                    ...prePlanningResult,
                    status: data.status,
                    explanation_summary: data.message || prePlanningResult.explanation_summary,
                    recommended_duration:
                      data.min_weeks_required ?? data.max_weeks_allowed ?? prePlanningResult.recommended_duration,
                    blocking_constraints: data.blocking_constraints ?? prePlanningResult.blocking_constraints ?? [],
                    limiting_constraints: data.limiting_constraints ?? prePlanningResult.limiting_constraints ?? [],
                    trade_off_options: data.trade_off_options ?? prePlanningResult.trade_off_options ?? [],
                  }
                : null) as any
            );
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.message || errData?.error || 'Failed to update duration';
          setBlueprintRegenerateFailedMsg(msg);
          notify('error', msg);
        }
      } catch (err) {
        console.error('Update duration failed', err);
        setBlueprintRegenerateFailedMsg(err instanceof Error ? err.message : 'Update duration failed');
        notify('error', err instanceof Error ? err.message : 'Update duration failed');
      } finally {
        setPrePlanningLoading(false);
      }
    },
    [
      campaign,
      crossPlatformSharingEnabled,
      effectiveCompanyId,
      loadCampaignDetails,
      notify,
      plannedStartDate,
      prePlanningResult,
      questionnaireAnswers,
      setBlueprintGeneratedSuccess,
      setBlueprintRegenerateFailedMsg,
      setPrePlanningLoading,
      setPrePlanningResult,
      setShowAIChat,
    ],
  );

  return {
    fetchAiDurationSuggestion,
    runPrePlanningFlow,
    acceptDuration,
  };
}
