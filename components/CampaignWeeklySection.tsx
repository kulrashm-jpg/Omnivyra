import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  X,
  Sparkles,
  Eye,
  BarChart3,
  Users,
  Hash,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Settings,
  GripVertical,
  RotateCcw,
  Activity,
} from 'lucide-react';
import CampaignAIChat from './CampaignAIChat';
import AIGenerationProgress from './AIGenerationProgress';
import { useCompanyContext } from './CompanyContext';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import { GovernanceStatusCard } from './governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from './governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from './governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from './governance/GovernanceTimeline';
import { PreemptionHistory } from './governance/PreemptionHistory';
import { TradeOffSuggestionList } from './governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../lib/ui/truncateMeaningfulTitle';
import { getExecutionIntelligence } from '../utils/getExecutionIntelligence';
import { isCreatorDependentContentType } from '../utils/contentTaxonomy';
import { getFormatLineForContentType, getIntentLabelForContentType, toneForUserDisplay } from '../utils/formatLineForContentType';
import PlatformIcon from './ui/PlatformIcon';
import { getViewMode } from '../utils/getViewMode';
import { VIEW_RULES } from '../utils/viewVisibilityMatrix';
import {
  saveWizardState,
  loadWizardState,
  clearWizardState,
  defaultQuestionnaireAnswers,
  type QuestionnaireAnswers,
  type PrePlanningResult,
} from '../utils/campaignWizardStorage';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../config/featureFlags';
import { useCampaignWizard, createCampaignWizardStore } from '../store/campaignWizardStore';
import { hydrateWizardFromSnapshot, exportWizardToSaveWizardStatePayload, exportWizardToPlanningContext } from '../lib/wizard/campaignWizardAdapter';
import { useCampaignResume } from '../hooks/useCampaignResume';
import { PLATFORM_LABELS } from '../lib/shared/platforms';

import WeekCard from './WeekCard';
import type { useCampaignDetailsState } from '../hooks/useCampaignDetailsState';
type S = ReturnType<typeof useCampaignDetailsState>;
import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';

