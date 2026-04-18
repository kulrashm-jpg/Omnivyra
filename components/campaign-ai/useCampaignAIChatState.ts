import { useRef, useState } from 'react';
import { getStoredProvider, type AIProvider, type CampaignLearning, type ChatMessage, type StructuredPlan } from './types';

export function useCampaignAIChatState() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [inputClearKey, setInputClearKey] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(getStoredProvider);
  const [isLoading, setIsLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState<Record<string, boolean>>({});
  const [uiErrorMessage, setUiErrorMessage] = useState<string | null>(null);
  const [campaignLearnings, setCampaignLearnings] = useState<CampaignLearning[]>([]);
  const [showDateSelection, setShowDateSelection] = useState(false);
  const [commitStartDate, setCommitStartDate] = useState('');
  const [commitDurationWeeks, setCommitDurationWeeks] = useState(12);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [showPlanPreview, setShowPlanPreview] = useState(false);
  const [structuredPlan, setStructuredPlan] = useState<StructuredPlan | null>(null);
  const [structuredPlanMessageId, setStructuredPlanMessageId] = useState<number | null>(null);
  const [hasGeneratedPlanInSession, setHasGeneratedPlanInSession] = useState(false);
  const [reviewWeekNumber, setReviewWeekNumber] = useState<number>(1);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceSelection, setReplaceSelection] = useState<{ week: number; text: string } | null>(null);
  const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
  const [isSchedulingPlan, setIsSchedulingPlan] = useState(false);
  const [uiSuccessMessage, setUiSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'audit' | 'execution' | 'content' | 'performance' | 'memory' | 'business' | 'platform'>('chat');
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasViewedPlanMessageId, setHasViewedPlanMessageId] = useState<number | null>(null);
  const [showPlanOverview, setShowPlanOverview] = useState(false);
  const [pendingAmendment, setPendingAmendment] = useState<StructuredPlan | null>(null);
  const [isSavingDraftForView, setIsSavingDraftForView] = useState(false);
  const [retrievePlanData, setRetrievePlanData] = useState<{ savedPlan?: { content: string; savedAt: string }; committedPlan?: { weeks: any[] }; draftPlan?: { weeks: any[]; savedAt: string } } | null>(null);
  const [planSource, setPlanSource] = useState<'ai' | 'committed' | 'draft'>('ai');
  const [isRetrievePlanLoading, setIsRetrievePlanLoading] = useState(false);
  const [isParsingSavedPlan, setIsParsingSavedPlan] = useState(false);
  const [selectedQuickOptions, setSelectedQuickOptions] = useState<string[]>([]);
  const [quickPickPrimaryStyles, setQuickPickPrimaryStyles] = useState<string[]>([]);
  const [quickPickSecondaryModifiers, setQuickPickSecondaryModifiers] = useState<string[]>([]);
  const [quickCustomizeMode, setQuickCustomizeMode] = useState(false);
  const [quickCustomizeText, setQuickCustomizeText] = useState('');
  const [quickCustomContentType, setQuickCustomContentType] = useState('');
  const [quickCustomContentCount, setQuickCustomContentCount] = useState('');
  const [quickCustomPlatform, setQuickCustomPlatform] = useState('');
  const [hideQuickPickPanel, setHideQuickPickPanel] = useState(false);
  const [quickPickBackIndex, setQuickPickBackIndex] = useState(0);
  const quickPickReplaceTruncateToRef = useRef<number | null>(null);
  const isNavigatingBackRef = useRef(false);
  const [quickDateYear, setQuickDateYear] = useState('');
  const [quickDateMonth, setQuickDateMonth] = useState('');
  const [quickDateDay, setQuickDateDay] = useState('');
  const [quickCapacityCounts, setQuickCapacityCounts] = useState<Record<string, string>>({});
  const [planningAvailableCountsOverride, setPlanningAvailableCountsOverride] = useState<Record<string, number> | null>(null);
  const [planningCapacityCountsOverride, setPlanningCapacityCountsOverride] = useState<Record<string, number> | null>(null);
  const [quickCapacityCreationMode, setQuickCapacityCreationMode] = useState<'' | 'manual' | 'ai-assisted' | 'full-ai'>('');
  const [showAllTypeCounters, setShowAllTypeCounters] = useState<Record<'available_content' | 'content_capacity', boolean>>({
    available_content: false,
    content_capacity: false,
  });
  const [planningSelectedPlatforms, setPlanningSelectedPlatforms] = useState<string[]>([]);
  const [quickPlatformContentTypes, setQuickPlatformContentTypes] = useState<Record<string, string[]>>({});
  const [planningPlatformContentTypePrefs, setPlanningPlatformContentTypePrefs] = useState<Record<string, string[]>>({});
  const [planningPlatformContentRequests, setPlanningPlatformContentRequests] = useState<Record<string, Record<string, string>>>({});
  const [hasProvidedPlatformContentRequests, setHasProvidedPlatformContentRequests] = useState(false);
  const [planningCrossPlatformSharingEnabled, setPlanningCrossPlatformSharingEnabled] = useState(true);
  const [planningCrossPlatformScheduleMode, setPlanningCrossPlatformScheduleMode] = useState<'same_time' | 'staggered' | 'ai_recommended'>('ai_recommended');
  const [showAllPlatformRequestTypes, setShowAllPlatformRequestTypes] = useState<Record<string, boolean>>({});
  const [planningAvailableTypeHints, setPlanningAvailableTypeHints] = useState<string[]>([]);
  const [planningCapacityTypeHints, setPlanningCapacityTypeHints] = useState<string[]>([]);
  const [planningExclusiveCampaigns, setPlanningExclusiveCampaigns] = useState<Array<{ platform: string; content_type: string; count_per_week: string }>>([]);
  const [hasProvidedExclusiveCampaigns, setHasProvidedExclusiveCampaigns] = useState(false);
  const [lastCollectedPlanningContextFromApi, setLastCollectedPlanningContextFromApi] = useState<Record<string, unknown> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const freshThreadAppliedRef = useRef<Set<string>>(new Set());
  const planAbortRef = useRef<AbortController | null>(null);
  const autoTriggerPlanRef = useRef(false);
  const sendMessageRef = useRef<((override?: string) => Promise<void>) | null>(null);

  return {
    messages, setMessages,
    newMessage, setNewMessage,
    inputClearKey, setInputClearKey,
    isTyping, setIsTyping,
    showSettings, setShowSettings,
    showLearning, setShowLearning,
    isFullscreen, setIsFullscreen,
    selectedProvider, setSelectedProvider,
    isLoading, setIsLoading,
    modeLoading, setModeLoading,
    uiErrorMessage, setUiErrorMessage,
    campaignLearnings, setCampaignLearnings,
    showDateSelection, setShowDateSelection,
    commitStartDate, setCommitStartDate,
    commitDurationWeeks, setCommitDurationWeeks,
    selectedPlan, setSelectedPlan,
    showPlanPreview, setShowPlanPreview,
    structuredPlan, setStructuredPlan,
    structuredPlanMessageId, setStructuredPlanMessageId,
    hasGeneratedPlanInSession, setHasGeneratedPlanInSession,
    reviewWeekNumber, setReviewWeekNumber,
    replaceMode, setReplaceMode,
    replaceSelection, setReplaceSelection,
    showScheduleConfirm, setShowScheduleConfirm,
    isSchedulingPlan, setIsSchedulingPlan,
    uiSuccessMessage, setUiSuccessMessage,
    activeTab, setActiveTab,
    isAdmin, setIsAdmin,
    hasViewedPlanMessageId, setHasViewedPlanMessageId,
    showPlanOverview, setShowPlanOverview,
    pendingAmendment, setPendingAmendment,
    isSavingDraftForView, setIsSavingDraftForView,
    retrievePlanData, setRetrievePlanData,
    planSource, setPlanSource,
    isRetrievePlanLoading, setIsRetrievePlanLoading,
    isParsingSavedPlan, setIsParsingSavedPlan,
    selectedQuickOptions, setSelectedQuickOptions,
    quickPickPrimaryStyles, setQuickPickPrimaryStyles,
    quickPickSecondaryModifiers, setQuickPickSecondaryModifiers,
    quickCustomizeMode, setQuickCustomizeMode,
    quickCustomizeText, setQuickCustomizeText,
    quickCustomContentType, setQuickCustomContentType,
    quickCustomContentCount, setQuickCustomContentCount,
    quickCustomPlatform, setQuickCustomPlatform,
    hideQuickPickPanel, setHideQuickPickPanel,
    quickPickBackIndex, setQuickPickBackIndex,
    quickPickReplaceTruncateToRef,
    isNavigatingBackRef,
    quickDateYear, setQuickDateYear,
    quickDateMonth, setQuickDateMonth,
    quickDateDay, setQuickDateDay,
    quickCapacityCounts, setQuickCapacityCounts,
    planningAvailableCountsOverride, setPlanningAvailableCountsOverride,
    planningCapacityCountsOverride, setPlanningCapacityCountsOverride,
    quickCapacityCreationMode, setQuickCapacityCreationMode,
    showAllTypeCounters, setShowAllTypeCounters,
    planningSelectedPlatforms, setPlanningSelectedPlatforms,
    quickPlatformContentTypes, setQuickPlatformContentTypes,
    planningPlatformContentTypePrefs, setPlanningPlatformContentTypePrefs,
    planningPlatformContentRequests, setPlanningPlatformContentRequests,
    hasProvidedPlatformContentRequests, setHasProvidedPlatformContentRequests,
    planningCrossPlatformSharingEnabled, setPlanningCrossPlatformSharingEnabled,
    planningCrossPlatformScheduleMode, setPlanningCrossPlatformScheduleMode,
    showAllPlatformRequestTypes, setShowAllPlatformRequestTypes,
    planningAvailableTypeHints, setPlanningAvailableTypeHints,
    planningCapacityTypeHints, setPlanningCapacityTypeHints,
    planningExclusiveCampaigns, setPlanningExclusiveCampaigns,
    hasProvidedExclusiveCampaigns, setHasProvidedExclusiveCampaigns,
    lastCollectedPlanningContextFromApi, setLastCollectedPlanningContextFromApi,
    messagesEndRef,
    inputRef,
    freshThreadAppliedRef,
    planAbortRef,
    autoTriggerPlanRef,
    sendMessageRef,
    isBusy: isLoading || isSchedulingPlan,
  };
}
