import { useEffect } from 'react';
import { getDisplayTopic } from './chatDisplayHelpers';
import { generateDemoResponse } from './demoResponses';
import { applyLocalWeekTextReplacement } from './planTextReplacement';
import {
  buildCollectedPlanningContextForApi as buildCollectedPlanningContextForApiHelper,
  resolveWorkingDurationWeeks as resolveWorkingDurationWeeksHelper,
} from './planningContextHelpers';
import {
  convertStructuredPlanToProgram,
  updatePlanWithPlatformCustomization,
  updatePlanWithRefinedDay,
} from './structuredPlanTransforms';
import { useCampaignAiPlanPersistence } from './useCampaignAiPlanPersistence';
import { useCampaignPlanApi } from './useCampaignPlanApi';
import { useCampaignPlanCreation } from './useCampaignPlanCreation';
import { useCampaignAiQuickPick } from './useCampaignAiQuickPick';
import { useCampaignAiQuickPickState } from './useCampaignAiQuickPickState';
import { useCampaignAiSendMessage } from './useCampaignAiSendMessage';
import { useStructuredPlanScheduling } from './useStructuredPlanScheduling';
import type { AIProvider, ChatMessage } from './types';

export function useCampaignAIController(args: any) {
  const {
    props,
    state,
    planningCatalog,
    external,
  } = args;

  const {
    campaignId, isOpen, context, recommendationContext, optimizationContext, vetScope,
    campaignData, prefilledPlanning, initialPlan, collectedPlanningContext, onProgramGenerated,
  } = props;

  const {
    messages, setMessages, newMessage, setNewMessage, inputClearKey, setInputClearKey, setIsTyping,
    isLoading, setIsLoading, setUiErrorMessage, selectedProvider, modeLoading, setModeLoading,
    structuredPlan, setStructuredPlan, structuredPlanMessageId, setStructuredPlanMessageId,
    hasGeneratedPlanInSession, setHasGeneratedPlanInSession, reviewWeekNumber, setReviewWeekNumber,
    replaceMode, setReplaceMode, replaceSelection, setReplaceSelection,
    showScheduleConfirm, setShowScheduleConfirm, setIsSchedulingPlan, setUiSuccessMessage,
    hasViewedPlanMessageId, setHasViewedPlanMessageId, showPlanOverview, setShowPlanOverview,
    isSavingDraftForView, setIsSavingDraftForView, retrievePlanData, setRetrievePlanData, planSource, setPlanSource,
    setShowDateSelection, selectedPlan, setSelectedPlan, commitStartDate, setCommitStartDate,
    commitDurationWeeks, setCommitDurationWeeks, selectedQuickOptions, setSelectedQuickOptions,
    quickPickPrimaryStyles, setQuickPickPrimaryStyles, quickPickSecondaryModifiers, setQuickPickSecondaryModifiers,
    quickCustomizeMode, setQuickCustomizeMode, quickCustomizeText, setQuickCustomizeText,
    quickCustomContentType, setQuickCustomContentType, quickCustomContentCount, setQuickCustomContentCount,
    quickCustomPlatform, setQuickCustomPlatform, hideQuickPickPanel, setHideQuickPickPanel,
    quickPickBackIndex, setQuickPickBackIndex, quickPickReplaceTruncateToRef, isNavigatingBackRef,
    quickDateYear, setQuickDateYear, quickDateMonth, setQuickDateMonth, quickDateDay, setQuickDateDay,
    quickCapacityCounts, setQuickCapacityCounts, planningAvailableCountsOverride, setPlanningAvailableCountsOverride,
    planningCapacityCountsOverride, setPlanningCapacityCountsOverride, quickCapacityCreationMode, setQuickCapacityCreationMode,
    showAllTypeCounters, setShowAllTypeCounters, planningSelectedPlatforms, setPlanningSelectedPlatforms,
    quickPlatformContentTypes, setQuickPlatformContentTypes, planningPlatformContentTypePrefs, setPlanningPlatformContentTypePrefs,
    planningPlatformContentRequests, setPlanningPlatformContentRequests, hasProvidedPlatformContentRequests, setHasProvidedPlatformContentRequests,
    planningCrossPlatformSharingEnabled, setPlanningCrossPlatformSharingEnabled, planningCrossPlatformScheduleMode, setPlanningCrossPlatformScheduleMode,
    showAllPlatformRequestTypes, setShowAllPlatformRequestTypes, planningAvailableTypeHints, setPlanningAvailableTypeHints,
    planningCapacityTypeHints, setPlanningCapacityTypeHints, planningExclusiveCampaigns, setPlanningExclusiveCampaigns,
    hasProvidedExclusiveCampaigns, setHasProvidedExclusiveCampaigns, lastCollectedPlanningContextFromApi, setLastCollectedPlanningContextFromApi,
    inputRef, messagesEndRef, planAbortRef, autoTriggerPlanRef, sendMessageRef, isBusy, pendingAmendment, setPendingAmendment,
  } = state;

  const resolvedCompanyId = external.resolvedCompanyId;
  const getProviderName = (provider: AIProvider) => (provider === 'demo' ? 'Demo AI' : 'AI Assistant');

  const resolveWorkingDurationWeeks = () =>
    resolveWorkingDurationWeeksHelper({
      structuredPlan,
      retrievePlanData,
      initialPlan,
      prefilledPlanning: (prefilledPlanning as { campaign_duration?: number } | null | undefined) ?? null,
      campaignData: (campaignData as { duration_weeks?: number } | null | undefined) ?? null,
    });

  const buildCollectedPlanningContextForApi = () =>
    buildCollectedPlanningContextForApiHelper({
      recommendationContext: recommendationContext as { context_payload?: Record<string, unknown> | null } | null | undefined,
      structuredPlan,
      prefilledPlanning: (prefilledPlanning as Record<string, unknown> | null | undefined) ?? null,
      collectedPlanningContext: (collectedPlanningContext as Record<string, unknown> | null | undefined) ?? null,
      campaignData: (campaignData as Record<string, unknown> | null | undefined) ?? null,
      planningAvailableCountsOverride,
      planningCapacityCountsOverride,
      configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
      planningPlatformContentTypePrefs,
      planningSelectedPlatforms,
      quickPlatformContentTypes,
      hasProvidedPlatformContentRequests,
      planningPlatformContentRequests,
      eligiblePlanningTypes: undefined as any,
      planningCrossPlatformSharingEnabled,
      planningCrossPlatformScheduleMode,
      hasProvidedExclusiveCampaigns,
      planningExclusiveCampaigns,
    });

  const create12WeekPlan = useCampaignPlanCreation({
    campaignId,
    isOpen,
    context,
    selectedPlan,
    generateDefaultPlan: () => `Social Media Campaign Plan\n\nWeeks 1-3: Foundation & Brand Awareness\n- Establish brand voice and visual identity\n- Create foundational content themes\n- Build initial audience engagement\n- Focus on educational and value-driven content\n\nWeeks 4-6: Content Diversification\n- Introduce user-generated content\n- Implement storytelling strategies\n- Add interactive elements (polls, Q&As)\n- Cross-platform content adaptation\n\nWeeks 7-9: Community Building\n- Foster deeper audience connections\n- Launch community challenges\n- Feature customer testimonials\n- Engage with trending topics\n\nWeeks 10-12: Optimization & Growth\n- Analyze performance metrics\n- Refine top-performing content\n- Scale successful strategies\n- Prepare for next campaign phase\n\nThis comprehensive approach ensures consistent growth and engagement across all platforms.`,
    selectedProvider,
    resolvedCompanyId,
    structuredPlan,
    resolveWorkingDurationWeeks,
    getProviderName,
    setIsLoading,
    setRetrievePlanData,
    setMessages,
    setShowDateSelection,
    setSelectedPlan,
  });

  const isWeeklyPlanMessage = (msg: string): boolean => {
    if (!msg || msg.length < 100) return false;
    const hasWeekStructure = /\bWeek\s+\d+/i.test(msg) || /\bWeeks\s+\d+\s*[-–]\s*\d+/i.test(msg);
    const hasPlatformOrContent = /\b(LinkedIn|Facebook|Instagram|Twitter|TikTok|YouTube|Blog|Video|Post|Carousel|Reel)\b/i.test(msg);
    return hasWeekStructure && (hasPlatformOrContent || msg.length > 500);
  };

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  const focusInputSoon = () => { setTimeout(() => inputRef.current?.focus(), 0); };
  useEffect(() => { scrollToBottom(); }, [messages]);

  const quickPickState = useCampaignAiQuickPickState({
    messages,
    quickPickBackIndex,
    platformQuickPickOptions: planningCatalog.platformQuickPickOptions,
    planDurationLimit: planningCatalog.planDurationLimit,
    hasAnsweredPlanningKey: external.hasAnsweredPlanningKeyValue,
    recommendationContext,
    prefilledPlanning,
    collectedPlanningContext,
    planningAvailableTypeHints,
    planningCapacityTypeHints,
    allCatalogContentTypeQuickPickOptions: planningCatalog.allCatalogContentTypeQuickPickOptions,
    creatorDependentQuickPickOptions: planningCatalog.creatorDependentQuickPickOptions,
    planningSelectedPlatforms,
    configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
    isNavigatingBackRef,
    quickPickReplaceTruncateToRef,
    setSelectedQuickOptions,
    setQuickPickPrimaryStyles,
    setQuickPickSecondaryModifiers,
    setQuickCustomizeMode,
    setQuickCustomizeText,
    setQuickCustomContentType,
    setQuickCustomContentCount,
    setQuickCustomPlatform,
    setHideQuickPickPanel,
    setQuickDateYear,
    setQuickDateMonth,
    setQuickDateDay,
    setQuickCapacityCounts,
    setQuickCapacityCreationMode,
    setShowAllTypeCounters,
    setQuickPlatformContentTypes,
    setQuickPickBackIndex,
    setPlanningSelectedPlatforms,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !campaignId) return;
    const isPlanning = context?.toLowerCase().includes('campaign-planning') || context?.toLowerCase().includes('12week-plan') || context?.toLowerCase().includes('blueprint-plan');
    if (!isPlanning) return;
    try {
      const formKey = `campaign_planning_form_${campaignId}`;
      window.sessionStorage.setItem(formKey, JSON.stringify({
        platformContentRequests: planningPlatformContentRequests ?? {},
        crossPlatformSharing: planningCrossPlatformSharingEnabled,
        scheduleMode: planningCrossPlatformScheduleMode,
        planningSelectedPlatforms: planningSelectedPlatforms ?? [],
      }));
    } catch (e) {
      console.warn('Could not persist planning form state', e);
    }
  }, [campaignId, context, planningPlatformContentRequests, planningCrossPlatformSharingEnabled, planningCrossPlatformScheduleMode, planningSelectedPlatforms]);

  const callCampaignPlanAPI = useCampaignPlanApi({
    campaignId,
    resolvedCompanyId,
    recommendationContext,
    optimizationContext,
    vetScope,
    lastCollectedPlanningContextFromApi,
    collectedPlanningContext: (collectedPlanningContext as Record<string, unknown> | null | undefined) ?? null,
    buildCollectedPlanningContextForApi,
  });

  const persistence = useCampaignAiPlanPersistence({
    campaignId,
    messages,
    setMessages,
    selectedProvider,
    getProviderName,
    getChatStorageKey: (id) => `campaign_chat_${context}_${id}`,
    planSource,
    onProgramGenerated,
    structuredPlan,
    setStructuredPlan,
    setStructuredPlanMessageId,
    retrievePlanData,
    setPlanSource,
    setShowPlanOverview,
    setShowPlanPreview: state.setShowPlanPreview,
    setSelectedPlan,
    setHasViewedPlanMessageId,
    setIsSavingDraftForView,
    setUiErrorMessage,
    setIsParsingSavedPlan: state.setIsParsingSavedPlan,
    commitStartDate,
    setCommitStartDate,
    prefilledPlanning,
    collectedPlanningContext,
    campaignData,
    commitDurationWeeks,
    setCommitDurationWeeks,
    setShowDateSelection,
    resolveWorkingDurationWeeks,
    convertStructuredPlanToProgram,
    create12WeekPlan,
  });

  const scheduleStructuredPlan = useStructuredPlanScheduling({
    campaignId,
    structuredPlan,
    setIsSchedulingPlan,
    setUiErrorMessage,
    setUiSuccessMessage,
    setRetrievePlanData,
    setShowScheduleConfirm,
  });

  const sendMessage = useCampaignAiSendMessage({
    newMessage, setNewMessage, quickPickConfig: quickPickState.quickPickConfig,
    platformExtractCandidates: planningCatalog.platformExtractCandidates,
    configuredPlatformKeys: planningCatalog.configuredPlatformKeys,
    setPlanningSelectedPlatforms, structuredPlan, setStructuredPlan, initialPlan, campaignId,
    messages, setMessages, saveCampaignMessage: args.saveCampaignMessage, setSelectedQuickOptions,
    setQuickCustomizeMode, setQuickCustomizeText, setQuickCustomContentType, setQuickCustomContentCount, setQuickCustomPlatform,
    setQuickDateYear, setQuickDateMonth, setQuickDateDay, setQuickCapacityCounts, setQuickCapacityCreationMode,
    setShowAllTypeCounters, setInputClearKey, setIsTyping, setIsLoading, setUiErrorMessage, selectedProvider,
    generateDemoResponse, context, campaignData, campaignLearnings: state.campaignLearnings, setModeLoading,
    callCampaignPlanAPI, collectedPlanningContext: (collectedPlanningContext as Record<string, unknown> | null | undefined) ?? null,
    vetScope, planAbortRef, setLastCollectedPlanningContextFromApi, setStructuredPlanMessageId, setHasGeneratedPlanInSession,
    setPlanSource, setHasViewedPlanMessageId, serializeStructuredPlanToText: persistence.serializeStructuredPlanToText,
    setSelectedPlan, setShowPlanOverview, setReviewWeekNumber, setPendingAmendment,
    updatePlanWithRefinedDay, updatePlanWithPlatformCustomization, getProviderName, focusInputSoon,
  });

  const quickPick = useCampaignAiQuickPick({
    isBusy, messages, setMessages, aiMessageIndices: quickPickState.aiMessageIndices, quickPickBackIndex,
    quickPickReplaceTruncateToRef, isNavigatingBackRef, selectedQuickOptions, setSelectedQuickOptions,
    quickCustomizeMode, quickCustomizeText, setQuickCustomizeMode, setQuickCustomizeText,
    quickPickPrimaryStyles, setQuickPickPrimaryStyles, quickPickSecondaryModifiers, setQuickPickSecondaryModifiers,
    quickCapacityCounts, setQuickCapacityCounts, quickCapacityCreationMode, setQuickCapacityCreationMode,
    quickDateYear, setQuickDateYear, quickDateMonth, setQuickDateMonth, quickDateDay, setQuickDateDay,
    planningSelectedPlatforms, configuredPlatformKeys: planningCatalog.configuredPlatformKeys, platformLabels: planningCatalog.platformLabels,
    platformQuickPickOptions: planningCatalog.platformQuickPickOptions, platformContentTypeOptions: planningCatalog.platformContentTypeOptions,
    eligiblePlanningTypes: quickPickState.eligiblePlanningTypes, quickPlatformContentTypes, setQuickPlatformContentTypes, setQuickPickBackIndex,
    hideQuickPickPanel, setHideQuickPickPanel, setShowAllTypeCounters, setPlanningAvailableCountsOverride, setPlanningCapacityCountsOverride,
    setPlanningAvailableTypeHints, setPlanningCapacityTypeHints, setPlanningPlatformContentTypePrefs, setPlanningCrossPlatformSharingEnabled,
    setHasProvidedPlatformContentRequests, planningExclusiveCampaigns, setHasProvidedExclusiveCampaigns, onBackToRecommendation: props.onBackToRecommendation,
    planDurationLimit: planningCatalog.planDurationLimit, setUiErrorMessage, sendMessage, scrollToBottom,
  });

  useEffect(() => { sendMessageRef.current = (msg?: string) => sendMessage(msg); });
  useEffect(() => {
    if (!autoTriggerPlanRef.current || messages.length === 0 || isLoading) return;
    autoTriggerPlanRef.current = false;
    const timer = setTimeout(() => { void sendMessageRef.current?.('Create my plan'); }, 800);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  const applyPlanOverviewReplacement = () => {
    const replacementText = newMessage.trim();
    if (!replaceSelection?.text?.trim() || !replacementText) return;
    const weekNumber = replaceSelection.week || reviewWeekNumber;
    const oldText = replaceSelection.text;
    if (!structuredPlan?.weeks?.length) {
      setUiErrorMessage('No structured plan loaded to apply edits.');
      return;
    }
    const { nextPlan, replacedCount } = applyLocalWeekTextReplacement(structuredPlan, weekNumber, oldText, replacementText);
    if (replacedCount <= 0) {
      setUiErrorMessage('Could not apply edit in plan data. Try selecting only the value (avoid selecting labels like "Audience:").');
      return;
    }
    setStructuredPlan(nextPlan);
    const userMessage: ChatMessage = { id: Date.now(), type: 'user', message: `Edit in Week ${weekNumber}: "${oldText}" -> "${replacementText}"`, timestamp: new Date().toLocaleTimeString(), campaignId };
    const aiMessage: ChatMessage = { id: Date.now() + 1, type: 'ai', message: `Applied edit locally in Week ${weekNumber}.`, timestamp: new Date().toLocaleTimeString(), provider: getProviderName(selectedProvider), campaignId };
    setMessages((prev: ChatMessage[]) => [...prev, userMessage, aiMessage]);
    try { void args.saveCampaignMessage(campaignId, userMessage); void args.saveCampaignMessage(campaignId, aiMessage); } catch {}
    setNewMessage('');
    setInputClearKey((k: number) => k + 1);
    setReplaceMode(false);
    setReplaceSelection(null);
    setUiErrorMessage(null);
    focusInputSoon();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showPlanOverview && replaceMode) {
        applyPlanOverviewReplacement();
        return;
      }
      sendMessage();
    }
  };

  const isRecsChat = context?.toLowerCase().includes('campaign-recommendations');
  const displayTopic = getDisplayTopic({
    recommendationContext: recommendationContext as { topic_from_card?: string | null } | null | undefined,
    lastCollectedPlanningContextFromApi,
    prefilledPlanning: (prefilledPlanning as Record<string, unknown> | null | undefined) ?? null,
    collectedPlanningContext: (collectedPlanningContext as Record<string, unknown> | null | undefined) ?? null,
    campaignData: (campaignData as { name?: string | null } | null | undefined) ?? null,
  });

  return {
    resolveWorkingDurationWeeks,
    buildCollectedPlanningContextForApi,
    getProviderName,
    create12WeekPlan,
    isWeeklyPlanMessage,
    quickPickState,
    persistence,
    scheduleStructuredPlan,
    sendMessage,
    quickPick,
    applyPlanOverviewReplacement,
    handleKeyPress,
    hasPreviousQuestion: quickPick.canGoBack,
    isRecsChat,
    displayTopic,
  };
}
