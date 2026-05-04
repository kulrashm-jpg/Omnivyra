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
import { apiFetch } from '@/lib/apiFetch';
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
import { PLATFORM_LABELS } from '../backend/constants/platforms';

import CampaignWeeklySection from './CampaignWeeklySection';
import type { useCampaignDetailsState } from '../hooks/useCampaignDetailsState';
type S = ReturnType<typeof useCampaignDetailsState>;
import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';

export default function CampaignDetailsContent({ d }: { d: S }) {
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
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>{campaign?.name ? `${durationWeeks}-Week Campaign Plan – ${campaign.name}` : 'Campaign Plan'}</title>
      </Head>
      {router.query.fromRecommendation && recommendationId && (
        <div className="bg-indigo-50 border-b border-indigo-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 text-sm text-indigo-800">
            Created from Recommendation {recommendationId}
          </div>
        </div>
      )}
      {notice && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        </div>
      )}
      {/* Header — compact nav, title, status, actions */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
            <button
              onClick={() => router.push('/campaigns')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors self-start"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Campaigns
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push(`/campaign-health/${campaign.id}`)}
                className="px-3 py-1.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" />
                View Campaign Health
              </button>
              <button
                onClick={() => router.push(`/campaigns/${campaign.id}/recommendations`)}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Expert Recommendations
              </button>
              {isAdmin && (
                <button
                  onClick={() => router.push(`/recommendations/policy?campaignId=${campaign.id}`)}
                  className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1.5"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Policy
                </button>
              )}
              <button
                onClick={() => setShowAIChat(true)}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI Assistant
              </button>
            </div>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight max-w-4xl" title={campaign.name}>
              {(() => {
                const words = (campaign.name || '').trim().split(/\s+/).filter(Boolean);
                return words.length > 8 ? words.slice(0, 8).join(' ') + '…' : campaign.name;
              })()}
              {campaignMode === 'fast' && (
                <span className="ml-2 text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
                  ⚡ Fast Mode
                </span>
              )}
            </h1>
            <p className="text-xs text-gray-500 mt-1">Content Marketing Plan · ID: {campaign.id}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStageColor(campaign.current_stage || campaign.status)}`}>
                {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
              </span>
              <span className="text-xs text-gray-600">
                Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                {getGateLabel(viralityGate?.gate_decision)}
              </span>
              <span className="text-xs text-gray-500">
                {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'}
                {campaign.end_date ? ` – ${new Date(campaign.end_date).toLocaleDateString()}` : ''}
              </span>
              {executionHealth != null && (
                <span
                  className={
                    executionHealth.state === 'EXCELLENT'
                      ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
                      : executionHealth.state === 'GOOD'
                        ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700'
                        : executionHealth.state === 'WARNING'
                          ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
                          : 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800'
                  }
                >
                  Health: {executionHealth.score ?? 0}% {executionHealth.state ?? '—'}
                </span>
              )}
              {executionPressure?.pressureLevel && (
                <span
                  className={
                    executionPressure.pressureLevel === 'HIGH'
                      ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
                      : executionPressure.pressureLevel === 'LOW'
                        ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700'
                        : 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
                  }
                >
                  Pressure: {executionPressure.pressureLevel}
                  {executionPressure.pressureLevel === 'HIGH' &&
                  (executionPressure.aiAssistAdded != null ||
                    executionPressure.formatsAdjusted != null ||
                    executionPressure.postsRedistributed != null)
                    ? ' ⚠ Auto-balanced'
                    : executionPressure.pressureLevel === 'HIGH' && executionPressure.manualReviewRecommended
                      ? ' — Manual review recommended'
                      : ''}
                </span>
              )}
              {executionMomentum?.state && (
                <span
                  className={
                    executionMomentum.state === 'WEAK'
                      ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
                      : executionMomentum.state === 'STRONG'
                        ? 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
                        : 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700'
                  }
                >
                  Momentum: {executionMomentum.state}
                  {executionMomentum.state === 'WEAK' ? ' ⚠' : ''}
                </span>
              )}
              {executionDrift?.state && executionDrift.state !== 'NONE' && (
                <span
                  title={
                    executionDrift.state === 'MAJOR'
                      ? 'Campaign execution has significantly diverged from the plan. See Execution Intelligence below for how to fix.'
                      : executionDrift.state === 'MINOR'
                        ? 'Minor drift detected. Review upcoming weeks to stay aligned with the campaign plan.'
                        : undefined
                  }
                  className={
                    executionDrift.state === 'MAJOR'
                      ? 'cursor-help px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800'
                      : executionDrift.state === 'MINOR'
                        ? 'cursor-help px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
                        : 'px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700'
                  }
                >
                  {executionDrift.state === 'MAJOR' ? '⚠ Drift: Major — needs attention' : executionDrift.state === 'MINOR' ? '⚠ Drift: Minor' : `Drift: ${executionDrift.state}`}
                </span>
              )}
            </div>
            {(executionPressure || executionMomentum || executionMomentumRecovery || executionDrift || executionHealth) &&
              ((executionPressure &&
                (executionPressure.aiAssistAdded != null ||
                  executionPressure.formatsAdjusted != null ||
                  executionPressure.postsRedistributed != null ||
                  executionPressure.platformStaggeringSuggested ||
                  executionPressure.manualReviewRecommended)) ||
                executionMomentum?.state ||
                (executionMomentumRecovery?.suggestions && executionMomentumRecovery.suggestions.length > 0) ||
                executionDrift?.state ||
                executionHealth != null) && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                <div className="font-semibold text-gray-800 mb-1">Execution Intelligence</div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-600">
                  {executionHealth != null && (
                    <span>
                      Health: {executionHealth.score ?? 0}% {executionHealth.state ?? '—'}
                    </span>
                  )}
                  {executionPressure?.pressureLevel != null && (
                    <span>Pressure: {executionPressure.pressureLevel}</span>
                  )}
                  {executionMomentum?.state != null && (
                    <span>
                      Momentum: {executionMomentum.state}
                      {executionMomentum.state === 'WEAK' && ' ⚠'}
                    </span>
                  )}
                  {executionMomentum?.state === 'WEAK' && (
                    <span className="text-amber-700">Narrative drift detected</span>
                  )}
                  {executionMomentum?.warnings && executionMomentum.warnings.length > 0 && (
                    <span className="text-amber-700">{executionMomentum.warnings[0]}</span>
                  )}
                  {executionPressure?.manualReviewRecommended && (
                    <span className="font-medium text-amber-700">Manual review recommended</span>
                  )}
                  {executionPressure?.aiAssistAdded != null && executionPressure.aiAssistAdded > 0 && (
                    <span>AI Assist Added: {executionPressure.aiAssistAdded} pieces</span>
                  )}
                  {executionPressure?.formatsAdjusted != null && executionPressure.formatsAdjusted > 0 && (
                    <span>Formats Adjusted: {executionPressure.formatsAdjusted}</span>
                  )}
                  {executionPressure?.postsRedistributed != null && executionPressure.postsRedistributed > 0 && (
                    <span>Posts Redistributed: {executionPressure.postsRedistributed}</span>
                  )}
                  {executionPressure?.platformStaggeringSuggested && (
                    <span>Platform staggering suggested</span>
                  )}
                  {executionDrift?.state != null && (
                    <span>
                      Drift: {executionDrift.state}
                      {(executionDrift.state === 'MAJOR' || executionDrift.state === 'MINOR') && ' ⚠'}
                    </span>
                  )}
                  {executionDrift?.state === 'MAJOR' && (
                    <span className="text-red-700">Campaign execution has drifted significantly from the plan.</span>
                  )}
                  {executionDrift?.state === 'MINOR' && (
                    <span className="text-amber-700">Small drift detected — review upcoming weeks to stay on track.</span>
                  )}
                  {executionDrift?.warnings && executionDrift.warnings.length > 0 && (
                    <span className="text-amber-700">{executionDrift.warnings[0]}</span>
                  )}
                  {executionDrift?.driftScore != null && (
                    <span>Drift score: {Math.round(executionDrift.driftScore * 100)}%</span>
                  )}
                </div>
                {(executionDrift?.state === 'MAJOR' || executionDrift?.state === 'MINOR') && (() => {
                  const suggestions: string[] = executionDrift?.recoverySuggestions && executionDrift.recoverySuggestions.length > 0
                    ? executionDrift.recoverySuggestions
                    : (() => {
                        const s = executionDrift?.signals ?? {};
                        const tips: string[] = [];
                        if ((s.schedule ?? 0) > 0.3) tips.push('Reschedule overdue posts — align posting dates with the original campaign calendar');
                        if ((s.topic ?? 0) > 0.3) tips.push('Realign content topics — upcoming posts should follow the planned topic progression from the blueprint');
                        if ((s.format ?? 0) > 0.3) tips.push('Adjust content formats — restore the planned mix of posts, articles, and other formats');
                        if (tips.length === 0) {
                          if (executionDrift?.state === 'MAJOR') {
                            tips.push('Use "Optimize Week" to auto-correct the plan for affected weeks');
                            tips.push('Review the weekly blueprint and update topic assignments for upcoming posts');
                            tips.push('Check for cancelled or skipped posts that have left gaps in the schedule');
                          } else {
                            tips.push('Use "Optimize Week" to auto-correct minor misalignments');
                            tips.push('Review the next 1–2 weeks and confirm topics match the campaign blueprint');
                          }
                        }
                        return tips;
                      })();
                  return (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <div className="font-medium text-gray-700 mb-1">How to fix drift:</div>
                      <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                        {suggestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                {executionMomentumRecovery?.suggestions && executionMomentumRecovery.suggestions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <div className="font-medium text-gray-700 mb-1">Suggested improvements:</div>
                    <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                      {executionMomentumRecovery.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'overview'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'performance'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Performance
          </button>
          <button
            onClick={() => setActiveTab('governance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'governance'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Governance
          </button>
        </div>
        {router.query.fromRecommendation && recommendationId && (
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border mb-8">
            <h2 className="text-xl font-semibold mb-4">Recommendation Summary</h2>
            {recommendationSummary ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-700">
                <div>
                  <div className="font-medium text-gray-900">Trend</div>
                  <div>{recommendationSummary.trend || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Category</div>
                  <div>{recommendationSummary.category || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Promotion</div>
                  <div>{recommendationSummary.promotion_mode || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Audience</div>
                  <div>
                    {typeof recommendationSummary.audience === 'string'
                      ? recommendationSummary.audience
                      : JSON.stringify(recommendationSummary.audience)}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Geo</div>
                  <div>
                    {typeof recommendationSummary.geo === 'string'
                      ? recommendationSummary.geo
                      : JSON.stringify(recommendationSummary.geo)}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Platforms</div>
                  <div>
                    {Array.isArray(recommendationSummary.platforms)
                      ? recommendationSummary.platforms.map((p: any) => p.platform || p).join(', ')
                      : JSON.stringify(recommendationSummary.platforms)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Recommendation details unavailable.</p>
            )}
          </div>
        )}
        {activeTab === 'overview' && (
          <>
            {blueprintGeneratedSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
                <p className="text-emerald-800 text-sm flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  Blueprint generated! Use the <strong>AI Assistant</strong> below to refine it.
                </p>
                <button
                  type="button"
                  onClick={() => setBlueprintGeneratedSuccess(false)}
                  className="flex-shrink-0 p-1 text-emerald-700 hover:text-emerald-900"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {/* Stage 11: Generate blueprint when duration set and blueprint invalidated */}
            {(campaign as Campaign & { blueprint_status?: string | null }).blueprint_status === 'INVALIDATED' && !blueprintImmutable && !blueprintFrozen && !governanceLocked && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-semibold text-amber-900 mb-2">Blueprint required</h2>
                {blueprintRegenerateFailedMsg && (
                  <div className="mb-4 p-3 bg-amber-100 border border-amber-300 rounded-lg flex items-center justify-between gap-2">
                    <p className="text-amber-900 text-sm">
                      Blueprint generation could not be completed automatically: {blueprintRegenerateFailedMsg}
                    </p>
                    <button
                      type="button"
                      onClick={() => setBlueprintRegenerateFailedMsg(null)}
                      className="flex-shrink-0 p-1 text-amber-700 hover:text-amber-900"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <p className="text-amber-800 mb-4">
                  Duration is set. Generate a campaign blueprint to continue.
                </p>
                <button
                  onClick={async () => {
                    if (!campaign || !effectiveCompanyId) return;
                    setIsRegeneratingBlueprint(true);
                    setBlueprintRegenerateFailedMsg(null);
                    try {
                      let planningContext: Record<string, unknown> | undefined;
                      if (typeof window !== 'undefined') {
                        const stored = sessionStorage.getItem(`campaign_planning_context_${campaign.id}`);
                        if (stored) {
                          try {
                            planningContext = JSON.parse(stored) as Record<string, unknown>;
                          } catch {
                            /* ignore */
                          }
                        }
                      }
                      const res = await apiFetch('/api/campaigns/regenerate-blueprint', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          campaignId: campaign.id,
                          companyId: effectiveCompanyId,
                          ...(planningContext && Object.keys(planningContext).length > 0 ? { planningContext } : {}),
                        }),
                      });
                      if (res.ok) {
                        if (typeof window !== 'undefined') {
                          sessionStorage.removeItem(`campaign_planning_context_${campaign.id}`);
                        }
                        loadCampaignDetails(campaign.id);
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        setBlueprintRegenerateFailedMsg(errData?.message || errData?.error || 'Generation failed');
                      }
                    } catch (err) {
                      console.error('Regenerate blueprint failed', err);
                      setBlueprintRegenerateFailedMsg(err instanceof Error ? err.message : 'Generation failed');
                    } finally {
                      setIsRegeneratingBlueprint(false);
                    }
                  }}
                  disabled={isRegeneratingBlueprint || governanceLocked}
                  className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {isRegeneratingBlueprint ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
                  Generate Campaign Blueprint
                </button>
                {isRegeneratingBlueprint && (
                  <div className="mt-4">
                    <AIGenerationProgress
                      isActive={true}
                      message="Generating campaign blueprint…"
                      expectedSeconds={50}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Content Blueprint — your created plan; weekly content in weeks below */}
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border mb-8" id="content-blueprint">
              <h2 className="text-xl font-semibold mb-1">Content Blueprint</h2>
              <p className="text-sm text-gray-500 mb-4">
                Your submitted plan; weekly content is listed in the weeks below.
                <button
                  type="button"
                  onClick={() => document.getElementById('weekly-content')?.scrollIntoView({ behavior: 'smooth' })}
                  className="ml-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium underline"
                >
                  Jump to Weekly Content ↓
                </button>
              </p>
              {campaign?.description && <p className="text-gray-600 mb-4">{campaign.description}</p>}
              {weeklyPlans.length > 0 ? (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-sm font-medium text-gray-700">Blueprint summary: </span>
                  <span className="text-sm text-gray-600">
                    {weeklyPlans
                      .sort((a, b) => a.weekNumber - b.weekNumber)
                      .map((w) => `Week ${w.weekNumber}: ${displayWeeklyTitle(w.theme || w.phase || w.focusArea, 'Untitled Topic')}`)
                      .join(' • ')}
                  </span>
                </div>
              ) : (
                <div className="mb-4 p-4 bg-amber-50 rounded-lg border-2 border-amber-300">
                  <p className="text-sm font-medium text-amber-900 mb-2">
                    No content blueprint yet
                  </p>
                  <p className="text-sm text-amber-800 mb-4">
                    Use <strong>AI Assistant</strong> (purple button above) to generate a plan, or create one from your stored strategic theme and context:
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={createWeekPlanFromStoredContext}
                      disabled={isRegeneratingBlueprint || blueprintImmutable || governanceLocked || (campaign as { duration_weeks?: number })?.duration_weeks == null}
                      title={(campaign as { duration_weeks?: number })?.duration_weeks == null ? 'Set campaign duration first (complete pre-planning above)' : undefined}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      {isRegeneratingBlueprint ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      Create week plan from stored context
                    </button>
                    {(campaign as { duration_weeks?: number })?.duration_weeks == null && (
                      <span className="text-xs text-amber-700">
                        Set start date and duration in pre-planning above first.
                      </span>
                    )}
                  </div>
                  {blueprintRegenerateFailedMsg && (
                    <p className="mt-3 text-sm text-red-600">{blueprintRegenerateFailedMsg}</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600 mb-1">{durationWeeks}</div>
                  <div className="text-sm text-gray-600">Total Weeks</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'completed').length}
                  </div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'in_progress').length}
                  </div>
                  <div className="text-sm text-gray-600">In Progress</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'planned').length}
                  </div>
                  <div className="text-sm text-gray-600">Planned</div>
                </div>
              </div>
            </div>

            <CampaignWeeklySection d={d} />

            {/* Virality Review — readiness check (assets, platforms, engagement); fix blocking issues before scheduling */}
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border mb-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold">Virality Review</h2>
                <button
                  onClick={() => setIsViralityExpanded(!isViralityExpanded)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2"
                >
                  {isViralityExpanded ? 'Hide details' : 'Show details'}
                  {isViralityExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Checks readiness to run this campaign (assets, platforms, engagement). Fix any blocking issues before scheduling.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                  {getGateLabel(viralityGate?.gate_decision)}
                </span>
                <span className="text-sm text-gray-700">
                  Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
                </span>
              </div>

              {(viralityGate?.gate_decision === 'block' || viralityGate?.gate_decision === 'warn') && (viralityGate?.reasons?.length ?? 0) > 0 && (
                <div className={`mb-4 rounded-lg border p-3 ${
                  viralityGate.gate_decision === 'block'
                    ? 'border-red-200 bg-red-50'
                    : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className={`flex items-center gap-2 font-medium mb-2 ${
                    viralityGate.gate_decision === 'block' ? 'text-red-700' : 'text-amber-800'
                  }`}>
                    <AlertCircle className="h-4 w-4" />
                    {viralityGate.gate_decision === 'block' ? 'Blocking reasons' : 'Next steps'}
                  </div>
                  <ul className={`text-sm space-y-1 ${
                    viralityGate.gate_decision === 'block' ? 'text-red-700' : 'text-amber-800'
                  }`}>
                    {(viralityGate?.reasons || []).map((reason, index) => (
                      <li key={`reason-${index}`} className="flex items-start gap-2">
                        <span className="mt-0.5">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mb-3">
                <button
                  onClick={() => setShowRequiredActions(!showRequiredActions)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showRequiredActions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Required actions
                  {viralityGate?.required_actions?.length ? (
                    <span className="text-gray-500 font-normal">({viralityGate.required_actions.length})</span>
                  ) : null}
                </button>
                {showRequiredActions && (
                  <div className="mt-2 pl-4 border-l-2 border-gray-200">
                    {viralityGate?.required_actions?.length ? (
                      <div className="space-y-2">
                        {viralityGate.required_actions.map((action, index) => (
                          <div key={`action-${index}`} className="rounded-lg border p-2.5 text-sm">
                            <div className="font-medium text-gray-900">{action.title}</div>
                            {action.why && <div className="text-gray-600 mt-0.5">{action.why}</div>}
                            <div className="text-gray-600 mt-1">{action.action}</div>
                            {action.applies_to_platforms?.length ? (
                              <div className="text-xs text-gray-500 mt-1">
                                Platforms: {action.applies_to_platforms.join(', ')}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No required actions at this time.</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setShowAdvisoryNotes(!showAdvisoryNotes)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showAdvisoryNotes ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Advisory notes
                  {viralityGate?.advisory_notes?.length ? (
                    <span className="text-gray-500 font-normal">({viralityGate.advisory_notes.length})</span>
                  ) : null}
                </button>
                {showAdvisoryNotes && (
                  <div className="mt-2 pl-4 border-l-2 border-gray-200">
                    {viralityGate?.advisory_notes?.length ? (
                      <ul className="text-sm text-gray-600 space-y-1">
                        {viralityGate.advisory_notes.map((note, index) => (
                          <li key={`note-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5">•</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500">No advisory notes available.</p>
                    )}
                  </div>
                )}
              </div>

              {isViralityExpanded && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Diagnostics</h3>
                  {[
                    { key: 'asset_coverage', title: 'Asset Coverage', data: viralityDiagnostics?.diagnostics.asset_coverage },
                    { key: 'platform_opportunity', title: 'Platform Opportunity', data: viralityDiagnostics?.diagnostics.platform_opportunity },
                    { key: 'engagement_readiness', title: 'Engagement Readiness', data: viralityDiagnostics?.diagnostics.engagement_readiness },
                  ].map((item) => (
                    <div key={item.key} className="border rounded-lg mb-3">
                      <button
                        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                        onClick={() => toggleDiagnostic(item.key)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{item.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceBadgeColor(item.data?.diagnostic_confidence)}`}>
                            {item.data?.diagnostic_confidence || 'unknown'}
                          </span>
                        </div>
                        {expandedDiagnostics.has(item.key) ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                      {expandedDiagnostics.has(item.key) && (
                        <div className="px-4 pb-4 text-sm text-gray-600">
                          {item.data?.diagnostic_summary || 'No diagnostic summary available.'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'governance' && (
          <div className="space-y-6">
            {governanceLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : !governanceStatus ? (
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
                <p className="text-sm text-gray-500">Unable to load governance data. Try again later.</p>
              </div>
            ) : (
              <>
                {governanceLocked && (
                  <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 font-medium">
                    Governance Lockdown Active — Mutations Disabled
                  </div>
                )}
                {governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
                  <div className="mb-6 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 font-semibold text-amber-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Execution Window Frozen — Changes Locked (&lt;24h to first scheduled post)
                    </div>
                    <p className="mt-1 text-sm text-amber-700">
                      Duration edit, regenerate blueprint, and negotiation are disabled until after the first scheduled post.
                    </p>
                  </div>
                )}
                {governanceStatus.governance?.blueprintImmutable && !governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
                  <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2 font-semibold text-red-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Blueprint Locked — Campaign In Execution
                    </div>
                    <p className="mt-1 text-sm text-red-700">
                      Duration edit, regenerate blueprint, and negotiation are disabled while the campaign has scheduled or published posts.
                    </p>
                  </div>
                )}
                <GovernanceStatusCard
                  governance={governanceStatus.governance}
                  latestEvent={governanceStatus.latestGovernanceEvent}
                />
                <GovernanceAnalyticsCard
                  analytics={governanceAnalytics}
                  loading={governanceLoading}
                  campaignId={id as string}
                  companyId={effectiveCompanyId ?? undefined}
                  onRefresh={loadGovernance}
                  auditStatus={governanceAuditStatus ?? undefined}
                  governanceLocked={governanceLocked}
                  lastSnapshotAt={governanceSnapshotAt}
                  snapshotCount={governanceSnapshotCount}
                  latestSnapshotId={governanceLatestSnapshotId}
                  isSuperAdmin={isAdmin}
                  ledgerIntegrity={governanceLedgerIntegrity ?? undefined}
                  projectionStatus={governanceAnalytics?.projectionStatus ?? undefined}
                  replayRateLimitedCount={governanceLoadGuardCounts.replayRateLimitedCount}
                  snapshotRestoreBlockedCount={governanceLoadGuardCounts.snapshotRestoreBlockedCount}
                  projectionRebuildBlockedCount={governanceLoadGuardCounts.projectionRebuildBlockedCount}
                  roiIntelligence={governanceAnalytics?.roiIntelligence}
                  optimizationInsights={governanceAnalytics?.optimizationInsights}
                  optimizationProposal={governanceAnalytics?.optimizationProposal ?? null}
                  onApplyProposal={(proposal) => {
                    const parts: string[] = [];
                    if (proposal.proposedDurationWeeks != null) {
                      parts.push(`${proposal.proposedDurationWeeks} weeks`);
                    }
                    if (proposal.proposedPostsPerWeek != null) {
                      parts.push(`${proposal.proposedPostsPerWeek} posts per week`);
                    }
                    setNegotiationMessage(parts.length > 0 ? parts.join(', ') : proposal.summary);
                  }}
                  autoOptimizeEnabled={governanceAnalytics?.autoOptimizeEnabled}
                  autoOptimizationEligibility={governanceAnalytics?.autoOptimizationEligibility}
                  onToggleAutoOptimize={async (enabled) => {
                    if (!id || !effectiveCompanyId) return;
                    const res = await apiFetch('/api/analytics/toggle-auto-optimize', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ campaignId: id, companyId: effectiveCompanyId, enabled }),
                    });
                    if (res.ok) loadGovernance();
                  }}
                />
                {governanceStatus.latestGovernanceEvent ? (
                  <GovernanceExplanationPanel
                    derived={deriveFromEvent(
                      governanceStatus.latestGovernanceEvent.eventType,
                      governanceStatus.latestGovernanceEvent.metadata
                    )}
                  />
                ) : (
                  <GovernanceExplanationPanel />
                )}
                {governanceStatus.trade_off_options && governanceStatus.trade_off_options.length > 0 && (
                  <TradeOffSuggestionList options={governanceStatus.trade_off_options} />
                )}
                {governanceStatus.governance?.durationWeeks != null &&
                  !governanceStatus.governance?.blueprintImmutable &&
                  !governanceStatus.governance?.blueprintFrozen &&
                  !governanceLocked &&
                  ((governanceStatus.latestGovernanceEvent?.eventType === 'PRE_PLANNING_EVALUATED' ||
                    governanceStatus.latestGovernanceEvent?.eventType === 'DURATION_NEGOTIATED') &&
                    governanceStatus.latestGovernanceEvent?.eventStatus === 'NEGOTIATE') && (
                  <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Refine your duration</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      Try a different duration (e.g. &quot;14 weeks&quot;, &quot;extend&quot;, &quot;reduce&quot;) and re-evaluate.
                    </p>
                    <div className="flex gap-3 flex-wrap">
                      <input
                        type="text"
                        placeholder="Refine your duration…"
                        value={negotiationMessage}
                        onChange={(e) => setNegotiationMessage(e.target.value)}
                        className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <button
                        onClick={async () => {
                          if (!id || !effectiveCompanyId) return;
                          setNegotiationLoading(true);
                          setNegotiationResult(null);
                          try {
                            const res = await apiFetch('/api/campaigns/negotiate-duration', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                campaignId: id,
                                companyId: effectiveCompanyId,
                                message: negotiationMessage,
                              }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setNegotiationResult({
                                status: data.status,
                                explanation: data.explanation,
                                trade_off_options: data.trade_off_options ?? [],
                                evaluation: data.evaluation,
                              });
                              const [statusRes, eventsRes, analyticsRes] = await Promise.all([
                                apiFetch(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}&companyId=${encodeURIComponent(effectiveCompanyId)}`),
                                apiFetch(`/api/governance/events?companyId=${encodeURIComponent(effectiveCompanyId)}&campaignId=${encodeURIComponent(id as string)}`),
                                apiFetch(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(id as string)}`),
                              ]);
                              if (statusRes.ok) {
                                const statusData = await statusRes.json();
                                setGovernanceStatus({
                                  governance: statusData.governance,
                                  latestGovernanceEvent: statusData.latestGovernanceEvent,
                                  trade_off_options: statusData.trade_off_options,
                                });
                              }
                              if (eventsRes.ok) {
                                const eventsData = await eventsRes.json();
                                setGovernanceEvents(eventsData.events ?? []);
                              }
                              if (analyticsRes.ok) {
                                const analyticsData = await analyticsRes.json();
                                setGovernanceAnalytics(analyticsData);
                              }
                            }
                          } catch (err) {
                            console.error('Negotiation failed', err);
                          } finally {
                            setNegotiationLoading(false);
                          }
                        }}
                        disabled={negotiationLoading || governanceLocked}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2"
                      >
                        {negotiationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Re-evaluate
                      </button>
                    </div>
                    {negotiationResult && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-2">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{negotiationResult.explanation}</p>
                        {negotiationResult.trade_off_options && negotiationResult.trade_off_options.length > 0 && (
                          <TradeOffSuggestionList options={negotiationResult.trade_off_options} />
                        )}
                      </div>
                    )}
                  </div>
                )}
                <PreemptionHistory events={governanceEvents} />
                <GovernanceTimeline events={governanceEvents} />
              </>
            )}
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">Performance</h2>
            {performanceSummary ? (
              <div className="space-y-6 text-sm text-gray-700">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="font-medium text-gray-900">Expected reach</div>
                    <div>{performanceSummary.expected_reach ?? '—'}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Actual impressions</div>
                    <div>{performanceSummary.impressions}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Accuracy</div>
                    <div>{Math.round(performanceSummary.accuracy_score * 100)}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-gray-500">Likes</div>
                    <div className="font-medium">{performanceSummary.likes}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Shares</div>
                    <div className="font-medium">{performanceSummary.shares}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Comments</div>
                    <div className="font-medium">{performanceSummary.comments}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Clicks</div>
                    <div className="font-medium">{performanceSummary.clicks}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="font-medium text-gray-900">Engagement rate</div>
                    <div>{(performanceSummary.engagement_rate * 100).toFixed(2)}%</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Recommendation confidence</div>
                    <div>{performanceSummary.recommendation_confidence ?? '—'}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Last collected</div>
                    <div>
                      {performanceSummary.last_collected_at
                        ? new Date(performanceSummary.last_collected_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No performance data available yet.</p>
            )}
          </div>
        )}
      </div>

      {/* AI Assistant - Campaign Chat with recommendation context, linked to campaign plan */}
      {campaign && !shouldForceWeeklyBlueprintView && (
        <CampaignAIChat
          isOpen={showAIChat}
          onClose={() => {
            setShowAIChat(false);
            setActiveTab('overview');
            setTimeout(() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
          }}
          onMinimize={() => {
            setShowAIChat(false);
            setActiveTab('overview');
            setTimeout(() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
          }}
          context="campaign-planning"
          forceFreshPlanningThread={false}
          companyId={effectiveCompanyId || undefined}
          campaignId={campaign.id}
          campaignData={campaign}
          recommendationContext={recommendationContext}
          prefilledPlanning={prefilledPlanning}
          governanceLocked={governanceLocked}
          onProgramGenerated={() => {
            if (typeof id === 'string') {
              loadCampaignDetails(id);
              setShowAIChat(false);
              setActiveTab('overview');
              setTimeout(() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
            }
          }}
          onBackToRecommendation={
            recommendationId && effectiveCompanyId && router.query.fromRecommendation
              ? () => {
                  setShowAIChat(false);
                  const params = new URLSearchParams();
                  params.set('companyId', effectiveCompanyId);
                  params.set('recommendationId', recommendationId);
                  router.push(`/recommendations?${params.toString()}`);
                }
              : undefined
          }
          collectedPlanningContext={(() => {
            const ctx: Record<string, unknown> = {};
            if (campaign?.start_date) ctx.tentative_start = campaign.start_date;
            if (campaign?.duration_weeks != null) ctx.campaign_duration = campaign.duration_weeks;
            if (campaign?.duration_weeks != null) ctx.preplanning_form_completed = true;
            if (ENABLE_UNIFIED_CAMPAIGN_WIZARD && campaign?.id) {
              const wizardCtx = exportWizardToPlanningContext(createCampaignWizardStore(campaign.id).getState());
              Object.assign(ctx, wizardCtx);
            }
            if (typeof window !== 'undefined' && campaign?.id && !ENABLE_UNIFIED_CAMPAIGN_WIZARD) {
              try {
                const stored = sessionStorage.getItem(`campaign_planning_context_${campaign.id}`);
                if (stored) {
                  const parsed = JSON.parse(stored) as Record<string, unknown>;
                  if (parsed?.available_content) ctx.available_content = parsed.available_content;
                  if (parsed?.content_capacity) ctx.content_capacity = parsed.content_capacity;
                }
              } catch {
                /* ignore */
              }
            }
            return Object.keys(ctx).length > 0 ? ctx : undefined;
          })()}
          optimizationContext={
            governanceAnalytics
              ? {
                  roiScore: governanceAnalytics.roiIntelligence?.roiScore ?? 50,
                  headlines: (governanceAnalytics.optimizationInsights ?? []).map((i: { headline: string }) => i.headline),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}



