import type React from 'react';
import {
  canonicalPlanningTypeLabel,
  getEligiblePlatformPlanningTypeOptions,
  planningLabelToParseKeyAndTag,
} from './planningCatalog';
import {
  getQuickPickConfig as getExternalQuickPickConfig,
  parseUserAnswerToFormState as parseExternalUserAnswerToFormState,
} from './quickPickConfig';
import {
  ABSOLUTE_MAX_WEEKS,
  allowOnlyGatherConfig,
  extractQuestionCandidate,
} from './chatHelpers';
import type { ChatMessage, QuickPickConfig } from './types';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type UseCampaignAiQuickPickParams = {
  isBusy: boolean;
  messages: ChatMessage[];
  setMessages: Setter<ChatMessage[]>;
  aiMessageIndices: number[];
  quickPickBackIndex: number;
  quickPickReplaceTruncateToRef: React.MutableRefObject<number | null>;
  isNavigatingBackRef: React.MutableRefObject<boolean>;
  selectedQuickOptions: string[];
  setSelectedQuickOptions: Setter<string[]>;
  quickCustomizeMode: boolean;
  quickCustomizeText: string;
  setQuickCustomizeMode: Setter<boolean>;
  setQuickCustomizeText: Setter<string>;
  quickPickPrimaryStyles: string[];
  setQuickPickPrimaryStyles: Setter<string[]>;
  quickPickSecondaryModifiers: string[];
  setQuickPickSecondaryModifiers: Setter<string[]>;
  quickCapacityCounts: Record<string, string>;
  setQuickCapacityCounts: Setter<Record<string, string>>;
  quickCapacityCreationMode: '' | 'manual' | 'ai-assisted' | 'full-ai';
  setQuickCapacityCreationMode: Setter<'' | 'manual' | 'ai-assisted' | 'full-ai'>;
  quickDateYear: string;
  setQuickDateYear: Setter<string>;
  quickDateMonth: string;
  setQuickDateMonth: Setter<string>;
  quickDateDay: string;
  setQuickDateDay: Setter<string>;
  planningSelectedPlatforms: string[];
  configuredPlatformKeys: string[];
  platformLabels: Record<string, string>;
  platformQuickPickOptions: string[];
  platformContentTypeOptions: Record<string, string[]>;
  eligiblePlanningTypes: Set<string>;
  quickPlatformContentTypes: Record<string, string[]>;
  setQuickPlatformContentTypes: Setter<Record<string, string[]>>;
  setQuickPickBackIndex: Setter<number>;
  hideQuickPickPanel: boolean;
  setHideQuickPickPanel: Setter<boolean>;
  setShowAllTypeCounters: Setter<Record<'available_content' | 'content_capacity', boolean>>;
  setPlanningAvailableCountsOverride: Setter<Record<string, number> | null>;
  setPlanningCapacityCountsOverride: Setter<Record<string, number> | null>;
  setPlanningAvailableTypeHints: Setter<string[]>;
  setPlanningCapacityTypeHints: Setter<string[]>;
  setPlanningPlatformContentTypePrefs: Setter<Record<string, string[]>>;
  setPlanningCrossPlatformSharingEnabled: Setter<boolean>;
  setHasProvidedPlatformContentRequests: Setter<boolean>;
  planningExclusiveCampaigns: Array<{ platform: string; content_type: string; count_per_week: string }>;
  setHasProvidedExclusiveCampaigns: Setter<boolean>;
  onBackToRecommendation?: () => void;
  planDurationLimit?: { max_campaign_duration_weeks?: number | null; plan_key?: string | null } | null;
  setUiErrorMessage: Setter<string | null>;
  sendMessage: (message?: unknown, options?: { replaceTruncateTo?: number }) => Promise<void>;
  scrollToBottom: () => void;
};

