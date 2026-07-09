/** CampaignPlanningSectionsB — verbatim JSX slice of CampaignPlanningContent (babel-verified). */
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
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import AIContentIntegration from '../components/AIContentIntegration';
import ContentCreationPanel from '../components/ContentCreationPanel';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import WeeklyRefinementInterface from '../components/WeeklyRefinementInterface';

import type { useCampaignPlanningState } from '../hooks/useCampaignPlanningState';

type CampaignState = ReturnType<typeof useCampaignPlanningState>;
import CampaignPlanDetailsSection from './CampaignPlanDetailsSection';
import { useCampaignPlanningController } from './CampaignPlanningController';

export default function CampaignPlanningSectionsB({ f }: { f: ReturnType<typeof useCampaignPlanningController> }) {
  const {
    d,
    accuracyPct, activePlanningTab, addGoal, aiImprovements, aiImprovementsError, aiProgram, aiSuggestionContext, alignedPreview,
    alignedPreviewError, approveFrequencyRebalance, campaignData, campaignId, captureAIProgram, checkExistingPlan, contentTypes,
    continueToMarketAnalysis, createNewCampaign, expandedSuggestionIds, fetchAiImprovements, fetchForecastVsActual,
    fetchLeadConversionIntel, fetchMomentumData, fetchOptimizationAdvice, fetchPlatformAdvice, fetchReapprovalStatus,
    fetchStrategyStatus, fetchViralTopicMemory, forecastDelta, forecastError, forecastVsActual, generate12WeekPlan,
    generatePlanDescription, getContentTypeColor, getContentTypeIcon, getPlatformColor, getPriorityColor, groupedContext,
    hasExistingPlan, isAiImprovementsLoading, isChatOpen, isDraftMode, isEditMode, isForecastLoading, isLeadIntelLoading, isLoading,
    isMomentumLoading, isOptimizationLoading, isPlatformAdviceLoading, isRebalanceLoading, isRevisingStrategy, isStrategyLocked,
    isStrategyProposed, isStrategyStatusLoading, isViralTopicLoading, leadConversionIntel, leadIntelError, loadCampaign,
    loadExistingCampaign, momentumData, momentumError, newGoal, notice, notify, openDailyPlanning, optimizationAdvice,
    optimizationError, organizeProgramIntoGoals, planDescription, platformAccuracyEntries, platformAdvice, platformAdviceEntries,
    platformAdviceError, platformSortMode, platforms, priorities, programStartDate, proposeFrequencyRebalance, reapprovalStatus,
    rebalanceError, rebalanceProposal, rebalanceRejectReason, rebalanceStatus, recommendationContext, recommendationHash,
    regenerateAlignedPreview, rejectFrequencyRebalance, removeGoal, reviseError, reviseStrategyFromSuggestions, router, saveCampaign,
    selectedSuggestionIds, setActivePlanningTab, setAiImprovements, setAiImprovementsError, setAiProgram, setAiSuggestionContext,
    setAlignedPreview, setAlignedPreviewError, setCampaignData, setCampaignId, setExpandedSuggestionIds, setForecastError,
    setForecastVsActual, setGroupedContext, setHasExistingPlan, setIsAiImprovementsLoading, setIsChatOpen, setIsForecastLoading,
    setIsLeadIntelLoading, setIsLoading, setIsMomentumLoading, setIsOptimizationLoading, setIsPlatformAdviceLoading,
    setIsRebalanceLoading, setIsRevisingStrategy, setIsStrategyStatusLoading, setIsViralTopicLoading, setLeadConversionIntel,
    setLeadIntelError, setMomentumData, setMomentumError, setNewGoal, setNotice, setOptimizationAdvice, setOptimizationError,
    setPlanDescription, setPlatformAdvice, setPlatformAdviceError, setPlatformSortMode, setProgramStartDate, setReapprovalStatus,
    setRebalanceError, setRebalanceProposal, setRebalanceRejectReason, setRebalanceStatus, setRecommendationContext,
    setRecommendationHash, setReviseError, setSelectedSuggestionIds, setShowProgramCapture, setShowRebalanceRationale,
    setShowRebalanceRejectModal, setShowWeeklyRefinement, setStableThemesOpen, setStrategyStatus, setViralTopicError,
    setViralTopicMemory, showProgramCapture, showRebalanceRationale, showRebalanceRejectModal, showWeeklyRefinement,
    stableThemesOpen, strategyStatus, toggleSuggestionDetails, toggleSuggestionSelection, viralTopicError, viralTopicMemory
  } = f;
  return (
    <>
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Viral Topic Intelligence</h3>
            </div>
            {isViralTopicLoading && (
              <div className="text-sm text-gray-600">Loading viral topic intelligence...</div>
            )}
            {!isViralTopicLoading && viralTopicError && (
              <div className="text-sm text-red-600">{viralTopicError}</div>
            )}
            {!isViralTopicLoading && !viralTopicError && !viralTopicMemory && (
              <div className="text-sm text-gray-600">No viral topic intelligence available.</div>
            )}
            {!isViralTopicLoading && !viralTopicError && viralTopicMemory && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(viralTopicMemory.high_performing_clusters) &&
                  viralTopicMemory.high_performing_clusters.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Top repeatable themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {viralTopicMemory.high_performing_clusters.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-repeat`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            {item.theme_name} · {item.recommended_reuse_frequency || 'reuse cadence'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(viralTopicMemory.declining_clusters) &&
                  viralTopicMemory.declining_clusters.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Declining themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {viralTopicMemory.declining_clusters.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-decline`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.theme_name}: {item.suggested_action || 'refresh'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(viralTopicMemory.high_performing_clusters) &&
                  viralTopicMemory.high_performing_clusters.length === 0 &&
                  Array.isArray(viralTopicMemory.declining_clusters) &&
                  viralTopicMemory.declining_clusters.length === 0 && (
                    <div className="text-sm text-gray-600">
                      No theme clusters detected yet.
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Lead Conversion Intelligence</h3>
            </div>
            {isLeadIntelLoading && (
              <div className="text-sm text-gray-600">Loading lead conversion intelligence...</div>
            )}
            {!isLeadIntelLoading && leadIntelError && (
              <div className="text-sm text-red-600">{leadIntelError}</div>
            )}
            {!isLeadIntelLoading && !leadIntelError && !leadConversionIntel && (
              <div className="text-sm text-gray-600">No lead conversion intelligence available.</div>
            )}
            {!isLeadIntelLoading && !leadIntelError && leadConversionIntel && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(leadConversionIntel.top_converting_platforms) &&
                  leadConversionIntel.top_converting_platforms.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Top converting platforms
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.top_converting_platforms.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.platform}-convert`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            {item.platform}: {item.recommendation}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(leadConversionIntel.high_intent_themes) &&
                  leadConversionIntel.high_intent_themes.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        High intent themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.high_intent_themes.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-intent`}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(leadConversionIntel.weak_conversion_areas) &&
                  leadConversionIntel.weak_conversion_areas.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Weak conversion areas
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.weak_conversion_areas.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.platform}-${item.theme_name}-weak`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.platform}: {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Campaign Momentum</h3>
            </div>
            {isMomentumLoading && (
              <div className="text-sm text-gray-600">Loading momentum insights...</div>
            )}
            {!isMomentumLoading && momentumError && (
              <div className="text-sm text-red-600">{momentumError}</div>
            )}
            {!isMomentumLoading && !momentumError && !momentumData && (
              <div className="text-sm text-gray-600">No momentum insights available.</div>
            )}
            {!isMomentumLoading && !momentumError && momentumData && (
              <div className="space-y-3 text-sm text-gray-700">
                <button
                  type="button"
                  onClick={() => setStableThemesOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700"
                >
                  <span>Stable Themes (Baseline Performance)</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-200 px-2 py-1 text-[10px] text-gray-700">
                      Stable
                    </span>
                    <span className="text-xs text-gray-500">{stableThemesOpen ? 'Hide' : 'Show'}</span>
                  </span>
                </button>
                {stableThemesOpen && (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    {Array.isArray(momentumData.stable_topics) &&
                    momentumData.stable_topics.length > 0 ? (
                      <div className="space-y-2 text-xs text-gray-700">
                        {momentumData.stable_topics.slice(0, 6).map((item: any) => (
                          <div
                            key={`${item.theme_name}-stable`}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <span className="font-semibold text-gray-800">{item.theme_name}</span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Baseline {item.baseline_clicks ?? 0}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Current {item.current_clicks ?? 0}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Stability {item.stability_score ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">No stable themes detected.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Platform Investment Optimizer</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => setPlatformSortMode('roi')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'roi' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest ROI
                </button>
                <button
                  onClick={() => setPlatformSortMode('growth')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'growth' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Most Growth Potential
                </button>
                <button
                  onClick={() => setPlatformSortMode('reduce')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'reduce' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Reduce Waste First
                </button>
              </div>
            </div>
            {isPlatformAdviceLoading && (
              <div className="text-sm text-gray-600">Loading platform investment advice...</div>
            )}
            {!isPlatformAdviceLoading && platformAdviceError && (
              <div className="text-sm text-red-600">{platformAdviceError}</div>
            )}
            {!isPlatformAdviceLoading && !platformAdviceError && !platformAdvice && (
              <div className="text-sm text-gray-600">No platform allocation advice available.</div>
            )}
            {!isPlatformAdviceLoading && !platformAdviceError && platformAdvice && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-gray-700">
                    <thead className="text-xs uppercase text-gray-500 border-b">
                      <tr>
                        <th className="px-3 py-2">Platform</th>
                        <th className="px-3 py-2">Recommendation</th>
                        <th className="px-3 py-2">Score</th>
                        <th className="px-3 py-2">Suggested Frequency</th>
                        <th className="px-3 py-2">Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(platformAdvice.platform_advice || [])
                        .slice()
                        .sort((a: any, b: any) => {
                          if (platformSortMode === 'growth') {
                            return (b.allocation_score ?? 0) - (a.allocation_score ?? 0);
                          }
                          if (platformSortMode === 'reduce') {
                            return (a.allocation_score ?? 0) - (b.allocation_score ?? 0);
                          }
                          return (b.allocation_score ?? 0) - (a.allocation_score ?? 0);
                        })
                        .map((item: any) => (
                          <tr key={item.platform} className="border-b">
                            <td className="px-3 py-2 font-medium">{item.platform}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${
                                  item.recommendation === 'Increase'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : item.recommendation === 'Reduce'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {item.recommendation}
                              </span>
                            </td>
                            <td className="px-3 py-2">{item.allocation_score ?? 0}</td>
                            <td className="px-3 py-2">
                              {item.suggested_frequency_delta > 0
                                ? `+${item.suggested_frequency_delta}`
                                : item.suggested_frequency_delta < 0
                                ? `${item.suggested_frequency_delta}`
                                : '0'}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600">{item.rationale}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Recommended Platform Frequency Changes
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={proposeFrequencyRebalance}
                  disabled={isRebalanceLoading}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isRebalanceLoading ? 'Preparing...' : 'Generate Proposal'}
                </button>
                <button
                  onClick={() => setShowRebalanceRationale((prev) => !prev)}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {showRebalanceRationale ? 'Hide Rationale' : 'View Rationale'}
                </button>
              </div>
            </div>
            {rebalanceError && <div className="text-sm text-red-600 mb-3">{rebalanceError}</div>}
            {rebalanceStatus === 'pending' && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Awaiting approval
              </div>
            )}
            {rebalanceStatus === 'approved' && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Rebalance approved and applied.
              </div>
            )}
            {rebalanceStatus === 'rejected' && (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                Proposal rejected.
              </div>
            )}
            {!rebalanceProposal && !rebalanceStatus && (
              <div className="text-sm text-gray-600">
                Generate a proposal to review recommended platform frequency changes.
              </div>
            )}
            {rebalanceProposal && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-gray-700">
                    <thead className="text-xs uppercase text-gray-500 border-b">
                      <tr>
                        <th className="px-3 py-2">Platform</th>
                        <th className="px-3 py-2">Current</th>
                        <th className="px-3 py-2">Proposed</th>
                        <th className="px-3 py-2">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rebalanceProposal.proposed_changes || []).map((item: any) => (
                        <tr key={`rebalance-${item.platform}`} className="border-b">
                          <td className="px-3 py-2 font-medium">{item.platform}</td>
                          <td className="px-3 py-2">{item.current_frequency}</td>
                          <td className="px-3 py-2">{item.recommended_frequency}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">
                            {rebalanceProposal.impact_projection?.expected_reach_delta || '—'} reach /
                            {` ${rebalanceProposal.impact_projection?.expected_leads_delta || '—'} leads`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {showRebalanceRationale && (
                  <div className="space-y-2 text-xs text-gray-600">
                    {(rebalanceProposal.proposed_changes || []).map((item: any) => (
                      <div key={`reason-${item.platform}`}>
                        <span className="font-semibold text-gray-700">{item.platform}:</span>{' '}
                        {item.reason}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={approveFrequencyRebalance}
                    disabled={isRebalanceLoading || rebalanceStatus === 'approved' || rebalanceStatus === 'rejected'}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve Changes
                  </button>
                  <button
                    onClick={() => setShowRebalanceRejectModal(true)}
                    disabled={isRebalanceLoading || rebalanceStatus === 'approved' || rebalanceStatus === 'rejected'}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <CampaignPlanDetailsSection d={d} />
          {/* AI Content Integration Section */}
          {campaignId && aiProgram && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">AI Content Integration</h2>
                    <p className="text-orange-100 mt-1">Convert AI suggestions into weekly content plans</p>
                  </div>
                  <Sparkles className="h-8 w-8 text-orange-200" />
                </div>
              </div>
              
              <div className="p-6">
                <AIContentIntegration 
                  campaignId={campaignId}
                  aiContent={aiProgram}
                  onContentIntegrated={(weekNumber, content) => {
                    console.log(`Week ${weekNumber} content integrated:`, content);
                    // Optionally refresh the page or show success message
                  }}
                />
              </div>
            </div>
          )}

          {/* Enhanced Planning Interface */}
          {campaignId && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Enhanced Campaign Planning</h2>
                    <p className="text-purple-100 mt-1">Create content and capture voice notes during planning</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mic className="h-6 w-6 text-purple-200" />
                    <FileText className="h-6 w-6 text-purple-200" />
                  </div>
                </div>
              </div>
              
              {/* Planning Tabs */}
              <div className="p-6">
                <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
                  {[
                  { id: 'overview', label: 'Campaign Overview', icon: Target },
                  { id: 'content', label: 'Content Creation', icon: FileText },
                  { id: 'voice', label: 'Voice Notes', icon: Mic },
                  { id: 'refinement', label: 'Weekly Refinement', icon: Edit3 }
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActivePlanningTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                          activePlanningTab === tab.id
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tab Content */}
                {activePlanningTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="text-center py-8">
                      <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Campaign Overview</h3>
                      <p className="text-gray-600 mb-6">Your campaign planning overview and weekly breakdown</p>
                      
                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                        <button
                          onClick={() => setActivePlanningTab('refinement')}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Calendar className="h-5 w-5" />
                          View Campaign Plan
                        </button>
                        
                        <button
                          onClick={() => setIsChatOpen(true)}
                          className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Sparkles className="h-5 w-5" />
                          Generate New Plan
                        </button>
                      </div>

                      {/* Feature Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">Campaign Plan</h4>
                          <p className="text-sm text-blue-100">AI-generated strategic roadmap</p>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">Content Strategy</h4>
                          <p className="text-sm text-green-100">Platform-specific content plans</p>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">AI Enhancement</h4>
                          <p className="text-sm text-purple-100">Smart suggestions and optimization</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activePlanningTab === 'content' && (
                  <ContentCreationPanel
                    context="campaign"
                    campaignId={campaignId}
                    onContentSave={(content) => {
                      console.log('Campaign content saved:', content);
                    }}
                  />
                )}

                {activePlanningTab === 'voice' && (
                  <VoiceNotesComponent
                    context="campaign"
                    campaignId={campaignId}
                    onTranscriptionComplete={(transcription) => {
                      console.log('Voice transcription completed:', transcription);
                    }}
                    onSuggestionApply={(suggestion) => {
                      console.log('Voice suggestion applied:', suggestion);
                    }}
                  />
                )}

                {activePlanningTab === 'refinement' && (
                  <div className={isStrategyLocked ? 'pointer-events-none opacity-60' : ''}>
                    <WeeklyRefinementInterface
                      campaignId={campaignId}
                      campaignData={campaignData}
                      onWeekSelect={(weekNumber) => {
                        console.log('Week selected for refinement:', weekNumber);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg">
                  <Users className="h-5 w-5 text-white" />
                </div>
                AI Assistant
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI suggestions for your campaign goals and content strategy
              </p>
              <div className="space-y-3">
              <button 
                onClick={() => {
                  console.log('Campaign Planning AI Chat button clicked!');
                  // Generate new campaign ID if not exists
                  if (!campaignId) {
                    const newCampaignId = 'campaign-' + Date.now();
                    console.log('User initiated campaign creation:', newCampaignId);
                    setCampaignId(newCampaignId);
                    
                    // Update campaign data with new ID
                    setCampaignData(prev => ({
                      ...prev,
                      id: newCampaignId,
                      name: prev.name || 'New Campaign'
                    }));
                    
                    // DO NOT update URL to prevent loops
                  }
                  setIsChatOpen(true);
                }}
                className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                style={{ pointerEvents: 'auto', zIndex: 10 }}
              >
                Start AI Chat {!campaignId && <Sparkles className="w-4 h-4 ml-2 inline" />}
              </button>
                
                {campaignId && (
                  <button 
                    onClick={() => {
                      window.location.href = `/campaign-details/${campaignId}`;
                    }}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    View 12-Week Plan
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                Campaign Summary
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Goals:</span>
                  <span className="font-semibold text-gray-900">{campaignData.goals.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Content Types:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.contentType))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Platforms:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.platform))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Content:</span>
                  <span className="font-semibold text-gray-900">
                    {campaignData.goals.reduce((sum, goal) => sum + parseInt(goal.quantity || '0'), 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </>
  );
}