export default function CampaignWeeklySection({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    _ef3,
    _ef4,
    _ef5,
    acceptDuration,
    activeTab,
    aiSuggestion,
    aiSuggestionLoading,
    blueprintFrozen,
    blueprintGeneratedSuccess,
    blueprintImmutable,
    blueprintRegenerateFailedMsg,
    buildCampaignCalendarUrl,
    buildCampaignDetailsUrl,
    buildDailyPlanPageUrl,
    buildPlanningWorkspaceUrl,
    campaign,
    campaignMode,
    createWeekPlanFromStoredContext,
    crossPlatformSharingEnabled,
    crossPlatformSharingEnabledLegacy,
    dailyPlans,
    didAutoOpenChatRef,
    displayWeeklyTitle,
    distributionMode,
    durationWeeks,
    editedWeekDailyPlans,
    effectiveCompanyId,
    enhanceAllWeeksWithAI,
    enhanceWeekWithAI,
    executionDrift,
    executionHealth,
    executionMomentum,
    executionMomentumRecovery,
    executionPressure,
    expandedDiagnostics,
    expandedSystemWeek,
    expandedWeeks,
    fetchAiDurationSuggestion,
    focusQueryValue,
    frequencyValidation,
    frequencyValidationTimeoutRef,
    fromOpportunity,
    getActivityColorClasses,
    getConfidenceBadgeColor,
    getGateBadgeColor,
    getGateLabel,
    getPhaseColor,
    getStageColor,
    getStageLabel,
    getStatusColor,
    getWeekDatesFromCampaignStart,
    governanceAnalytics,
    governanceAuditStatus,
    governanceEvents,
    governanceLatestSnapshotId,
    governanceLedgerIntegrity,
    governanceLoadGuardCounts,
    governanceLoading,
    governanceLocked,
    governanceSnapshotAt,
    governanceSnapshotCount,
    governanceStatus,
    handleDailyPlanDragOver,
    handleDailyPlanDragStart,
    handleDailyPlanDrop,
    hasRestoredWizardStateRef,
    isAdmin,
    isEnhancingAllWeeks,
    isGeneratingWeek,
    isLoading,
    isRegeneratingBlueprint,
    isSavingWeekPlan,
    isViralityExpanded,
    isVisualContentType,
    isWeeklyBlueprintFocus,
    loadCampaignDetails,
    loadGovernance,
    needsPrePlanning,
    negotiationLoading,
    negotiationMessage,
    negotiationResult,
    normalizeComparableText,
    notice,
    notify,
    openCampaignCalendar,
    openTopicWorkspaceFromWeeklyCard,
    performanceSummary,
    planDurationLimit,
    plannedStartDate,
    plannedStartDateLegacy,
    plannerQueryConsumed,
    prePlanningLoading,
    prePlanningResult,
    prePlanningResultLegacy,
    prePlanningWizardStep,
    prePlanningWizardStepLegacy,
    prefilledPlanning,
    questionnaireAnswers,
    questionnaireAnswersLegacy,
    readiness,
    recommendationContext,
    recommendationId,
    recommendationSummary,
    regenerateWeekDailyPlan,
    requestedWeeksForPreplan,
    router,
    runPrePlanningFlow,
    saveWeekDailyPlan,
    selectedCompanyId,
    selectedWeekDay,
    session,
    setActiveTab,
    setAiSuggestion,
    setAiSuggestionLoading,
    setBlueprintFrozen,
    setBlueprintGeneratedSuccess,
    setBlueprintImmutable,
    setBlueprintRegenerateFailedMsg,
    setCampaign,
    setCampaignMode,
    setCrossPlatformSharingEnabled,
    setCrossPlatformSharingEnabledLegacy,
    setDailyPlans,
    setDistributionMode,
    setEditedWeekDailyPlans,
    setExecutionDrift,
    setExecutionHealth,
    setExecutionMomentum,
    setExecutionMomentumRecovery,
    setExecutionPressure,
    setExpandedDiagnostics,
    setExpandedSystemWeek,
    setExpandedWeeks,
    setFrequencyValidation,
    setGovernanceAnalytics,
    setGovernanceAuditStatus,
    setGovernanceEvents,
    setGovernanceLatestSnapshotId,
    setGovernanceLedgerIntegrity,
    setGovernanceLoadGuardCounts,
    setGovernanceLoading,
    setGovernanceLocked,
    setGovernanceSnapshotAt,
    setGovernanceSnapshotCount,
    setGovernanceStatus,
    setIsAdmin,
    setIsEnhancingAllWeeks,
    setIsGeneratingWeek,
    setIsLoading,
    setIsRegeneratingBlueprint,
    setIsSavingWeekPlan,
    setIsViralityExpanded,
    setNegotiationLoading,
    setNegotiationMessage,
    setNegotiationResult,
    setNotice,
    setPerformanceSummary,
    setPlanDurationLimit,
    setPlannedStartDate,
    setPlannedStartDateLegacy,
    setPlannerQueryConsumed,
    setPrePlanningLoading,
    setPrePlanningResult,
    setPrePlanningResultLegacy,
    setPrePlanningWizardStep,
    setPrePlanningWizardStepLegacy,
    setPrefilledPlanning,
    setQuestionnaireAnswers,
    setQuestionnaireAnswersLegacy,
    setReadiness,
    setRecommendationContext,
    setRecommendationId,
    setRecommendationSummary,
    setRequestedWeeksForPreplan,
    setSelectedCompanyId,
    setSelectedWeekDay,
    setShowAIChat,
    setShowAdvisoryNotes,
    setShowRequiredActions,
    setViralityDiagnostics,
    setViralityGate,
    setWeeklyPlans,
    shouldForceWeeklyBlueprintView,
    showAIChat,
    showAdvisoryNotes,
    showRequiredActions,
    toggleDiagnostic,
    toggleWeekExpansion,
    viewMode,
    viralityDiagnostics,
    viralityGate,
    weeklyPlans,
    wizardStateDbSaveTimeoutRef,
    wizardStore,
    id,
  } = d;

  return (
    <>
            {/* Weekly Content — blueprint per week, placed in weeks below */}
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border mb-8" id="weekly-content">
              {(() => {
                const hasStartDate = !!(campaign as { start_date?: string }).start_date;
                const hasDuration = !!(campaign as { duration_weeks?: number }).duration_weeks;
                const canPlanDaily = hasStartDate && hasDuration;
                return canPlanDaily ? null : (
                  <div id="pre-planning" className="mb-6 p-4 rounded-lg border-2 border-amber-200 bg-amber-50">
                    <div className="flex items-center gap-2 font-semibold text-amber-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Fix start date and tentative duration before planning daily content
                    </div>
                    <p className="mt-1 text-sm text-amber-700">
                      Complete pre-planning to set campaign start date and duration. Daily plans will be available once these are confirmed.
                    </p>
                  </div>
                );
              })()}
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Weekly Content</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Blueprint per week; expand each week for details.
                    <button
                      type="button"
                      onClick={() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth' })}
                      className="ml-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium underline"
                    >
                      ↑ Back to Content Blueprint
                    </button>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={enhanceAllWeeksWithAI}
                    disabled={!campaign?.start_date || !(campaign as any).duration_weeks || isEnhancingAllWeeks}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!campaign?.start_date || !(campaign as any).duration_weeks
                      ? "Set campaign start date and duration in pre-planning first."
                      : "AI generates daily activities for all weeks from the weekly plan, then opens the daily planner."}
                  >
                    {isEnhancingAllWeeks ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isEnhancingAllWeeks ? 'Generating…' : 'Generate Daily Plans (AI)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(buildDailyPlanPageUrl(campaign.id))}
                    disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                    className="px-4 py-2 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!campaign?.start_date || !(campaign as any).duration_weeks
                      ? "Set campaign start date and duration in pre-planning first."
                      : "Open the daily planner to view, drag, and manage existing activities week by week."}
                  >
                    <Calendar className="h-4 w-4" />
                    Open Daily Planner
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {Array.from({ length: durationWeeks }, (_, i) => i + 1).map(weekNumber => (
                  <WeekCard key={weekNumber} weekNumber={weekNumber} d={d} />
                ))}
              </div>
            </div>

    </>
  );
}

