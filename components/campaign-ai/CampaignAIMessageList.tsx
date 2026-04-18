import React from 'react';
import { Calendar, FileText } from 'lucide-react';
import { FormattedAIMessage } from './FormattedAIMessage';
import { CampaignAIQuickPickRenderer } from './CampaignAIQuickPickRenderer';
import { StructuredPlanPreview } from './StructuredPlanPreview';
import type { ChatMessage, QuickPickConfig, StructuredPlan } from './types';

type CampaignAIMessageListProps = {
  visibleMessages: ChatMessage[];
  structuredPlan: StructuredPlan | null;
  structuredPlanMessageId: number | null;
  isBusy: boolean;
  campaignId?: string;
  governanceLocked?: boolean;
  isRecsChat: boolean;
  quickPickAttachToMessageId?: number | null;
  quickPickConfig: QuickPickConfig | null;
  hideQuickPickPanel: boolean;
  canGoBack: boolean;
  quickPickBackIndex: number;
  aiMessageIndices: number[];
  onBackToRecommendation?: (() => void) | undefined;
  handleQuickPickBack: () => void;
  handleQuickPickBackDeeper: () => void;
  submitQuickPickAnswer: (config: QuickPickConfig) => Promise<void>;
  sendMessage: (message?: string) => Promise<void>;
  selectedQuickOptions: string[];
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomizeText: string;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentType: string;
  setQuickCustomContentType: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentCount: string;
  setQuickCustomContentCount: React.Dispatch<React.SetStateAction<string>>;
  quickCustomPlatform: string;
  setQuickCustomPlatform: React.Dispatch<React.SetStateAction<string>>;
  quickDateYear: string;
  setQuickDateYear: React.Dispatch<React.SetStateAction<string>>;
  quickDateMonth: string;
  setQuickDateMonth: React.Dispatch<React.SetStateAction<string>>;
  quickDateDay: string;
  setQuickDateDay: React.Dispatch<React.SetStateAction<string>>;
  quickCapacityCounts: Record<string, string>;
  setQuickCapacityCounts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  quickCapacityCreationMode: '' | 'manual' | 'ai-assisted' | 'full-ai';
  setQuickCapacityCreationMode: React.Dispatch<React.SetStateAction<'' | 'manual' | 'ai-assisted' | 'full-ai'>>;
  showAllTypeCounters: Record<'available_content' | 'content_capacity', boolean>;
  setShowAllTypeCounters: React.Dispatch<React.SetStateAction<Record<'available_content' | 'content_capacity', boolean>>>;
  planningSelectedPlatforms: string[];
  platformLabels: Record<string, string>;
  platformContentTypeOptions: Record<string, string[]>;
  platformContentTypeRawOptions: Record<string, string[]>;
  eligiblePlanningTypes: Set<string>;
  quickPlatformContentTypes: Record<string, string[]>;
  setQuickPlatformContentTypes: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setHideQuickPickPanel: React.Dispatch<React.SetStateAction<boolean>>;
  hasEffectiveCatalog: boolean;
  planningPlatformContentRequests: Record<string, Record<string, string>>;
  setPlanningPlatformContentRequests: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  planningCrossPlatformSharingEnabled: boolean;
  setPlanningCrossPlatformSharingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
  setPlanningCrossPlatformScheduleMode: React.Dispatch<React.SetStateAction<'same_time' | 'staggered' | 'ai_recommended'>>;
  planningExclusiveCampaigns: Array<{ platform: string; content_type: string; count_per_week: string }>;
  setPlanningExclusiveCampaigns: React.Dispatch<React.SetStateAction<Array<{ platform: string; content_type: string; count_per_week: string }>>>;
  planningAvailableCountsOverride: Record<string, number> | null;
  planningCapacityCountsOverride: Record<string, number> | null;
  prefilledPlanning: Record<string, unknown> | null | undefined;
  collectedPlanningContext: Record<string, unknown> | null | undefined;
  planningPlatformContentTypePrefs: Record<string, string[]>;
  showAllPlatformRequestTypes: Record<string, boolean>;
  setShowAllPlatformRequestTypes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  quickPickPrimaryStyles: string[];
  setQuickPickPrimaryStyles: React.Dispatch<React.SetStateAction<string[]>>;
  quickPickSecondaryModifiers: string[];
  setQuickPickSecondaryModifiers: React.Dispatch<React.SetStateAction<string[]>>;
  lastCollectedPlanningContextFromApi: Record<string, unknown> | null;
  hasProvidedPlatformContentRequests: boolean;
  planningPlatformContentRequestsForPreview: Record<string, Record<string, string>>;
  planningCrossPlatformSharingEnabledForPreview: boolean;
  planningCrossPlatformScheduleModeForPreview: 'same_time' | 'staggered' | 'ai_recommended';
  onSchedulePlan: () => void;
};

