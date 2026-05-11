import { useEffect, useMemo } from 'react';
import type { AIProvider } from './types';
import { CAMPAIGN_AI_PROVIDER_KEY, type AIChatProps } from './types';
import { getFirstQuestion, getFirstUnansweredGatherKey, hasAnsweredPlanningKey } from './planningWelcomeHelpers';
import { loadCampaignLearnings } from './campaignChatStorage';
import { useCampaignAiInsightOps } from './useCampaignAiInsightOps';
import { useCampaignAiOps } from './useCampaignAiOps';
import { useCampaignAiPlanningCatalog } from './useCampaignAiPlanningCatalog';
import { useCampaignAiThreadBootstrap } from './useCampaignAiThreadBootstrap';

type ExternalDataArgs = {
  props: AIChatProps;
  selectedProvider: AIProvider;
  setSelectedProvider: (provider: AIProvider) => void;
  messages: any[];
  setMessages: (value: any) => void;
  setUiErrorMessage: (message: string | null) => void;
  setCampaignLearnings: (value: any) => void;
  setHasGeneratedPlanInSession: (value: boolean) => void;
  setReviewWeekNumber: (value: number) => void;
  setReplaceMode: (value: boolean) => void;
  setReplaceSelection: (value: { week: number; text: string } | null) => void;
  setLastCollectedPlanningContextFromApi: (value: Record<string, unknown> | null) => void;
  setRetrievePlanData: (value: any) => void;
  setIsRetrievePlanLoading: (value: boolean) => void;
  setIsAdmin: (value: boolean) => void;
  state: {
    structuredPlan: any;
    retrievePlanData: any;
    planningAvailableCountsOverride: Record<string, number> | null;
    planningCapacityCountsOverride: Record<string, number> | null;
    planningPlatformContentTypePrefs: Record<string, string[]>;
    planningSelectedPlatforms: string[];
    quickPlatformContentTypes: Record<string, string[]>;
    hasProvidedPlatformContentRequests: boolean;
    planningPlatformContentRequests: Record<string, Record<string, string>>;
    planningCrossPlatformSharingEnabled: boolean;
    planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
    hasProvidedExclusiveCampaigns: boolean;
    planningExclusiveCampaigns: Array<{ platform: string; content_type: string; count_per_week: string }>;
    lastCollectedPlanningContextFromApi: Record<string, unknown> | null;
    freshThreadAppliedRef: React.MutableRefObject<Set<string>>;
    autoTriggerPlanRef: React.MutableRefObject<boolean>;
  };
  setters: {
    setPlanningSelectedPlatforms: (value: string[]) => void;
    setPlanningPlatformContentRequests: (value: Record<string, Record<string, string>>) => void;
    setPlanningCrossPlatformSharingEnabled: (value: boolean) => void;
    setPlanningCrossPlatformScheduleMode: (value: 'same_time' | 'staggered' | 'ai_recommended') => void;
  };
};