export function useCampaignAiQuickPick({
  isBusy,
  messages,
  setMessages,
  aiMessageIndices,
  quickPickBackIndex,
  quickPickReplaceTruncateToRef,
  isNavigatingBackRef,
  selectedQuickOptions,
  setSelectedQuickOptions,
  quickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeMode,
  setQuickCustomizeText,
  quickPickPrimaryStyles,
  setQuickPickPrimaryStyles,
  quickPickSecondaryModifiers,
  setQuickPickSecondaryModifiers,
  quickCapacityCounts,
  setQuickCapacityCounts,
  quickCapacityCreationMode,
  setQuickCapacityCreationMode,
  quickDateYear,
  setQuickDateYear,
  quickDateMonth,
  setQuickDateMonth,
  quickDateDay,
  setQuickDateDay,
  planningSelectedPlatforms,
  configuredPlatformKeys,
  platformLabels,
  platformQuickPickOptions,
  platformContentTypeOptions,
  eligiblePlanningTypes,
  quickPlatformContentTypes,
  setQuickPlatformContentTypes,
  setQuickPickBackIndex,
  hideQuickPickPanel,
  setHideQuickPickPanel,
  setShowAllTypeCounters,
  setPlanningAvailableCountsOverride,
  setPlanningCapacityCountsOverride,
  setPlanningAvailableTypeHints,
  setPlanningCapacityTypeHints,
  setPlanningPlatformContentTypePrefs,
  setPlanningCrossPlatformSharingEnabled,
  setHasProvidedPlatformContentRequests,
  planningExclusiveCampaigns,
  setHasProvidedExclusiveCampaigns,
  onBackToRecommendation,
  planDurationLimit,
  setUiErrorMessage,
  sendMessage,
  scrollToBottom,
}: UseCampaignAiQuickPickParams) {
  const captureCountsOverride = (): Record<string, number> | null => {
    const out: Record<string, number> = {};
    for (const [label, raw] of Object.entries(quickCapacityCounts || {})) {
      const n = Number(String(raw).trim());
      if (!Number.isFinite(n) || n <= 0) continue;
      out[label] = Math.max(0, Math.floor(n));
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  const countPhrase = (label: string, n: number, perWeek: boolean) => {
    const mapped = planningLabelToParseKeyAndTag(label);
    const parseKey = mapped.parseKey;
    const baseUnit = mapped.displayUnit || parseKey;
    const unit = n === 1 ? baseUnit : `${baseUnit}s`;
    return `${n} ${unit}${perWeek ? '/week' : ''}${mapped.tag ? ` (${mapped.tag})` : ''}`;
  };

  const hydrateParsedAnswer = (parsed: any) => {
    if (parsed.quickCapacityCounts) setQuickCapacityCounts(parsed.quickCapacityCounts);
    if (parsed.quickCapacityCreationMode) setQuickCapacityCreationMode(parsed.quickCapacityCreationMode);
    if (parsed.quickDateYear) setQuickDateYear(parsed.quickDateYear);
    if (parsed.quickDateMonth) setQuickDateMonth(parsed.quickDateMonth);
    if (parsed.quickDateDay) setQuickDateDay(parsed.quickDateDay);
    if (parsed.selectedQuickOptions) setSelectedQuickOptions(parsed.selectedQuickOptions);
    if (parsed.quickPickPrimaryStyles) setQuickPickPrimaryStyles(parsed.quickPickPrimaryStyles);
    if (parsed.quickPickSecondaryModifiers) setQuickPickSecondaryModifiers(parsed.quickPickSecondaryModifiers);
    if (parsed.quickCustomizeMode) setQuickCustomizeMode(parsed.quickCustomizeMode);
    if (parsed.quickCustomizeText) setQuickCustomizeText(parsed.quickCustomizeText);
    if (parsed.quickPlatformContentTypes) setQuickPlatformContentTypes(parsed.quickPlatformContentTypes);
  };

  const submitQuickPickAnswer = async (activeConfig: QuickPickConfig) => {
    if (isBusy) return;
    const picked = [...selectedQuickOptions];
    const custom = quickCustomizeText.trim();

    if (activeConfig.progressiveStyle && quickPickPrimaryStyles.length > 0 && (activeConfig.key === 'communication_style' || activeConfig.key === 'action_expectation')) {
      const primaries = quickPickPrimaryStyles.join(', ');
      const modifiers =
        activeConfig.key === 'communication_style' && quickPickPrimaryStyles.includes('Simple & easy')
          ? quickPickSecondaryModifiers.filter((s) => s !== 'Deep & thoughtful')
          : quickPickSecondaryModifiers;
      const answer =
        activeConfig.key === 'action_expectation'
          ? modifiers.length > 0
            ? `CTA - Primary intent: ${primaries}. Actions: ${modifiers.join(', ')}.`
            : `CTA - Primary intent: ${primaries}.`
          : modifiers.length > 0
            ? `Communication style - Primary: ${primaries}. Secondary: ${modifiers.join(', ')}.`
            : `Communication style - Primary: ${primaries}.`;
      setHideQuickPickPanel(true);
      setQuickPickPrimaryStyles([]);
      setQuickPickSecondaryModifiers([]);
      await sendMessage(answer);
      return;
    }

    let answer = '';
    if (activeConfig.key === 'campaign_duration') {
      const isElseShare = picked.includes('Else share');
      if ((quickCustomizeMode && custom) || (isElseShare && custom)) {
        const match = custom.match(/(\d+)\s*weeks?/i) ?? custom.match(/(\d+)/);
        const weeks = match ? parseInt(match[1], 10) : Number.NaN;
        if (!Number.isFinite(weeks) || weeks < 1) return setUiErrorMessage('Please enter a valid duration (e.g. 6 weeks).');
        if (weeks > ABSOLUTE_MAX_WEEKS) return setUiErrorMessage(`Campaign duration cannot exceed ${ABSOLUTE_MAX_WEEKS} weeks.`);
        const maxForPlan = planDurationLimit?.max_campaign_duration_weeks ?? ABSOLUTE_MAX_WEEKS;
        if (weeks > maxForPlan) {
          const planName = planDurationLimit?.plan_key ? `${String(planDurationLimit.plan_key).charAt(0).toUpperCase()}${String(planDurationLimit.plan_key).slice(1)}` : 'Your';
          const remainder = weeks - maxForPlan;
          const splitSuggestion = remainder >= 1 ? ` You can do this in two runs: ${maxForPlan} weeks + ${remainder} week${remainder > 1 ? 's' : ''}.` : '';
          return setUiErrorMessage(`Your ${planName} plan allows up to ${maxForPlan} weeks.${splitSuggestion} Or upgrade to extend your campaign.`);
        }
        answer = custom;
      } else if (isElseShare && !custom) {
        return setUiErrorMessage('Please enter your desired duration (e.g. 6 weeks) in the custom field.');
      } else if (picked.length > 0) {
        answer = `Yes, proceed with ${picked[0]}.`;
      }
    } else if (activeConfig.key === 'available_content' || activeConfig.key === 'content_capacity') {
      const override = captureCountsOverride();
      if (activeConfig.key === 'available_content') setPlanningAvailableCountsOverride(override);
      else setPlanningCapacityCountsOverride(override);
      const nextHints = Object.entries(quickCapacityCounts).map(([key, value]) => Number(String(value).trim()) > 0 ? canonicalPlanningTypeLabel(key) : '').filter(Boolean);
      if (nextHints.length > 0) {
        if (activeConfig.key === 'available_content') setPlanningAvailableTypeHints(Array.from(new Set(nextHints)));
        else setPlanningCapacityTypeHints(Array.from(new Set(nextHints)));
      }
      const mapped = Object.entries(quickCapacityCounts)
        .map(([key, value]) => {
          const n = Number(String(value).trim());
          return Number.isFinite(n) && n > 0 ? countPhrase(key, Math.floor(n), activeConfig.key === 'content_capacity') : '';
        })
        .filter(Boolean);
      if (activeConfig.key === 'content_capacity' && quickCapacityCreationMode) {
        mapped.push(`creation: ${quickCapacityCreationMode === 'manual' ? 'manual' : quickCapacityCreationMode === 'ai-assisted' ? 'AI-assisted' : 'full AI'}`);
      }
      answer = mapped.join(', ');
    } else if (activeConfig.key === 'tentative_start') {
      const y = quickDateYear.trim();
      const m = quickDateMonth.trim().padStart(2, '0');
      const d = quickDateDay.trim().padStart(2, '0');
      if (y.length === 4 && m.length === 2 && d.length === 2) answer = `${y}-${m}-${d}`;
    } else if (activeConfig.key === 'platform_content_types') {
      const orderedPlatforms = planningSelectedPlatforms.length > 0 ? planningSelectedPlatforms : Array.from(new Set(Object.keys(quickPlatformContentTypes)));
      const normalizeType = (label: string) =>
        String(label || '').toLowerCase().trim()
          .replace(/blog|article/, 'article')
          .replace(/white.*/, 'white_paper')
          .replace(/slide.*/, 'slideware')
          .replace(/[^a-z0-9_-]+/g, '_')
          .replace(/^_+|_+$/g, '');
      const parts = orderedPlatforms.map((platform) => {
        const selections = quickPlatformContentTypes[platform] || [];
        const allowed = getEligiblePlatformPlanningTypeOptions({ platform, platformContentTypeOptions, eligible: eligiblePlanningTypes });
        const filtered = selections.filter((selection) => allowed.includes(selection));
        if (filtered.length === 0) return '';
        return `${platformLabels[platform] || platform}: ${filtered.join(', ')}`;
      }).filter(Boolean);
      const prefs: Record<string, string[]> = {};
      for (const platform of orderedPlatforms) {
        const allowed = getEligiblePlatformPlanningTypeOptions({ platform, platformContentTypeOptions, eligible: eligiblePlanningTypes });
        const normalized = Array.from(new Set((quickPlatformContentTypes[platform] || []).filter((selection) => allowed.includes(selection)).map(normalizeType).filter(Boolean)));
        if (normalized.length > 0) prefs[platform] = normalized;
      }
      if (Object.keys(prefs).length > 0) setPlanningPlatformContentTypePrefs(prefs);
      if (quickCustomizeMode && custom) parts.push(custom);
      answer = parts.join('; ');
    } else if (activeConfig.key === 'cross_platform_sharing') {
      if (picked.length === 0) return;
      const isShared = /shared|same\s*content\s*across|same\s*across\s*all/i.test(String(picked[0] ?? '').trim());
      setPlanningCrossPlatformSharingEnabled(isShared);
      answer = isShared ? 'Shared' : 'Unique';
    } else if (activeConfig.key === 'platform_content_requests') {
      setHasProvidedPlatformContentRequests(true);
      answer = 'Platform content requests captured.';
    } else if (activeConfig.key === 'exclusive_campaigns') {
      setHasProvidedExclusiveCampaigns(true);
      const cleaned = (planningExclusiveCampaigns || []).map((row) => {
        const platform = String(row?.platform || '').trim().toLowerCase();
        const content_type = String(row?.content_type || '').trim();
        const n = Number(String(row?.count_per_week || '').replace(/\D/g, '').slice(0, 2));
        const count_per_week = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        return platform && content_type && count_per_week > 0 ? { platform, content_type, count_per_week } : null;
      }).filter(Boolean);
      answer = cleaned.length > 0 ? 'Yes.' : 'No.';
    } else {
      const values = [...picked];
      if (quickCustomizeMode && custom) values.push(custom);
      answer = values.join(', ');
    }

    if (!answer.trim()) return;
    setHideQuickPickPanel(true);
    if (activeConfig.key === 'available_content' || activeConfig.key === 'content_capacity') {
      setQuickCapacityCounts({});
      setShowAllTypeCounters((prev) => ({ ...prev, [activeConfig.key]: false }));
    }
    const truncateTo = quickPickReplaceTruncateToRef.current;
    if (typeof truncateTo === 'number' && truncateTo >= 0) {
      quickPickReplaceTruncateToRef.current = null;
      setQuickPickBackIndex(0);
      await sendMessage(answer, { replaceTruncateTo: truncateTo });
      return;
    }
    await sendMessage(answer);
  };

  const handleQuickPickBack = () => {
    if (aiMessageIndices.length === 1 && onBackToRecommendation) return onBackToRecommendation();
    if (aiMessageIndices.length < 2) return;
    const prevAiIndex = aiMessageIndices[aiMessageIndices.length - 2]!;
    const prevUserMsg = messages[prevAiIndex + 1];
    if (!prevUserMsg || prevUserMsg.type !== 'user') return setHideQuickPickPanel(true);
    const baseConfig = allowOnlyGatherConfig(
      getExternalQuickPickConfig(
        extractQuestionCandidate(String(messages[prevAiIndex]?.message ?? '')),
        platformQuickPickOptions,
        planDurationLimit?.max_campaign_duration_weeks
      )
    );
    if (!baseConfig) return setHideQuickPickPanel(true);
    const parsed = parseExternalUserAnswerToFormState(baseConfig.key, String(prevUserMsg.message ?? ''), canonicalPlanningTypeLabel);
    isNavigatingBackRef.current = true;
    quickPickReplaceTruncateToRef.current = prevAiIndex + 1;
    setQuickPickBackIndex(1);
    setHideQuickPickPanel(false);
    hydrateParsedAnswer(parsed);
    scrollToBottom();
  };

  const handleQuickPickBackDeeper = () => {
    const viewingIdx = aiMessageIndices.length - 1 - quickPickBackIndex;
    if (viewingIdx <= 0 && onBackToRecommendation) return onBackToRecommendation();
    const targetAiIndex = aiMessageIndices[viewingIdx]!;
    setMessages((prev) => prev.slice(0, targetAiIndex));
    const newAiIndices = messages.slice(0, targetAiIndex).map((m, i) => (m.type === 'ai' && m.message ? i : -1)).filter((i) => i >= 0);
    const lastAiIdx = newAiIndices[newAiIndices.length - 1];
    const lastUserMsg = lastAiIdx != null ? messages[lastAiIdx + 1] : null;
    quickPickReplaceTruncateToRef.current = null;
    setQuickPickBackIndex(0);
    isNavigatingBackRef.current = true;
    setHideQuickPickPanel(false);
    if (lastUserMsg?.type === 'user' && lastAiIdx != null) {
      const baseConfig = allowOnlyGatherConfig(
        getExternalQuickPickConfig(
          extractQuestionCandidate(String(messages[lastAiIdx]?.message ?? '')),
          platformQuickPickOptions,
          planDurationLimit?.max_campaign_duration_weeks
        )
      );
      if (baseConfig) {
        hydrateParsedAnswer(parseExternalUserAnswerToFormState(baseConfig.key, String(lastUserMsg.message ?? ''), canonicalPlanningTypeLabel));
      }
    }
    scrollToBottom();
  };

  const canGoBack =
    (quickPickBackIndex === 0 &&
      ((aiMessageIndices.length >= 2 && messages[aiMessageIndices[aiMessageIndices.length - 2]! + 1]?.type === 'user') ||
        (aiMessageIndices.length === 1 && !!onBackToRecommendation))) ||
    (quickPickBackIndex >= 1 && (aiMessageIndices.length - 1 - quickPickBackIndex > 0 || !!onBackToRecommendation));

  return {
    canGoBack,
    hideQuickPickPanel,
    submitQuickPickAnswer,
    handleQuickPickBack,
    handleQuickPickBackDeeper,
  };
}