export function CampaignAIMessageList(props: CampaignAIMessageListProps) {
  const {
    visibleMessages,
    structuredPlan,
    structuredPlanMessageId,
    isBusy,
    campaignId,
    governanceLocked,
    isRecsChat,
    quickPickAttachToMessageId,
    quickPickConfig,
    hideQuickPickPanel,
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
    lastCollectedPlanningContextFromApi,
    hasProvidedPlatformContentRequests,
    planningPlatformContentRequestsForPreview,
    planningCrossPlatformSharingEnabledForPreview,
    planningCrossPlatformScheduleModeForPreview,
    onSchedulePlan,
  } = props;

  return (
    <>
      {visibleMessages.map((message) => (
        <div key={message.id} className={`flex w-full ${message.type === 'user' ? 'justify-end' : 'justify-start'} px-1 sm:px-2`}>
          <div className={`px-4 py-3 rounded-lg min-w-0 ${message.type === 'user' ? (isRecsChat ? 'bg-emerald-600 text-white max-w-[90%]' : 'bg-indigo-600 text-white max-w-[90%]') : 'bg-gray-100 text-gray-900 w-full'}`}>
            {message.type === 'ai' && structuredPlan && structuredPlanMessageId === message.id ? (
              <div className="text-sm space-y-3">
                <StructuredPlanPreview
                  plan={structuredPlan}
                  lastCollectedPlanningContextFromApi={lastCollectedPlanningContextFromApi}
                  prefilledPlanning={prefilledPlanning as Record<string, unknown> | null}
                  collectedPlanningContext={collectedPlanningContext as Record<string, unknown> | null}
                  hasProvidedPlatformContentRequests={hasProvidedPlatformContentRequests}
                  planningPlatformContentRequests={planningPlatformContentRequestsForPreview}
                  planningCrossPlatformSharingEnabled={planningCrossPlatformSharingEnabledForPreview}
                  planningCrossPlatformScheduleMode={planningCrossPlatformScheduleModeForPreview}
                />
                <button
                  onClick={onSchedulePlan}
                  disabled={isBusy || !campaignId || governanceLocked}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50 ${isRecsChat ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  <Calendar className="h-4 w-4" />
                  Schedule this plan
                </button>
              </div>
            ) : message.type === 'ai' ? (
              <>
                <FormattedAIMessage message={message.message} />
                {message.id === quickPickAttachToMessageId ? (
                  <CampaignAIQuickPickRenderer
                    config={quickPickConfig}
                    hideQuickPickPanel={hideQuickPickPanel}
                    isBusy={isBusy}
                    canGoBack={canGoBack}
                    quickPickBackIndex={quickPickBackIndex}
                    aiMessageIndices={aiMessageIndices}
                    onBackToRecommendation={onBackToRecommendation}
                    handleQuickPickBack={handleQuickPickBack}
                    handleQuickPickBackDeeper={handleQuickPickBackDeeper}
                    submitQuickPickAnswer={submitQuickPickAnswer}
                    sendMessage={sendMessage}
                    selectedQuickOptions={selectedQuickOptions}
                    setSelectedQuickOptions={setSelectedQuickOptions}
                    quickCustomizeMode={quickCustomizeMode}
                    setQuickCustomizeMode={setQuickCustomizeMode}
                    quickCustomizeText={quickCustomizeText}
                    setQuickCustomizeText={setQuickCustomizeText}
                    quickCustomContentType={quickCustomContentType}
                    setQuickCustomContentType={setQuickCustomContentType}
                    quickCustomContentCount={quickCustomContentCount}
                    setQuickCustomContentCount={setQuickCustomContentCount}
                    quickCustomPlatform={quickCustomPlatform}
                    setQuickCustomPlatform={setQuickCustomPlatform}
                    quickDateYear={quickDateYear}
                    setQuickDateYear={setQuickDateYear}
                    quickDateMonth={quickDateMonth}
                    setQuickDateMonth={setQuickDateMonth}
                    quickDateDay={quickDateDay}
                    setQuickDateDay={setQuickDateDay}
                    quickCapacityCounts={quickCapacityCounts}
                    setQuickCapacityCounts={setQuickCapacityCounts}
                    quickCapacityCreationMode={quickCapacityCreationMode}
                    setQuickCapacityCreationMode={setQuickCapacityCreationMode}
                    showAllTypeCounters={showAllTypeCounters}
                    setShowAllTypeCounters={setShowAllTypeCounters}
                    planningSelectedPlatforms={planningSelectedPlatforms}
                    platformLabels={platformLabels}
                    platformContentTypeOptions={platformContentTypeOptions}
                    platformContentTypeRawOptions={platformContentTypeRawOptions}
                    eligiblePlanningTypes={eligiblePlanningTypes}
                    quickPlatformContentTypes={quickPlatformContentTypes}
                    setQuickPlatformContentTypes={setQuickPlatformContentTypes}
                    setHideQuickPickPanel={setHideQuickPickPanel}
                    hasEffectiveCatalog={hasEffectiveCatalog}
                    planningPlatformContentRequests={planningPlatformContentRequests}
                    setPlanningPlatformContentRequests={setPlanningPlatformContentRequests}
                    planningCrossPlatformSharingEnabled={planningCrossPlatformSharingEnabled}
                    setPlanningCrossPlatformSharingEnabled={setPlanningCrossPlatformSharingEnabled}
                    planningCrossPlatformScheduleMode={planningCrossPlatformScheduleMode}
                    setPlanningCrossPlatformScheduleMode={setPlanningCrossPlatformScheduleMode}
                    planningExclusiveCampaigns={planningExclusiveCampaigns}
                    setPlanningExclusiveCampaigns={setPlanningExclusiveCampaigns}
                    planningAvailableCountsOverride={planningAvailableCountsOverride}
                    planningCapacityCountsOverride={planningCapacityCountsOverride}
                    prefilledPlanning={prefilledPlanning}
                    collectedPlanningContext={collectedPlanningContext}
                    planningPlatformContentTypePrefs={planningPlatformContentTypePrefs}
                    showAllPlatformRequestTypes={showAllPlatformRequestTypes}
                    setShowAllPlatformRequestTypes={setShowAllPlatformRequestTypes}
                    quickPickPrimaryStyles={quickPickPrimaryStyles}
                    setQuickPickPrimaryStyles={setQuickPickPrimaryStyles}
                    quickPickSecondaryModifiers={quickPickSecondaryModifiers}
                    setQuickPickSecondaryModifiers={setQuickPickSecondaryModifiers}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{message.message}</p>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.attachments.map((attachment, index) => (
                  <div key={index} className="text-xs opacity-75 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {attachment}
                  </div>
                ))}
              </div>
            )}
            <div className={`text-xs mt-2 flex items-center gap-1 ${message.type === 'user' ? (isRecsChat ? 'text-emerald-100' : 'text-indigo-100') : 'text-gray-500'}`}>
              <span>{message.timestamp}</span>
              {message.provider && (
                <>
                  <span>•</span>
                  <span className="font-medium">{message.provider}</span>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
