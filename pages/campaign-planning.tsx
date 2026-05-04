import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  Sparkles
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';
import { apiFetch } from '@/lib/apiFetch';
import AIContentIntegration from '../components/AIContentIntegration';
import ContentCreationPanel from '../components/ContentCreationPanel';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import WeeklyRefinementInterface from '../components/WeeklyRefinementInterface';

import { useCampaignPlanningState } from '../hooks/useCampaignPlanningState';
import CampaignPlanningContent from '../components/CampaignPlanningContent';

export default function CampaignPlanning() {
  const d = useCampaignPlanningState();
  const {
    accuracyPct,
    activePlanningTab,
    addGoal,
    aiImprovements,
    aiImprovementsError,
    aiProgram,
    aiSuggestionContext,
    alignedPreview,
    alignedPreviewError,
    approveFrequencyRebalance,
    campaignData,
    campaignId,
    captureAIProgram,
    checkExistingPlan,
    contentTypes,
    continueToMarketAnalysis,
    createNewCampaign,
    expandedSuggestionIds,
    fetchAiImprovements,
    fetchForecastVsActual,
    fetchLeadConversionIntel,
    fetchMomentumData,
    fetchOptimizationAdvice,
    fetchPlatformAdvice,
    fetchReapprovalStatus,
    fetchStrategyStatus,
    fetchViralTopicMemory,
    forecastDelta,
    forecastError,
    forecastVsActual,
    generate12WeekPlan,
    generatePlanDescription,
    getContentTypeColor,
    getContentTypeIcon,
    getPlatformColor,
    getPriorityColor,
    groupedContext,
    hasExistingPlan,
    isAiImprovementsLoading,
    isChatOpen,
    isDraftMode,
    isEditMode,
    isForecastLoading,
    isLeadIntelLoading,
    isLoading,
    isMomentumLoading,
    isOptimizationLoading,
    isPlatformAdviceLoading,
    isRebalanceLoading,
    isRevisingStrategy,
    isStrategyLocked,
    isStrategyProposed,
    isStrategyStatusLoading,
    isViralTopicLoading,
    leadConversionIntel,
    leadIntelError,
    loadCampaign,
    loadExistingCampaign,
    momentumData,
    momentumError,
    newGoal,
    notice,
    notify,
    openDailyPlanning,
    optimizationAdvice,
    optimizationError,
    organizeProgramIntoGoals,
    planDescription,
    platformAccuracyEntries,
    platformAdvice,
    platformAdviceEntries,
    platformAdviceError,
    platformSortMode,
    platforms,
    priorities,
    programStartDate,
    proposeFrequencyRebalance,
    reapprovalStatus,
    rebalanceError,
    rebalanceProposal,
    rebalanceRejectReason,
    rebalanceStatus,
    recommendationContext,
    recommendationHash,
    regenerateAlignedPreview,
    rejectFrequencyRebalance,
    removeGoal,
    reviseError,
    reviseStrategyFromSuggestions,
    router,
    saveCampaign,
    selectedSuggestionIds,
    setActivePlanningTab,
    setAiImprovements,
    setAiImprovementsError,
    setAiProgram,
    setAiSuggestionContext,
    setAlignedPreview,
    setAlignedPreviewError,
    setCampaignData,
    setCampaignId,
    setExpandedSuggestionIds,
    setForecastError,
    setForecastVsActual,
    setGroupedContext,
    setHasExistingPlan,
    setIsAiImprovementsLoading,
    setIsChatOpen,
    setIsForecastLoading,
    setIsLeadIntelLoading,
    setIsLoading,
    setIsMomentumLoading,
    setIsOptimizationLoading,
    setIsPlatformAdviceLoading,
    setIsRebalanceLoading,
    setIsRevisingStrategy,
    setIsStrategyStatusLoading,
    setIsViralTopicLoading,
    setLeadConversionIntel,
    setLeadIntelError,
    setMomentumData,
    setMomentumError,
    setNewGoal,
    setNotice,
    setOptimizationAdvice,
    setOptimizationError,
    setPlanDescription,
    setPlatformAdvice,
    setPlatformAdviceError,
    setPlatformSortMode,
    setProgramStartDate,
    setReapprovalStatus,
    setRebalanceError,
    setRebalanceProposal,
    setRebalanceRejectReason,
    setRebalanceStatus,
    setRecommendationContext,
    setRecommendationHash,
    setReviseError,
    setSelectedSuggestionIds,
    setShowProgramCapture,
    setShowRebalanceRationale,
    setShowRebalanceRejectModal,
    setShowWeeklyRefinement,
    setStableThemesOpen,
    setStrategyStatus,
    setViralTopicError,
    setViralTopicMemory,
    showProgramCapture,
    showRebalanceRationale,
    showRebalanceRejectModal,
    showWeeklyRefinement,
    stableThemesOpen,
    strategyStatus,
    toggleSuggestionDetails,
    toggleSuggestionSelection,
    viralTopicError,
    viralTopicMemory,
  } = d;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {notice && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = '/'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  {isEditMode && campaignData?.name ? `Editing: ${campaignData.name}` : 'Campaign Planning'}
                </h1>
                {isEditMode && campaignId && (
                  <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {campaignId}</p>
                )}
                <p className="text-gray-600 mt-1">
                  {isEditMode && campaignId ? 'Edit this campaign\'s structure, goals, and content' : 'Define your campaign structure and content goals'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const mode = (router.query?.mode as string) || null;
                
                if (mode === 'create') {
                  // Create mode buttons
                  return (
                    <>
                      <button 
                        onClick={createNewCampaign}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                        Create New Campaign
                      </button>
                      
                      {campaignId && (
                        <>
                          <button 
                            onClick={saveCampaign}
                            disabled={isLoading}
                            className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
                          >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Draft'}
                          </button>
                          
                          <button 
                            onClick={generate12WeekPlan}
                            disabled={isLoading || isStrategyLocked || isStrategyStatusLoading}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Calendar className="h-4 w-4" />
                            Generate Campaign Plan
                          </button>
                          
                          <button 
                            onClick={() => window.location.href = `/campaign-details/${campaignId}`}
                            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                          >
                            <Target className="h-5 w-5" />
                            View Campaign Details
                          </button>
                        </>
                      )}
                    </>
                  );
                } else {
                  // Default mode - show create button
                  return (
                    <button 
                      onClick={createNewCampaign}
                      disabled={isLoading}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                      Create New Campaign
                    </button>
                  );
                }
              })()}
            </div>
          </div>
        </div>
      </div>

      <CampaignPlanningContent d={d} />
    </div>
  );
}
