import { useEffect, useMemo } from 'react';
import {
  CREATOR_DEPENDENT_PLANNING_LABELS,
  canonicalPlanningTypeLabel,
  computeEligiblePlanningTypeSet,
  extractPlanningTypeHintsFromCapacityValue,
} from './planningCatalog';
import { getQuickPickConfig as getExternalQuickPickConfig } from './quickPickConfig';
import { allowOnlyGatherConfig, extractQuestionCandidate } from './chatHelpers';
import type { ChatMessage, QuickPickConfig } from './types';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type Params = {
  messages: ChatMessage[];
  quickPickBackIndex: number;
  platformQuickPickOptions: string[];
  planDurationLimit?: { max_campaign_duration_weeks?: number | null } | null;
  hasAnsweredPlanningKey: (key: string) => boolean;
  recommendationContext?: { context_payload?: Record<string, unknown> | null } | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  planningAvailableTypeHints: string[];
  planningCapacityTypeHints: string[];
  allCatalogContentTypeQuickPickOptions: string[];
  creatorDependentQuickPickOptions: string[];
  planningSelectedPlatforms: string[];
  configuredPlatformKeys: string[];
  isNavigatingBackRef: React.MutableRefObject<boolean>;
  quickPickReplaceTruncateToRef: React.MutableRefObject<number | null>;
  setSelectedQuickOptions: Setter<string[]>;
  setQuickPickPrimaryStyles: Setter<string[]>;
  setQuickPickSecondaryModifiers: Setter<string[]>;
  setQuickCustomizeMode: Setter<boolean>;
  setQuickCustomizeText: Setter<string>;
  setQuickCustomContentType: Setter<string>;
  setQuickCustomContentCount: Setter<string>;
  setQuickCustomPlatform: Setter<string>;
  setHideQuickPickPanel: Setter<boolean>;
  setQuickDateYear: Setter<string>;
  setQuickDateMonth: Setter<string>;
  setQuickDateDay: Setter<string>;
  setQuickCapacityCounts: Setter<Record<string, string>>;
  setQuickCapacityCreationMode: Setter<'' | 'manual' | 'ai-assisted' | 'full-ai'>;
  setShowAllTypeCounters: Setter<Record<'available_content' | 'content_capacity', boolean>>;
  setQuickPlatformContentTypes: Setter<Record<string, string[]>>;
  setQuickPickBackIndex: Setter<number>;
  setPlanningSelectedPlatforms: Setter<string[]>;
};

