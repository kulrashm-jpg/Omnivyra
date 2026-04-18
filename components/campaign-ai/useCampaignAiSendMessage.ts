import { extractPlatforms, extractScopeWeeks, extractTargetDay } from './chatHelpers';
import { enrichPlanningQuestionExamples, extractDurationWeeksFromHistory, extractLastQuestionLine } from './questionHelpers';
import type {
  AIProvider,
  CampaignLearning,
  ChatMessage,
  PlatformCustomization,
  RefinedDay,
  StructuredPlan,
} from './types';

type Params = {
  newMessage: string;
  setNewMessage: (value: string) => void;
  quickPickConfig: { key?: string } | null;
  platformExtractCandidates: string[];
  configuredPlatformKeys: string[];
  setPlanningSelectedPlatforms: React.Dispatch<React.SetStateAction<string[]>>;
  structuredPlan: StructuredPlan | null;
  setStructuredPlan: React.Dispatch<React.SetStateAction<StructuredPlan | null>>;
  initialPlan?: { weeks?: any[] } | null;
  campaignId?: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  saveCampaignMessage: (campaignId: string | undefined, message: ChatMessage) => Promise<void>;
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  setQuickCustomContentType: React.Dispatch<React.SetStateAction<string>>;
  setQuickCustomContentCount: React.Dispatch<React.SetStateAction<string>>;
  setQuickCustomPlatform: React.Dispatch<React.SetStateAction<string>>;
  setQuickDateYear: React.Dispatch<React.SetStateAction<string>>;
  setQuickDateMonth: React.Dispatch<React.SetStateAction<string>>;
  setQuickDateDay: React.Dispatch<React.SetStateAction<string>>;
  setQuickCapacityCounts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setQuickCapacityCreationMode: React.Dispatch<React.SetStateAction<'' | 'manual' | 'ai-assisted' | 'full-ai'>>;
  setShowAllTypeCounters: React.Dispatch<React.SetStateAction<Record<'available_content' | 'content_capacity', boolean>>>;
  setInputClearKey: React.Dispatch<React.SetStateAction<number>>;
  setIsTyping: (value: boolean) => void;
  setIsLoading: (value: boolean) => void;
  setUiErrorMessage: (value: string | null) => void;
  selectedProvider: AIProvider;
  generateDemoResponse: (userMessage: string, context: string, campaignData: any, learnings: CampaignLearning[]) => string;
  context: string;
  campaignData: any;
  campaignLearnings: CampaignLearning[];
  setModeLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  callCampaignPlanAPI: (
    message: string,
    mode: 'generate_plan' | 'refine_day' | 'platform_customize',
    options?: {
      durationWeeks?: number;
      targetDay?: string;
      platforms?: string[];
      conversationHistory?: Array<{ type: 'user' | 'ai'; message: string }>;
      currentPlan?: { weeks: any[] };
      scopeWeeks?: number[] | null;
      chatContext?: string;
      vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
      collectedPlanningContextOverride?: Record<string, unknown>;
      planAbortRef?: React.MutableRefObject<AbortController | null>;
    }
  ) => Promise<{
    plan?: StructuredPlan;
    day?: RefinedDay;
    platform_content?: PlatformCustomization;
    conversationalResponse?: string;
    validation_result?: any;
    collectedPlanningContext?: Record<string, unknown>;
    startDateConflictWarning?: string;
  }>;
  collectedPlanningContext?: Record<string, unknown> | null;
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  planAbortRef: React.MutableRefObject<AbortController | null>;
  setLastCollectedPlanningContextFromApi: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setStructuredPlanMessageId: (value: number | null) => void;
  setHasGeneratedPlanInSession: (value: boolean) => void;
  setPlanSource: (value: 'ai' | 'committed' | 'draft') => void;
  setHasViewedPlanMessageId: (value: number | null) => void;
  serializeStructuredPlanToText: (plan: StructuredPlan) => string;
  setSelectedPlan: (value: string) => void;
  setShowPlanOverview: (value: boolean) => void;
  setReviewWeekNumber: React.Dispatch<React.SetStateAction<number>>;
  setPendingAmendment: React.Dispatch<React.SetStateAction<StructuredPlan | null>>;
  updatePlanWithRefinedDay: (plan: StructuredPlan, refinedDay: RefinedDay) => StructuredPlan;
  updatePlanWithPlatformCustomization: (plan: StructuredPlan, customization: PlatformCustomization) => StructuredPlan;
  getProviderName: (provider: AIProvider) => string;
  focusInputSoon: () => void;
};