export function useCampaignAIExternalData({
  props,
  selectedProvider,
  setSelectedProvider,
  messages,
  setMessages,
  setUiErrorMessage,
  setCampaignLearnings,
  setHasGeneratedPlanInSession,
  setReviewWeekNumber,
  setReplaceMode,
  setReplaceSelection,
  setLastCollectedPlanningContextFromApi,
  setRetrievePlanData,
  setIsRetrievePlanLoading,
  setIsAdmin,
  state,
  setters,
}: ExternalDataArgs) {
  const {
    isOpen, context = 'general', companyId, campaignId, campaignData, recommendationContext,
    initialPlan, prefilledPlanning, collectedPlanningContext, forceFreshPlanningThread = false,
  } = props;

  const resolvedCompanyId = useMemo(() => {
    if (companyId) return companyId;
    if (typeof window === 'undefined') return '';
    try {
      const urlCompanyId = new URL(window.location.href).searchParams.get('companyId');
      if (urlCompanyId) return urlCompanyId;
    } catch {
      // ignore
    }
    const fromCampaign = String((campaignData as any)?.company_id ?? (campaignData as any)?.companyId ?? '').trim();
    if (fromCampaign) return fromCampaign;
    return '';
  }, [companyId, campaignData]);

  const planningCatalog = useCampaignAiPlanningCatalog({ resolvedCompanyId });

  const ops = useCampaignAiOps({
    activeTab: (state as any).activeTab,
    campaignId,
    resolvedCompanyId,
    onError: (message) => setUiErrorMessage(message),
  });

  const insightOps = useCampaignAiInsightOps({
    activeTab: (state as any).activeTab,
    campaignId,
    resolvedCompanyId,
    onError: (message) => setUiErrorMessage(message),
    loadContentAssets: ops.loadContentAssets,
    setHealthReport: (value) => ops.setHealthReport(value),
  });

  const buildCollectedPlanningContextForApi = () => ({
    recommendationContext,
    structuredPlan: state.structuredPlan,
    prefilledPlanning,
    collectedPlanningContext,
    planningAvailableCountsOverride: state.planningAvailableCountsOverride,
    planningCapacityCountsOverride: state.planningCapacityCountsOverride,
    configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
    planningPlatformContentTypePrefs: state.planningPlatformContentTypePrefs,
    planningSelectedPlatforms: state.planningSelectedPlatforms,
    quickPlatformContentTypes: state.quickPlatformContentTypes,
    hasProvidedPlatformContentRequests: state.hasProvidedPlatformContentRequests,
    planningPlatformContentRequests: state.planningPlatformContentRequests,
    eligiblePlanningTypes: (state as any).eligiblePlanningTypes,
    planningCrossPlatformSharingEnabled: state.planningCrossPlatformSharingEnabled,
    planningCrossPlatformScheduleMode: state.planningCrossPlatformScheduleMode,
    hasProvidedExclusiveCampaigns: state.hasProvidedExclusiveCampaigns,
    planningExclusiveCampaigns: state.planningExclusiveCampaigns,
  });

  const hasAnsweredPlanningKeyValue = (key: string) =>
    hasAnsweredPlanningKey({
      key,
      prefilledPlanning,
      collectedPlanningContext,
      lastCollectedPlanningContextFromApi: state.lastCollectedPlanningContextFromApi,
      buildCollectedPlanningContextForApi,
      planningSelectedPlatforms: state.planningSelectedPlatforms,
      configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
      planningPlatformContentRequests: state.planningPlatformContentRequests,
      hasProvidedExclusiveCampaigns: state.hasProvidedExclusiveCampaigns,
      planningAvailableCountsOverride: state.planningAvailableCountsOverride,
      planningCapacityCountsOverride: state.planningCapacityCountsOverride,
    });

  const getFirstUnansweredGatherKeyValue = () => getFirstUnansweredGatherKey(hasAnsweredPlanningKeyValue);

  useEffect(() => {
    console.log('CampaignAIChat props:', { isOpen, context, campaignId, hasCampaignData: !!campaignData });
  }, [isOpen, context, campaignId, campaignData]);

  useCampaignAiThreadBootstrap({
    campaignId,
    campaignData,
    context,
    recommendationContext,
    initialPlan,
    prefilledPlanning,
    collectedPlanningContext,
    forceFreshPlanningThread,
    configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
    getFirstUnansweredGatherKey: getFirstUnansweredGatherKeyValue,
    hasAnsweredPlanningKey: hasAnsweredPlanningKeyValue,
    getFirstQuestion,
    autoTriggerPlanRef: state.autoTriggerPlanRef,
    freshThreadAppliedRef: state.freshThreadAppliedRef,
    selectedProvider,
    getProviderName: (provider: AIProvider) => (provider === 'demo' ? 'Demo AI' : 'AI Assistant'),
    planningSelectedPlatforms: state.planningSelectedPlatforms,
    setPlanningSelectedPlatforms: setters.setPlanningSelectedPlatforms,
    setPlanningPlatformContentRequests: setters.setPlanningPlatformContentRequests,
    setPlanningCrossPlatformSharingEnabled: setters.setPlanningCrossPlatformSharingEnabled,
    setPlanningCrossPlatformScheduleMode: setters.setPlanningCrossPlatformScheduleMode,
    setMessages,
  });

  useEffect(() => {
    setHasGeneratedPlanInSession(false);
    setReviewWeekNumber(1);
    setReplaceMode(false);
    setReplaceSelection(null);
    setLastCollectedPlanningContextFromApi(null);
  }, [campaignId, context, setHasGeneratedPlanInSession, setReviewWeekNumber, setReplaceMode, setReplaceSelection, setLastCollectedPlanningContextFromApi]);

  useEffect(() => {
    if ((state as any).showPlanOverview) return;
    setReplaceMode(false);
    setReplaceSelection(null);
  }, [(state as any).showPlanOverview, setReplaceMode, setReplaceSelection]);

  useEffect(() => {
    if (context?.toLowerCase().includes('campaign-recommendations') && campaignId && messages.length > 0 && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(`campaign_chat_draft_${campaignId}_recommendations`, JSON.stringify({ messages, savedAt: new Date().toISOString() }));
      } catch (e) {
        console.warn('Could not persist recommendations chat to sessionStorage', e);
      }
    }
  }, [context, campaignId, messages]);

  useEffect(() => {
    if (!isOpen || !campaignId) {
      setRetrievePlanData(null);
      return;
    }
    let cancelled = false;
    setIsRetrievePlanLoading(true);
    fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setRetrievePlanData(data);
      })
      .catch(() => { if (!cancelled) setRetrievePlanData(null); })
      .finally(() => { if (!cancelled) setIsRetrievePlanLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, campaignId, setRetrievePlanData, setIsRetrievePlanLoading]);

  useEffect(() => {
    void loadCampaignLearnings(setCampaignLearnings);
  }, [setCampaignLearnings]);

  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, provider);
    }
  };

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, [setIsAdmin]);

  return {
    resolvedCompanyId,
    planningCatalog,
    ops,
    insightOps,
    handleProviderChange,
    hasAnsweredPlanningKeyValue,
    getFirstUnansweredGatherKeyValue,
  };
}
