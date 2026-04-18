import React from 'react';
import { CampaignAIQuickPickCapacityPanels } from './QuickPickCapacityPanels';
import {
  QuickPickGenericPanel,
  QuickPickExclusiveCampaignsPanel,
  QuickPickProgressiveStylePanel,
} from './QuickPickDecisionPanels';
import { QuickPickPlatformContentRequestsPanel } from './QuickPickPlatformContentRequestsPanel';
import { QuickPickPlatformContentTypesPanel } from './QuickPickPlatformContentTypesPanel';
import type { QuickPickConfig } from './types';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type Props = {
  config: QuickPickConfig | null;
  hideQuickPickPanel: boolean;
  isBusy: boolean;
  canGoBack: boolean;
  quickPickBackIndex: number;
  aiMessageIndices: number[];
  onBackToRecommendation?: () => void;
  handleQuickPickBack: () => void;
  handleQuickPickBackDeeper: () => void;
  submitQuickPickAnswer: (config: QuickPickConfig) => Promise<void>;
  sendMessage: (message?: unknown, options?: { replaceTruncateTo?: number }) => Promise<void>;
  selectedQuickOptions: string[];
  setSelectedQuickOptions: Setter<string[]>;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: Setter<boolean>;
  quickCustomizeText: string;
  setQuickCustomizeText: Setter<string>;
  quickCustomContentType: string;
  setQuickCustomContentType: Setter<string>;
  quickCustomContentCount: string;
  setQuickCustomContentCount: Setter<string>;
  quickCustomPlatform: string;
  setQuickCustomPlatform: Setter<string>;
  quickDateYear: string;
  setQuickDateYear: Setter<string>;
  quickDateMonth: string;
  setQuickDateMonth: Setter<string>;
  quickDateDay: string;
  setQuickDateDay: Setter<string>;
  quickCapacityCounts: Record<string, string>;
  setQuickCapacityCounts: Setter<Record<string, string>>;
  quickCapacityCreationMode: '' | 'manual' | 'ai-assisted' | 'full-ai';
  setQuickCapacityCreationMode: Setter<'' | 'manual' | 'ai-assisted' | 'full-ai'>;
  showAllTypeCounters: Record<'available_content' | 'content_capacity', boolean>;
  setShowAllTypeCounters: Setter<Record<'available_content' | 'content_capacity', boolean>>;
  planningSelectedPlatforms: string[];
  platformLabels: Record<string, string>;
  platformContentTypeOptions: Record<string, string[]>;
  platformContentTypeRawOptions: Record<string, string[]>;
  eligiblePlanningTypes: Set<string>;
  quickPlatformContentTypes: Record<string, string[]>;
  setQuickPlatformContentTypes: Setter<Record<string, string[]>>;
  setHideQuickPickPanel: Setter<boolean>;
  hasEffectiveCatalog: boolean;
  planningPlatformContentRequests: Record<string, Record<string, string>>;
  setPlanningPlatformContentRequests: Setter<Record<string, Record<string, string>>>;
  planningCrossPlatformSharingEnabled: boolean;
  setPlanningCrossPlatformSharingEnabled: Setter<boolean>;
  planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
  setPlanningCrossPlatformScheduleMode: Setter<'same_time' | 'staggered' | 'ai_recommended'>;
  planningExclusiveCampaigns: Array<{ platform: string; content_type: string; count_per_week: string }>;
  setPlanningExclusiveCampaigns: Setter<Array<{ platform: string; content_type: string; count_per_week: string }>>;
  planningAvailableCountsOverride: Record<string, number> | null;
  planningCapacityCountsOverride: Record<string, number> | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  planningPlatformContentTypePrefs: Record<string, string[]>;
  showAllPlatformRequestTypes: Record<string, boolean>;
  setShowAllPlatformRequestTypes: Setter<Record<string, boolean>>;
  quickPickPrimaryStyles: string[];
  setQuickPickPrimaryStyles: Setter<string[]>;
  quickPickSecondaryModifiers: string[];
  setQuickPickSecondaryModifiers: Setter<string[]>;
};