export function useCampaignAiQuickPickState({
  messages,
  quickPickBackIndex,
  platformQuickPickOptions,
  planDurationLimit,
  hasAnsweredPlanningKey,
  recommendationContext,
  prefilledPlanning,
  collectedPlanningContext,
  planningAvailableTypeHints,
  planningCapacityTypeHints,
  allCatalogContentTypeQuickPickOptions,
  creatorDependentQuickPickOptions,
  planningSelectedPlatforms,
  configuredPlatformKeys,
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
}: Params) {
  const aiMessageIndices = useMemo(
    () =>
      messages
        .map((m, i) => (m.type === 'ai' && m.message ? i : -1))
        .filter((i) => i >= 0),
    [messages]
  );

  const quickPickAiMessageId = useMemo(
    () => [...messages].reverse().find((m) => m.type === 'ai' && m.message)?.id ?? null,
    [messages]
  );

  const shouldHideTrailingAnsweredGatherPrompt = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.type !== 'ai' || !lastMessage.message) return false;
    const q = extractQuestionCandidate(String(lastMessage.message));
    const cfg = allowOnlyGatherConfig(getExternalQuickPickConfig(q, platformQuickPickOptions, planDurationLimit?.max_campaign_duration_weeks));
    return Boolean(cfg && hasAnsweredPlanningKey(cfg.key));
  }, [messages, platformQuickPickOptions, planDurationLimit?.max_campaign_duration_weeks, hasAnsweredPlanningKey]);

  const displayedMessages = useMemo(() => {
    if (quickPickBackIndex !== 1 || aiMessageIndices.length < 2) return messages;
    const prevAiIndex = aiMessageIndices[aiMessageIndices.length - 2]!;
    return messages.slice(0, prevAiIndex + 2);
  }, [messages, quickPickBackIndex, aiMessageIndices]);

  const visibleMessages = useMemo(() => {
    if (quickPickBackIndex === 1) return displayedMessages;
    if (!shouldHideTrailingAnsweredGatherPrompt) return displayedMessages;
    return displayedMessages.slice(0, -1);
  }, [displayedMessages, quickPickBackIndex, shouldHideTrailingAnsweredGatherPrompt]);

  const quickPickAttachToMessageId = useMemo(() => {
    if (quickPickBackIndex === 1 && aiMessageIndices.length >= 2) {
      const prevAiIndex = aiMessageIndices[aiMessageIndices.length - 2]!;
      return messages[prevAiIndex]?.id ?? quickPickAiMessageId;
    }
    return quickPickAiMessageId;
  }, [quickPickBackIndex, aiMessageIndices, messages, quickPickAiMessageId]);

  const eligiblePlanningTypes = useMemo(() => {
    const formatHintsFromContext = [
      ...(((recommendationContext?.context_payload as any)?.formats as string[] | undefined) ?? []),
      ...((typeof (prefilledPlanning as any)?.suggested_formats === 'string'
        ? String((prefilledPlanning as any).suggested_formats).split(',')
        : []) as string[]),
    ]
      .map((value) => canonicalPlanningTypeLabel(String(value || '').trim()))
      .filter(Boolean);

    const fromProps = [
      ...formatHintsFromContext,
      ...extractPlanningTypeHintsFromCapacityValue((prefilledPlanning as any)?.available_content),
      ...extractPlanningTypeHintsFromCapacityValue((prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity),
      ...extractPlanningTypeHintsFromCapacityValue((collectedPlanningContext as any)?.available_content),
      ...extractPlanningTypeHintsFromCapacityValue(
        (collectedPlanningContext as any)?.weekly_capacity ?? (collectedPlanningContext as any)?.content_capacity
      ),
    ];

    const fromHistory: string[] = [];
    for (let i = 0; i < messages.length - 1; i += 1) {
      const curr = messages[i];
      const next = messages[i + 1];
      if (curr?.type !== 'ai' || next?.type !== 'user') continue;
      const q = extractQuestionCandidate(String(curr?.message ?? ''));
      const cfg = allowOnlyGatherConfig(getExternalQuickPickConfig(q, platformQuickPickOptions, planDurationLimit?.max_campaign_duration_weeks));
      if (!cfg) continue;
      if (cfg.key === 'available_content' || cfg.key === 'content_capacity') {
        fromHistory.push(...extractPlanningTypeHintsFromCapacityValue(String(next?.message ?? '')));
      }
    }

    return computeEligiblePlanningTypeSet([
      ...(planningAvailableTypeHints || []),
      ...(planningCapacityTypeHints || []),
      ...fromProps,
      ...fromHistory,
    ]);
  }, [
    recommendationContext,
    planningAvailableTypeHints,
    planningCapacityTypeHints,
    prefilledPlanning,
    collectedPlanningContext,
    messages,
    platformQuickPickOptions,
    planDurationLimit?.max_campaign_duration_weeks,
  ]);

  const quickPickConfig = useMemo(() => {
    const useBack = quickPickBackIndex >= 1 && aiMessageIndices.length > quickPickBackIndex;
    const aiIndex = useBack ? aiMessageIndices[aiMessageIndices.length - 1 - quickPickBackIndex]! : aiMessageIndices[aiMessageIndices.length - 1];
    const aiMsg = aiIndex != null ? messages[aiIndex]?.message : '';
    const q = extractQuestionCandidate(typeof aiMsg === 'string' ? aiMsg : '');
    const base = allowOnlyGatherConfig(getExternalQuickPickConfig(q, platformQuickPickOptions, planDurationLimit?.max_campaign_duration_weeks));
    if (!base) return base;
    if (hasAnsweredPlanningKey(base.key)) return null;
    const creatorOnlyEligible =
      eligiblePlanningTypes.size > 0 &&
      Array.from(eligiblePlanningTypes).every((label) =>
        CREATOR_DEPENDENT_PLANNING_LABELS.includes(label as typeof CREATOR_DEPENDENT_PLANNING_LABELS[number])
      );
    if (base.key === 'available_content' || base.key === 'content_capacity') {
      return { ...base, options: creatorOnlyEligible ? creatorDependentQuickPickOptions : allCatalogContentTypeQuickPickOptions };
    }
    if (base.key === 'platforms') return { ...base, options: platformQuickPickOptions };
    return base;
  }, [
    messages,
    quickPickBackIndex,
    aiMessageIndices,
    platformQuickPickOptions,
    allCatalogContentTypeQuickPickOptions,
    creatorDependentQuickPickOptions,
    eligiblePlanningTypes,
    planDurationLimit?.max_campaign_duration_weeks,
    hasAnsweredPlanningKey,
  ]);

  useEffect(() => {
    if (planningSelectedPlatforms.length > 0) return;
    if (configuredPlatformKeys.length === 0) return;
    setPlanningSelectedPlatforms(configuredPlatformKeys);
  }, [configuredPlatformKeys, planningSelectedPlatforms.length, setPlanningSelectedPlatforms]);

  useEffect(() => {
    if (isNavigatingBackRef.current) {
      isNavigatingBackRef.current = false;
      return;
    }
    setSelectedQuickOptions([]);
    setQuickPickPrimaryStyles([]);
    setQuickPickSecondaryModifiers([]);
    setQuickCustomizeMode(false);
    setQuickCustomizeText('');
    setQuickCustomContentType('');
    setQuickCustomContentCount('');
    setQuickCustomPlatform('');
    setHideQuickPickPanel(false);

    if (quickPickConfig?.key === 'tentative_start') {
      const existing =
        (typeof (prefilledPlanning as any)?.tentative_start === 'string' ? (prefilledPlanning as any).tentative_start : '') ||
        (typeof (collectedPlanningContext as any)?.tentative_start === 'string' ? (collectedPlanningContext as any).tentative_start : '');
      const match = typeof existing === 'string' && existing.trim() ? existing.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) : null;
      if (match) {
        setQuickDateYear(match[1]!);
        setQuickDateMonth(String(parseInt(match[2]!, 10)));
        setQuickDateDay(String(parseInt(match[3]!, 10)));
      } else {
        setQuickDateYear('');
        setQuickDateMonth('');
        setQuickDateDay('');
      }
    } else {
      setQuickDateYear('');
      setQuickDateMonth('');
      setQuickDateDay('');
    }

    setQuickCapacityCounts({});
    setQuickCapacityCreationMode('');
    setShowAllTypeCounters({ available_content: false, content_capacity: false });
    setQuickPlatformContentTypes({});
    setQuickPickBackIndex(0);
    quickPickReplaceTruncateToRef.current = null;
  }, [
    quickPickConfig?.key,
    prefilledPlanning,
    collectedPlanningContext,
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
  ]);

  return {
    aiMessageIndices,
    quickPickAiMessageId,
    shouldHideTrailingAnsweredGatherPrompt,
    displayedMessages,
    visibleMessages,
    quickPickAttachToMessageId,
    eligiblePlanningTypes,
    quickPickConfig,
  };
}