export function useCampaignAiSendMessage(params: Params) {
  const {
    newMessage,
    setNewMessage,
    quickPickConfig,
    platformExtractCandidates,
    configuredPlatformKeys,
    setPlanningSelectedPlatforms,
    structuredPlan,
    setStructuredPlan,
    initialPlan,
    campaignId,
    messages,
    setMessages,
    saveCampaignMessage,
    setSelectedQuickOptions,
    setQuickCustomizeMode,
    setQuickCustomizeText,
    setQuickCustomContentType,
    setQuickCustomContentCount,
    setQuickCustomPlatform,
    setQuickDateYear,
    setQuickDateMonth,
    setQuickDateDay,
    setQuickCapacityCounts,
    setQuickCapacityCreationMode,
    setShowAllTypeCounters,
    setInputClearKey,
    setIsTyping,
    setIsLoading,
    setUiErrorMessage,
    selectedProvider,
    generateDemoResponse,
    context,
    campaignData,
    campaignLearnings,
    setModeLoading,
    callCampaignPlanAPI,
    collectedPlanningContext,
    vetScope,
    planAbortRef,
    setLastCollectedPlanningContextFromApi,
    setStructuredPlanMessageId,
    setHasGeneratedPlanInSession,
    setPlanSource,
    setHasViewedPlanMessageId,
    serializeStructuredPlanToText,
    setSelectedPlan,
    setShowPlanOverview,
    setReviewWeekNumber,
    setPendingAmendment,
    updatePlanWithRefinedDay,
    updatePlanWithPlatformCustomization,
    getProviderName,
    focusInputSoon,
  } = params;

  return async function sendMessage(overrideMessage?: unknown, options?: { replaceTruncateTo?: number }) {
    const safeOverride = typeof overrideMessage === 'string' ? overrideMessage : '';
    const messageText = (safeOverride || newMessage).trim();
    if (!messageText) return;

    const replaceTruncateTo = options?.replaceTruncateTo;
    if (quickPickConfig?.key === 'platforms') {
      const inferred = extractPlatforms(messageText, platformExtractCandidates);
      const filtered = (inferred ?? []).filter((platform) => configuredPlatformKeys.length === 0 || configuredPlatformKeys.includes(platform));
      if (filtered.length) setPlanningSelectedPlatforms(Array.from(new Set(filtered)));
    }

    const effectiveCurrentPlan = structuredPlan?.weeks?.length
      ? { weeks: structuredPlan.weeks }
      : initialPlan?.weeks?.length
        ? { weeks: initialPlan.weeks }
        : undefined;

    const userMessage: ChatMessage = {
      id: Date.now(),
      type: 'user',
      message: messageText,
      timestamp: new Date().toLocaleTimeString(),
      campaignId,
    };

    setMessages((prev) => {
      if (typeof replaceTruncateTo === 'number' && replaceTruncateTo >= 0) {
        return [...prev.slice(0, replaceTruncateTo), userMessage];
      }
      return [...prev, userMessage];
    });
    await saveCampaignMessage(campaignId, userMessage);
    setNewMessage('');
    setSelectedQuickOptions([]);
    setQuickCustomizeMode(false);
    setQuickCustomizeText('');
    setQuickCustomContentType('');
    setQuickCustomContentCount('');
    setQuickCustomPlatform('');
    setQuickDateYear('');
    setQuickDateMonth('');
    setQuickDateDay('');
    setQuickCapacityCounts({});
    setQuickCapacityCreationMode('');
    setShowAllTypeCounters({ available_content: false, content_capacity: false });
    setInputClearKey((value) => value + 1);
    setIsTyping(true);
    setIsLoading(true);
    setUiErrorMessage(null);

    try {
      let response = '';
      let provider: string;

      const aiResponseId = Date.now() + 1;
      const aiResponse: ChatMessage = {
        id: aiResponseId,
        type: 'ai',
        message: '',
        timestamp: new Date().toLocaleTimeString(),
        provider: '',
        campaignId,
      };

      if (selectedProvider === 'demo') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        response = generateDemoResponse(messageText, context, campaignData, campaignLearnings);
        provider = 'Demo AI';
        aiResponse.message = response;
        aiResponse.provider = provider;
        setMessages((prev) => [...prev, aiResponse]);
        await saveCampaignMessage(campaignId, aiResponse);
      } else if (selectedProvider === 'gpt' || selectedProvider === 'claude') {
        provider = 'AI Assistant';
        aiResponse.provider = provider;
        setMessages((prev) => [...prev, aiResponse]);

        const mode = context.toLowerCase().includes('daily')
          ? 'refine_day'
          : context.toLowerCase().includes('campaign-planning') ||
              context.toLowerCase().includes('12week-plan') ||
              context.toLowerCase().includes('blueprint-plan') ||
              context.toLowerCase().includes('campaign-recommendations')
            ? 'generate_plan'
            : 'platform_customize';

        setModeLoading((prev) => ({ ...prev, [mode]: true }));

        const targetDay = extractTargetDay(messageText);
        const platforms = extractPlatforms(messageText, platformExtractCandidates);
        const baseMessages = typeof replaceTruncateTo === 'number' && replaceTruncateTo >= 0 ? messages.slice(0, replaceTruncateTo) : messages;
        const conversationHistory = [...baseMessages, userMessage].map((message) => ({
          type: message.type as 'user' | 'ai',
          message: message.message,
        }));
        const userAgreedDuration =
          extractDurationWeeksFromHistory(conversationHistory) ??
          (typeof (collectedPlanningContext?.campaign_duration as number) === 'number'
            ? (collectedPlanningContext?.campaign_duration as number)
            : undefined);

        const totalWeeks = campaignData?.duration_weeks ?? effectiveCurrentPlan?.weeks?.length ?? 12;
        const scopeWeeks = effectiveCurrentPlan && mode === 'generate_plan' ? extractScopeWeeks(messageText, totalWeeks) : null;
        const planResponse = await callCampaignPlanAPI(messageText, mode, {
          durationWeeks: mode === 'generate_plan' ? userAgreedDuration : undefined,
          targetDay: mode !== 'generate_plan' ? targetDay : undefined,
          platforms: mode === 'platform_customize' ? platforms : undefined,
          conversationHistory: mode === 'generate_plan' ? conversationHistory : undefined,
          currentPlan: effectiveCurrentPlan,
          scopeWeeks: scopeWeeks ?? undefined,
          chatContext: context?.toLowerCase().includes('campaign-recommendations') ? 'campaign-recommendations' : undefined,
          vetScope,
          planAbortRef,
        });

        if (planResponse.collectedPlanningContext && typeof planResponse.collectedPlanningContext === 'object') {
          setLastCollectedPlanningContextFromApi((prev) => ({ ...(prev ?? {}), ...planResponse.collectedPlanningContext }));
        }

        if (planResponse.plan) {
          setStructuredPlan(planResponse.plan);
          setStructuredPlanMessageId(aiResponseId);
          setHasGeneratedPlanInSession(true);
          setPlanSource('ai');
          setHasViewedPlanMessageId(aiResponseId);
          setSelectedPlan(serializeStructuredPlanToText(planResponse.plan));
          setShowPlanOverview(true);
          setReviewWeekNumber((prev) => {
            const maxWeeks = Array.isArray(planResponse.plan?.weeks) ? planResponse.plan.weeks.length : 0;
            if (Number.isFinite(prev) && prev >= 1 && prev <= maxWeeks) return prev;
            return 1;
          });
          const isRefineMode = !!effectiveCurrentPlan?.weeks?.length;
          if (isRefineMode) {
            setPendingAmendment(planResponse.plan);
            response = 'Changes applied to your plan. Review below and click **Amend** when ready to save all changes.';
          } else {
            setPendingAmendment(null);
            response =
              'Structured plan generated.\n\n**Review your week plan below.** When ready: **Save & view on campaign** to see it on the campaign page, **Save for Later** to keep a copy, or **Submit This Plan** to commit.';
          }
        } else if (planResponse.conversationalResponse) {
          response = enrichPlanningQuestionExamples(planResponse.conversationalResponse);
          if (planResponse.startDateConflictWarning) {
            response += '\n\n' + planResponse.startDateConflictWarning;
          }
        } else if (planResponse.day) {
          setStructuredPlan((prev) => (prev ? updatePlanWithRefinedDay(prev, planResponse.day as RefinedDay) : prev));
          response = `Updated ${planResponse.day.day} for week ${planResponse.day.week}.`;
        } else if (planResponse.platform_content) {
          setStructuredPlan((prev) =>
            prev ? updatePlanWithPlatformCustomization(prev, planResponse.platform_content as PlatformCustomization) : prev
          );
          response = `Updated platform versions for ${planResponse.platform_content.day}.`;
        } else {
          setUiErrorMessage('We did not receive a structured response. Please try again.');
          response = 'No structured response received.';
        }

        if (planResponse.startDateConflictWarning && response) {
          response += '\n\n' + planResponse.startDateConflictWarning;
        }

        setMessages((prev) => prev.map((message) => (message.id === aiResponseId ? { ...message, message: response } : message)));
        await saveCampaignMessage(campaignId, { ...aiResponse, message: response });
        setModeLoading((prev) => ({ ...prev, [mode]: false }));
      } else {
        throw new Error('Invalid provider');
      }

      setIsTyping(false);
      setIsLoading(false);
      focusInputSoon();
    } catch (error) {
      console.error('Error calling AI API:', error);
      const err = error as { name?: string; message?: string };
      const isAbort = err?.name === 'AbortError' || (typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted'));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isSchemaError =
        !isAbort && (errorMessage.toLowerCase().includes('schema') || errorMessage.toLowerCase().includes('validation'));
      setUiErrorMessage(
        isAbort
          ? 'Plan generation is taking longer than expected. You can try again with a shorter duration (e.g. 4 weeks) or try again in a moment.'
          : isSchemaError
            ? 'We could not parse the AI response. Please try again.'
            : 'We could not complete that request. Please try again in a moment.'
      );
      const lastAssistantQuestion = [...messages].reverse().find((message) => message.type === 'ai' && message.provider !== 'Error' && message.message)?.message || '';
      const isAtConfirmationStep =
        /create your (week )?plan now|would you like me to create|I have everything I need/i.test(lastAssistantQuestion);
      const timeoutMessage = isAbort && isAtConfirmationStep
        ? 'That took too long - no worries. Pick a duration below and click **Submit** to try again (fewer weeks is quicker). Your last choices are remembered so you can also say **continue** to use the same settings.'
        : isAbort
          ? 'Plan generation timed out. Try a shorter duration (e.g. 4 weeks) or say **continue** to retry with the same settings.'
          : null;
      const errorResponse: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message:
          timeoutMessage ??
          (isAbort
            ? 'Plan generation timed out. Try a shorter duration (e.g. 4 weeks) or retry in a moment.'
            : `Sorry, I encountered an error with ${selectedProvider.toUpperCase()}. Please check your API key and try again.`),
        timestamp: new Date().toLocaleTimeString(),
        provider: 'Error',
        campaignId,
      };
      const repeatedQuestion = extractLastQuestionLine(lastAssistantQuestion);
      const shouldNotRepeatQuestion = isAtConfirmationStep && isAbort;
      const continuationMessage: ChatMessage | null =
        shouldNotRepeatQuestion || !repeatedQuestion
          ? null
          : {
              id: Date.now() + 2,
              type: 'ai',
              message: `Let's continue.\n\n${enrichPlanningQuestionExamples(repeatedQuestion)}`,
              timestamp: new Date().toLocaleTimeString(),
              provider: getProviderName(selectedProvider),
              campaignId,
            };
      setMessages((prev) => (continuationMessage ? [...prev, errorResponse, continuationMessage] : [...prev, errorResponse]));
      setIsTyping(false);
      setIsLoading(false);
      setModeLoading({});
      focusInputSoon();
    }
  };
}
