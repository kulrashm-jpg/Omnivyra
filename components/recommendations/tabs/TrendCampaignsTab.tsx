import React from 'react';
import TrendCampaignsHistoryDrawer from './TrendCampaignsHistoryDrawer';
import TrendCampaignsRecommendationCards from './TrendCampaignsRecommendationCards';
import AIGenerationProgress from '../../AIGenerationProgress';
import { useTrendCampaignsState } from './useTrendCampaignsState';
import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import ReactDOM from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ISO_COUNTRIES, matchCountry } from './TrendCampaignsTabHelpers';
import { TARGET_AUDIENCE_CATEGORIES, PROFESSIONAL_SEGMENTS } from '../../../lib/audienceCategories';
import { PRIMARY_OPTIONS, PERSONAL_BRAND_SECONDARY_GROUPS, getSecondaryOptionsForPrimary, isPersonalBrandPrimary, type PrimaryCampaignTypeId, type SecondaryOptionId } from '../../../lib/campaignTypeHierarchy';
import TrendCampaignsExecutionForm from './TrendCampaignsExecutionForm';

type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & {
  communicationStyle?: string[];
  primaryCampaignType?: PrimaryCampaignTypeId;
  secondaryCampaignTypes?: SecondaryOptionId[];
};

export default function TrendCampaignsTab(props: OpportunityTabProps) {
  const d = useTrendCampaignsState(props);
  const {
    showNoCompanyMessage, polledJob,
    additionalDirection,
    appliedMixSignatureRef,
    archivedEngineCards,
    aspectOfferingsMap,
    aspects,
    assistPanelOpen,
    assistResolverRef,
    assistTopic,
    autoRunIntelligentMixRef,
    blogPrefillFiredRef,
    boltProgress,
    boltTextPreset,
    buildAiChatExecutionConfig,
    buildStrategicPayload,
    campaignFocusLabels,
    campaignGoal,
    campaignId,
    cardBuildError,
    cardsSectionRef,
    clusterBridgeConsumedRef,
    clusterInputs,
    communicationStyle,
    companyId,
    consolidatedResult,
    contentDepth,
    contextMode,
    customAngle,
    customPillars,
    customTitle,
    dilutionSeverity,
    engineRecommendationCards,
    engineRecommendationSource,
    engineRecommendations,
    executionCalendarOpen,
    executionCollapsed,
    executionSectionRefs,
    fastLoadingCardId,
    fetchProfile,
    fetchWithAuth,
    firstCardRef,
    focusFirstMissingExecutionField,
    focusedModules,
    frequencyPerWeek,
    generatedCampaignId,
    generatedEngineRecommendations,
    handleAddCustomPillar,
    handleAssistConfirm,
    handleAssistSkip,
    handleRun,
    handleRunClick,
    handleViewIntelligence,
    hasRun,
    hasStrategicMixPrefill,
    hierarchicalPayload,
    highlightedState,
    historyDrawerOpen,
    historyLoading,
    initialBlogId,
    insightSource,
    intelligentMixContext,
    intelligentMixSignature,
    intentSummary,
    intentSummaryContent,
    isExecutionFormComplete,
    isExecutionValid,
    isMountedRef,
    isSubmitting,
    isValid,
    jobError,
    jobHistory,
    jobId,
    jobRegionCount,
    jobStatus,
    lastStrategicPayload,
    longTermEngineCards,
    meterReveal,
    mixPreFilled,
    modeHint,
    modeIndicatorLabel,
    offeringFacetCards,
    offeringsForSelectedAspect,
    onStrategicIntentsChange,
    openAssistPanel,
    pendingAssistContextRef,
    prevConcentrationRef,
    prevSubmittingRef,
    primaryCampaignType,
    professionalDropdownOpen,
    professionalDropdownRect,
    professionalDropdownRef,
    professionalPortalRef,
    professionalSegments,
    professionalTriggerRef,
    pulseBridgeConsumedRef,
    rankedEngineCardsWithStatus,
    recommendationRefinements,
    recommendationSignals,
    recommendationUserStateMap,
    regionDropdownOpen,
    regionInput,
    regionInputRef,
    regionWarning,
    regions,
    requiredExecutionFields,
    router,
    secondaryCampaignTypes,
    selectPrimary,
    selectedAspects,
    selectedFacets,
    setAdditionalDirection,
    setAssistPanelOpen,
    setAssistTopic,
    setBoltProgress,
    setCampaignGoal,
    setCardBuildError,
    setClusterInputs,
    setCommunicationStyle,
    setConsolidatedResult,
    setContentDepth,
    setContextMode,
    setCustomAngle,
    setCustomPillars,
    setCustomTitle,
    setExecutionCalendarOpen,
    setExecutionCollapsed,
    setFastLoadingCardId,
    setFocusedModules,
    setFrequencyPerWeek,
    setGeneratedCampaignId,
    setGeneratedEngineRecommendations,
    setHasRun,
    setHistoryDrawerOpen,
    setHistoryLoading,
    setInsightSource,
    setIsSubmitting,
    setJobError,
    setJobHistory,
    setJobId,
    setJobRegionCount,
    setJobStatus,
    setLastStrategicPayload,
    setMeterReveal,
    setMixPreFilled,
    setModeHint,
    setPrimaryCampaignType,
    setProfessionalDropdownOpen,
    setProfessionalDropdownRect,
    setProfessionalSegments,
    setRecommendationRefinements,
    setRecommendationSignals,
    setRecommendationUserStateMap,
    setRegionDropdownOpen,
    setRegionInput,
    setRegionWarning,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowAddCustomForm,
    setShowMissingFieldsMessage,
    setShowStrategicSetupEditor,
    setShowStrategyDetails,
    setStrategicConfig,
    setStrategicText,
    setStrategyGuidanceMode,
    setStrategyHistory,
    setStrategyModeWithHint,
    setStrategyStatusPayload,
    setTargetAudience,
    setTentativeStartDate,
    setUsedRecommendationIds,
    setValidationError,
    showAddCustomForm,
    showMissingFieldsMessage,
    showStrategicSetupEditor,
    showStrategyDetails,
    stabilizationRecommendation,
    strategicConfig,
    strategicFlowState,
    strategicIntents,
    strategicText,
    strategyDrift,
    strategyFocusLabel,
    strategyGuidanceMode,
    strategyHistory,
    strategyStatusPayload,
    suggestedStrategyExplanation,
    suggestedStrategyMode,
    targetAudience,
    tentativeStartDate,
    themesSectionRef,
    toggleSecondary,
    usedRecommendationIds,
    validationError,
    viewMode,
    visibleEngineCards,
    visibleEngineCardsWithStatus,
    workspaceSummaryData,
  } = d;

  if (showNoCompanyMessage) {
    return <div className="text-sm text-gray-500 py-4">Select a company to view strategic themes.</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── BOLT (Text) mode banner ─────────────────────────────────────── */}
      {boltTextPreset && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <span className="text-xl">⚡</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">BOLT (Text) Mode</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {boltTextPreset.contentFormat.replace('_', ' ')} · {boltTextPreset.durationWeeks} week{boltTextPreset.durationWeeks > 1 ? 's' : ''} · {boltTextPreset.outcomeView.replace('_', ' ')}
              {' '}— Each card below has a ready-to-run <strong>⚡ BOLT (Text)</strong> button.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/command-center/bolt-text')}
            className="shrink-0 text-xs text-amber-700 hover:text-amber-900 underline"
          >
            Change setup
          </button>
        </div>
      )}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Strategic Theme Builder</h2>
          <p className="mt-1 text-sm text-gray-600">
            Build scalable campaign pillars around high-impact themes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryDrawerOpen(true)}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Job History
        </button>
      </header>
      <TrendCampaignsExecutionForm d={d} />
      {validationError && <div className="text-sm text-red-600">{validationError}</div>}
      <TrendCampaignsRecommendationCards
        companyId={companyId}
        fetchWithAuth={fetchWithAuth}
        router={router}
        viewMode={viewMode}
        initialBlogId={initialBlogId}
        intelligentMixContext={intelligentMixContext}
        hasRun={hasRun}
        isSubmitting={isSubmitting}
        isExecutionFormComplete={isExecutionFormComplete}
        handleRunClick={handleRunClick}
        visibleEngineCards={visibleEngineCards}
        rankedEngineCardsWithStatus={rankedEngineCardsWithStatus}
        archivedEngineCards={archivedEngineCards}
        longTermEngineCards={longTermEngineCards}
        consolidatedResult={consolidatedResult}
        workspaceSummaryData={workspaceSummaryData}
        customPillars={customPillars}
        showAddCustomForm={showAddCustomForm}
        setShowAddCustomForm={setShowAddCustomForm}
        customTitle={customTitle}
        setCustomTitle={setCustomTitle}
        customAngle={customAngle}
        setCustomAngle={setCustomAngle}
        handleAddCustomPillar={handleAddCustomPillar}
        strategyDrift={strategyDrift}
        strategyFocusLabel={strategyFocusLabel}
        meterReveal={meterReveal}
        modeHint={modeHint}
        strategyGuidanceMode={strategyGuidanceMode}
        setStrategyModeWithHint={setStrategyModeWithHint}
        showStrategyDetails={showStrategyDetails}
        setShowStrategyDetails={setShowStrategyDetails}
        suggestedStrategyMode={suggestedStrategyMode}
        suggestedStrategyExplanation={suggestedStrategyExplanation}
        stabilizationRecommendation={stabilizationRecommendation}
        strategicFlowState={strategicFlowState}
        strategyStatusPayload={strategyStatusPayload}
        recommendationUserStateMap={recommendationUserStateMap}
        setRecommendationUserStateMap={setRecommendationUserStateMap}
        recommendationSignals={recommendationSignals}
        setRecommendationSignals={setRecommendationSignals}
        setRecommendationRefinements={setRecommendationRefinements}
        usedRecommendationIds={usedRecommendationIds}
        setUsedRecommendationIds={setUsedRecommendationIds}
        cardBuildError={cardBuildError}
        setCardBuildError={setCardBuildError}
        setValidationError={setValidationError}
        boltTextPreset={boltTextPreset}
        boltProgress={boltProgress}
        setBoltProgress={setBoltProgress}
        fastLoadingCardId={fastLoadingCardId}
        setFastLoadingCardId={setFastLoadingCardId}
        generatedCampaignId={generatedCampaignId}
        setGeneratedCampaignId={setGeneratedCampaignId}
        assistPanelOpen={assistPanelOpen}
        assistTopic={assistTopic}
        openAssistPanel={openAssistPanel}
        handleAssistConfirm={handleAssistConfirm}
        handleAssistSkip={handleAssistSkip}
        targetAudience={targetAudience}
        tentativeStartDate={tentativeStartDate}
        campaignGoal={campaignGoal}
        frequencyPerWeek={frequencyPerWeek}
        contentDepth={contentDepth}
        communicationStyle={communicationStyle}
        professionalSegments={professionalSegments}
        buildAiChatExecutionConfig={buildAiChatExecutionConfig}
        jobId={jobId}
        jobStatus={jobStatus}
        jobError={jobError}
        polledJob={polledJob}
        highlightedState={highlightedState}
        cardsSectionRef={cardsSectionRef}
        themesSectionRef={themesSectionRef}
        firstCardRef={firstCardRef}
        isMountedRef={isMountedRef}
      />
      {isSubmitting && (
        <div className="py-6">
          <AIGenerationProgress
            isActive={true}
            message="Generating strategic themes…"
            expectedSeconds={50}
          />
        </div>
      )}

      <TrendCampaignsHistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        loading={historyLoading}
        jobHistory={jobHistory}
        onViewIntelligence={handleViewIntelligence}
      />
    </div>
  );
}
