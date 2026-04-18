import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../../config/featureFlags';
import { exportWizardToSaveWizardStatePayload } from '../../lib/wizard/campaignWizardAdapter';
import { createCampaignWizardStore } from '../../store/campaignWizardStore';
import {
  saveWizardState,
  type PrePlanningResult,
  type QuestionnaireAnswers,
} from '../../utils/campaignWizardStorage';

type FrequencyValidation = {
  frequency_summary?: { weekly_unique_content_required: number; total_content_required: number };
  validation?: {
    valid: boolean;
    warnings: Array<{ code: string; message: string }>;
    errors: Array<{ code: string; message: string }>;
  };
} | null;

export function usePrePlanningSupport(params: {
  campaignId?: string;
  effectiveCompanyId: string;
  questionnaireAnswers: QuestionnaireAnswers;
  requestedWeeksForPreplan: number;
  prefilledPlanning: Record<string, unknown> | null;
  crossPlatformSharingEnabled: boolean;
  prePlanningWizardStep: number;
  plannedStartDate: string;
  prePlanningResult: PrePlanningResult | null;
}) {
  const [planDurationLimit, setPlanDurationLimit] = useState<{
    max_campaign_duration_weeks?: number;
  } | null>(null);
  const [frequencyValidation, setFrequencyValidation] = useState<FrequencyValidation>(null);
  const frequencyValidationTimeoutRef = useRef<number | null>(null);
  const wizardStateDbSaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!params.effectiveCompanyId) return;
    fetchWithAuth(
      `/api/company-plan-duration-limit?companyId=${encodeURIComponent(params.effectiveCompanyId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setPlanDurationLimit(d ? { max_campaign_duration_weeks: d.max_campaign_duration_weeks } : null),
      )
      .catch(() => setPlanDurationLimit(null));
  }, [params.effectiveCompanyId]);

  useEffect(() => {
    if (!params.effectiveCompanyId || !params.campaignId) return;
    if (frequencyValidationTimeoutRef.current) {
      window.clearTimeout(frequencyValidationTimeoutRef.current);
      frequencyValidationTimeoutRef.current = null;
    }
    frequencyValidationTimeoutRef.current = window.setTimeout(() => {
      frequencyValidationTimeoutRef.current = null;
      const platforms = params.prefilledPlanning?.platforms
        ? String(params.prefilledPlanning.platforms)
            .split(',')
            .map((p: string) => p.trim())
            .filter(Boolean)
        : ['linkedin'];
      const duration = params.requestedWeeksForPreplan || 12;
      fetchWithAuth('/api/campaigns/validate-frequency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: params.effectiveCompanyId,
          duration_weeks: duration,
          platforms,
          cross_platform_sharing_enabled: params.crossPlatformSharingEnabled,
          content_mix: {
            post_per_week: params.questionnaireAnswers.postPerWeek,
            video_per_week: params.questionnaireAnswers.videoPerWeek,
            blog_per_week: params.questionnaireAnswers.blogPerWeek,
            reel_per_week: 0,
            article_per_week: 0,
            song_per_week: params.questionnaireAnswers.songPerWeek,
          },
          available_content: {
            post: params.questionnaireAnswers.availablePost,
            video: params.questionnaireAnswers.availableVideo,
            blog: params.questionnaireAnswers.availableBlog,
          },
          weekly_capacity: {
            post: params.questionnaireAnswers.postPerWeek,
            video: params.questionnaireAnswers.videoPerWeek,
            blog: params.questionnaireAnswers.blogPerWeek,
          },
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setFrequencyValidation(d || null);
          if (ENABLE_UNIFIED_CAMPAIGN_WIZARD && params.campaignId && d) {
            const store = createCampaignWizardStore(params.campaignId);
            store.setState({
              frequencySummary: d.frequency_summary,
              validation: d.validation,
            });
          }
        })
        .catch(() => setFrequencyValidation(null));
    }, 700);
    return () => {
      if (frequencyValidationTimeoutRef.current) {
        window.clearTimeout(frequencyValidationTimeoutRef.current);
        frequencyValidationTimeoutRef.current = null;
      }
    };
  }, [
    params.effectiveCompanyId,
    params.campaignId,
    params.crossPlatformSharingEnabled,
    params.questionnaireAnswers.postPerWeek,
    params.questionnaireAnswers.videoPerWeek,
    params.questionnaireAnswers.blogPerWeek,
    params.questionnaireAnswers.songPerWeek,
    params.questionnaireAnswers.availablePost,
    params.questionnaireAnswers.availableVideo,
    params.questionnaireAnswers.availableBlog,
    params.requestedWeeksForPreplan,
    params.prefilledPlanning,
  ]);

  useEffect(() => {
    if (ENABLE_UNIFIED_CAMPAIGN_WIZARD || !params.campaignId) return;
    const timeout = window.setTimeout(() => {
      saveWizardState(params.campaignId!, {
        step: params.prePlanningWizardStep,
        questionnaireAnswers: params.questionnaireAnswers,
        plannedStartDate: params.plannedStartDate,
        prePlanningResult: params.prePlanningResult as any,
        crossPlatformSharingEnabled: params.crossPlatformSharingEnabled,
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    params.campaignId,
    params.prePlanningWizardStep,
    params.questionnaireAnswers,
    params.plannedStartDate,
    params.prePlanningResult,
    params.crossPlatformSharingEnabled,
  ]);

  useEffect(() => {
    if (!params.campaignId || !params.effectiveCompanyId) return;
    if (wizardStateDbSaveTimeoutRef.current) {
      window.clearTimeout(wizardStateDbSaveTimeoutRef.current);
      wizardStateDbSaveTimeoutRef.current = null;
    }
    wizardStateDbSaveTimeoutRef.current = window.setTimeout(() => {
      wizardStateDbSaveTimeoutRef.current = null;
      const payload = ENABLE_UNIFIED_CAMPAIGN_WIZARD
        ? exportWizardToSaveWizardStatePayload(createCampaignWizardStore(params.campaignId!).getState())
        : {
            step: params.prePlanningWizardStep,
            questionnaire_answers: params.questionnaireAnswers,
            planned_start_date: params.plannedStartDate,
            pre_planning_result: params.prePlanningResult,
            cross_platform_sharing_enabled: params.crossPlatformSharingEnabled,
            updated_at: new Date().toISOString(),
          };
      fetchWithAuth(`/api/campaigns/${encodeURIComponent(params.campaignId!)}/save-wizard-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, 5000);
    return () => {
      if (wizardStateDbSaveTimeoutRef.current) {
        window.clearTimeout(wizardStateDbSaveTimeoutRef.current);
        wizardStateDbSaveTimeoutRef.current = null;
      }
    };
  }, [
    params.campaignId,
    params.effectiveCompanyId,
    params.prePlanningWizardStep,
    params.questionnaireAnswers,
    params.plannedStartDate,
    params.prePlanningResult,
    params.crossPlatformSharingEnabled,
  ]);

  return {
    planDurationLimit,
    frequencyValidation,
  };
}