export function CampaignAIQuickPickRenderer({
  config,
  hideQuickPickPanel,
  isBusy,
  canGoBack,
  quickPickBackIndex,
  aiMessageIndices,
  onBackToRecommendation,
  handleQuickPickBack,
  handleQuickPickBackDeeper,
  submitQuickPickAnswer,
  sendMessage,
  selectedQuickOptions,
  setSelectedQuickOptions,
  quickCustomizeMode,
  setQuickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeText,
  quickCustomContentType,
  setQuickCustomContentType,
  quickCustomContentCount,
  setQuickCustomContentCount,
  quickCustomPlatform,
  setQuickCustomPlatform,
  quickDateYear,
  setQuickDateYear,
  quickDateMonth,
  setQuickDateMonth,
  quickDateDay,
  setQuickDateDay,
  quickCapacityCounts,
  setQuickCapacityCounts,
  quickCapacityCreationMode,
  setQuickCapacityCreationMode,
  showAllTypeCounters,
  setShowAllTypeCounters,
  planningSelectedPlatforms,
  platformLabels,
  platformContentTypeOptions,
  platformContentTypeRawOptions,
  eligiblePlanningTypes,
  quickPlatformContentTypes,
  setQuickPlatformContentTypes,
  setHideQuickPickPanel,
  hasEffectiveCatalog,
  planningPlatformContentRequests,
  setPlanningPlatformContentRequests,
  planningCrossPlatformSharingEnabled,
  setPlanningCrossPlatformSharingEnabled,
  planningCrossPlatformScheduleMode,
  setPlanningCrossPlatformScheduleMode,
  planningExclusiveCampaigns,
  setPlanningExclusiveCampaigns,
  planningAvailableCountsOverride,
  planningCapacityCountsOverride,
  prefilledPlanning,
  collectedPlanningContext,
  planningPlatformContentTypePrefs,
  showAllPlatformRequestTypes,
  setShowAllPlatformRequestTypes,
  quickPickPrimaryStyles,
  setQuickPickPrimaryStyles,
  quickPickSecondaryModifiers,
  setQuickPickSecondaryModifiers,
}: Props) {
  if (!config || hideQuickPickPanel) return null;

  const quickPickBackButton = canGoBack ? (
    <button
      type="button"
      disabled={isBusy}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (quickPickBackIndex === 0) handleQuickPickBack();
        else handleQuickPickBackDeeper();
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 mb-2"
    >
      {quickPickBackIndex >= 1 && aiMessageIndices.length - 1 - quickPickBackIndex <= 0 && onBackToRecommendation
        ? '<- Back to strategic card'
        : '<- Back'}
    </button>
  ) : null;

  if (config.key === 'available_content' || config.key === 'tentative_start' || config.key === 'content_capacity') {
    return (
      <CampaignAIQuickPickCapacityPanels
        config={config}
        isBusy={isBusy}
        hideQuickPickPanel={hideQuickPickPanel}
        quickPickBackButton={quickPickBackButton}
        sendMessage={sendMessage}
        submitQuickPickAnswer={submitQuickPickAnswer}
        showAllTypeCounters={showAllTypeCounters}
        setShowAllTypeCounters={setShowAllTypeCounters}
        quickCapacityCounts={quickCapacityCounts}
        setQuickCapacityCounts={setQuickCapacityCounts}
        quickCustomizeMode={quickCustomizeMode}
        setQuickCustomizeMode={setQuickCustomizeMode}
        quickCustomizeText={quickCustomizeText}
        setQuickCustomizeText={setQuickCustomizeText}
        quickCustomContentType={quickCustomContentType}
        setQuickCustomContentType={setQuickCustomContentType}
        quickCustomContentCount={quickCustomContentCount}
        setQuickCustomContentCount={setQuickCustomContentCount}
        quickDateYear={quickDateYear}
        setQuickDateYear={setQuickDateYear}
        quickDateMonth={quickDateMonth}
        setQuickDateMonth={setQuickDateMonth}
        quickDateDay={quickDateDay}
        setQuickDateDay={setQuickDateDay}
        planningSelectedPlatforms={planningSelectedPlatforms}
        prefilledPlanning={prefilledPlanning}
        collectedPlanningContext={collectedPlanningContext}
        quickCapacityCreationMode={quickCapacityCreationMode}
        setQuickCapacityCreationMode={setQuickCapacityCreationMode}
        setSelectedQuickOptions={setSelectedQuickOptions}
      />
    );
  }

  if (config.key === 'platform_content_types') {
    return (
      <QuickPickPlatformContentTypesPanel
        config={config}
        isBusy={isBusy}
        quickPickBackButton={quickPickBackButton}
        sendMessage={sendMessage}
        submitQuickPickAnswer={submitQuickPickAnswer}
        quickCustomizeMode={quickCustomizeMode}
        setQuickCustomizeMode={setQuickCustomizeMode}
        quickCustomizeText={quickCustomizeText}
        setQuickCustomizeText={setQuickCustomizeText}
        planningSelectedPlatforms={planningSelectedPlatforms}
        platformLabels={platformLabels}
        platformContentTypeOptions={platformContentTypeOptions}
        eligiblePlanningTypes={eligiblePlanningTypes}
        quickPlatformContentTypes={quickPlatformContentTypes}
        setQuickPlatformContentTypes={setQuickPlatformContentTypes}
        setHideQuickPickPanel={setHideQuickPickPanel}
        setSelectedQuickOptions={setSelectedQuickOptions}
      />
    );
  }

  if (config.key === 'platform_content_requests') {
    return (
      <QuickPickPlatformContentRequestsPanel
        config={config}
        isBusy={isBusy}
        quickPickBackButton={quickPickBackButton}
        submitQuickPickAnswer={submitQuickPickAnswer}
        quickCustomizeMode={quickCustomizeMode}
        setQuickCustomizeMode={setQuickCustomizeMode}
        setSelectedQuickOptions={setSelectedQuickOptions}
        planningSelectedPlatforms={planningSelectedPlatforms}
        platformLabels={platformLabels}
        platformContentTypeOptions={platformContentTypeOptions}
        platformContentTypeRawOptions={platformContentTypeRawOptions}
        eligiblePlanningTypes={eligiblePlanningTypes}
        hasEffectiveCatalog={hasEffectiveCatalog}
        planningPlatformContentRequests={planningPlatformContentRequests}
        setPlanningPlatformContentRequests={setPlanningPlatformContentRequests}
        planningCrossPlatformSharingEnabled={planningCrossPlatformSharingEnabled}
        setPlanningCrossPlatformSharingEnabled={setPlanningCrossPlatformSharingEnabled}
        planningCrossPlatformScheduleMode={planningCrossPlatformScheduleMode}
        setPlanningCrossPlatformScheduleMode={setPlanningCrossPlatformScheduleMode}
        planningExclusiveCampaigns={planningExclusiveCampaigns}
        planningAvailableCountsOverride={planningAvailableCountsOverride}
        planningCapacityCountsOverride={planningCapacityCountsOverride}
        prefilledPlanning={prefilledPlanning}
        collectedPlanningContext={collectedPlanningContext}
        planningPlatformContentTypePrefs={planningPlatformContentTypePrefs}
        showAllPlatformRequestTypes={showAllPlatformRequestTypes}
        setShowAllPlatformRequestTypes={setShowAllPlatformRequestTypes}
        quickCustomPlatform={quickCustomPlatform}
        setQuickCustomPlatform={setQuickCustomPlatform}
        quickCustomContentType={quickCustomContentType}
        setQuickCustomContentType={setQuickCustomContentType}
        quickCustomContentCount={quickCustomContentCount}
        setQuickCustomContentCount={setQuickCustomContentCount}
      />
    );
  }

  if (config.key === 'exclusive_campaigns') {
    return (
      <QuickPickExclusiveCampaignsPanel
        config={config}
        isBusy={isBusy}
        quickPickBackButton={quickPickBackButton}
        quickCustomizeMode={quickCustomizeMode}
        setQuickCustomizeMode={setQuickCustomizeMode}
        quickCustomizeText={quickCustomizeText}
        setQuickCustomizeText={setQuickCustomizeText}
        setSelectedQuickOptions={setSelectedQuickOptions}
        setHideQuickPickPanel={setHideQuickPickPanel}
        sendMessage={sendMessage}
        submitQuickPickAnswer={submitQuickPickAnswer}
        planningSelectedPlatforms={planningSelectedPlatforms}
        platformContentTypeRawOptions={platformContentTypeRawOptions}
        platformLabels={platformLabels}
        hasEffectiveCatalog={hasEffectiveCatalog}
        planningExclusiveCampaigns={planningExclusiveCampaigns as any}
        setPlanningExclusiveCampaigns={setPlanningExclusiveCampaigns as any}
      />
    );
  }

  if (config.progressiveStyle && (config.key === 'communication_style' || config.key === 'action_expectation')) {
    return (
      <QuickPickProgressiveStylePanel
        config={config as QuickPickConfig & { progressiveStyle: NonNullable<QuickPickConfig['progressiveStyle']> }}
        isBusy={isBusy}
        quickPickBackButton={quickPickBackButton}
        quickPickPrimaryStyles={quickPickPrimaryStyles}
        setQuickPickPrimaryStyles={setQuickPickPrimaryStyles}
        quickPickSecondaryModifiers={quickPickSecondaryModifiers}
        setQuickPickSecondaryModifiers={setQuickPickSecondaryModifiers}
        submitQuickPickAnswer={submitQuickPickAnswer}
      />
    );
  }

  return (
    <QuickPickGenericPanel
      config={config}
      isBusy={isBusy}
      quickPickBackButton={quickPickBackButton}
      selectedQuickOptions={selectedQuickOptions}
      setSelectedQuickOptions={setSelectedQuickOptions}
      quickCustomizeMode={quickCustomizeMode}
      setQuickCustomizeMode={setQuickCustomizeMode}
      quickCustomizeText={quickCustomizeText}
      setQuickCustomizeText={setQuickCustomizeText}
      submitQuickPickAnswer={submitQuickPickAnswer}
    />
  );
}
