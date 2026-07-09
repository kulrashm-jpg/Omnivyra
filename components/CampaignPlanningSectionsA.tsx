/** CampaignPlanningSectionsA — verbatim JSX slice of CampaignPlanningContent (babel-verified). */
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

export default function CampaignPlanningSectionsA({ f }: { f: ReturnType<typeof useCampaignPlanningController> }) {
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
        {recommendationContext && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
            Generated from shortlisted recommendation.
          </div>
        )}
        {typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('mode') === 'draft' && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
              Draft created from High-Priority Recommendation — requires Company Admin approval.
            </div>
          )}
        {reapprovalStatus?.status === 'reapproval_required' && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            Strategy updated after approval — Company Admin re-approval required.
          </div>
        )}
        {isStrategyProposed && (
          <div className="mb-6 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
            Draft revision created — awaiting approval.
          </div>
        )}
        {recommendationContext && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Recommendation Context
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div>
                <div className="text-xs text-gray-500">Trend Topic</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.trend_topic || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Confidence</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.confidence ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Final Score</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.final_score ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Platform Mix</div>
                <div className="font-medium text-gray-900">
                  {Array.isArray(recommendationContext.platforms)
                    ? recommendationContext.platforms.join(', ')
                    : '—'}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-gray-500">Audience</div>
                <div className="font-medium text-gray-900 whitespace-pre-wrap">
                  {recommendationContext.audience ? JSON.stringify(recommendationContext.audience) : '—'}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-gray-500">Scores</div>
                <div className="font-medium text-gray-900 whitespace-pre-wrap">
                  {recommendationContext.scores ? JSON.stringify(recommendationContext.scores) : '—'}
                </div>
              </div>
            </div>
            {recommendationHash && (
              <div className="mt-3 text-xs text-gray-500">Snapshot: {recommendationHash}</div>
            )}
          </div>
        )}
        {groupedContext && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-white/90 p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Trend Groups</h3>
            <div className="text-sm text-gray-700 space-y-3">
              {(groupedContext.groups || []).map((group: any) => (
                <div key={group.group_id} className="rounded-lg border border-gray-200 p-3">
                  <div className="font-semibold text-gray-900">{group.theme_name || 'Group'}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Array.isArray(group.recommendations)
                      ? group.recommendations.join(', ')
                      : '—'}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
                <div>
                  <div className="text-[10px] text-gray-500">Suggested Platform Mix</div>
                  <div className="font-medium">
                    {Array.isArray(groupedContext.suggested_platform_mix)
                      ? groupedContext.suggested_platform_mix.join(', ')
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500">Suggested Frequency</div>
                  <div className="font-medium whitespace-pre-wrap">
                    {groupedContext.suggested_frequency
                      ? JSON.stringify(groupedContext.suggested_frequency, null, 2)
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {isDraftMode && alignedPreview && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-white/90 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Aligned Strategy Inputs</h3>
              <button
                type="button"
                onClick={regenerateAlignedPreview}
                className="px-3 py-2 text-xs rounded-lg bg-emerald-600 text-white"
              >
                Regenerate campaign plan using updated inputs
              </button>
            </div>
            {alignedPreviewError && (
              <div className="mb-3 text-sm text-red-600">{alignedPreviewError}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Platform Mix</label>
                <input
                  value={Array.isArray(alignedPreview.platform_mix) ? alignedPreview.platform_mix.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      platform_mix: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Content Mix</label>
                <input
                  value={Array.isArray(alignedPreview.content_mix) ? alignedPreview.content_mix.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      content_mix: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Weekly Frequency (JSON)</label>
                <textarea
                  value={
                    alignedPreview.frequency_plan
                      ? JSON.stringify(alignedPreview.frequency_plan, null, 2)
                      : ''
                  }
                  onChange={(event) => {
                    try {
                      const next = event.target.value ? JSON.parse(event.target.value) : {};
                      setAlignedPreview((prev: any) => ({
                        ...(prev || {}),
                        frequency_plan: next,
                      }));
                    } catch {
                      // keep user input without updating parsed state
                    }
                  }}
                  rows={4}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Reuse Strategy</label>
                <input
                  value={Array.isArray(alignedPreview.reuse_plan) ? alignedPreview.reuse_plan.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      reuse_plan: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Narrative Direction</label>
                <textarea
                  value={alignedPreview.narrative_direction || ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      narrative_direction: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}
        {isStrategyLocked && (
          <div className="mb-6 space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
              Strategy approved. Editing locked by Company Admin.
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  AI Suggestions (Read Only)
                </h3>
                <button
                  type="button"
                  onClick={reviseStrategyFromSuggestions}
                  disabled={isRevisingStrategy || selectedSuggestionIds.size === 0}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRevisingStrategy ? 'Revising...' : 'Revise Strategy Using Selected Suggestions'}
                </button>
              </div>
              {reviseError && (
                <div className="mb-3 text-sm text-red-600">{reviseError}</div>
              )}
              {isAiImprovementsLoading && (
                <div className="text-sm text-gray-600">Loading AI suggestions...</div>
              )}
              {!isAiImprovementsLoading && aiImprovementsError && (
                <div className="text-sm text-red-600">{aiImprovementsError}</div>
              )}
              {!isAiImprovementsLoading && !aiImprovementsError && aiImprovements.length === 0 && (
                <div className="text-sm text-gray-600">No AI suggestions available.</div>
              )}
              {!isAiImprovementsLoading && !aiImprovementsError && aiImprovements.length > 0 && (
                <div className="space-y-3">
                  {aiImprovements.map((improvement) => (
                    <div
                      key={improvement.id}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3"
                    >
                      <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedSuggestionIds.has(improvement.id)}
                          onChange={() => toggleSuggestionSelection(improvement.id)}
                        />
                        Select
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          {improvement.improvement_type}
                        </span>
                        {typeof improvement.impact_score === 'number' && (
                          <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">
                            Impact {improvement.impact_score}
                          </span>
                        )}
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                          {improvement.implementation_status || 'pending'}
                        </span>
                        {aiSuggestionContext?.enhancement?.ai_provider && (
                          <span className="rounded-full bg-gray-200 px-2 py-1 text-gray-700">
                            Model {aiSuggestionContext.enhancement.ai_provider}
                          </span>
                        )}
                        {typeof aiSuggestionContext?.enhancement?.confidence_score === 'number' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                            Confidence {aiSuggestionContext.enhancement.confidence_score}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">
                        {improvement.suggestion}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSuggestionDetails(improvement.id)}
                        className="mt-3 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Why suggested?
                      </button>
                      {expandedSuggestionIds.has(improvement.id) && (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 space-y-2">
                          {aiSuggestionContext?.enhancement?.improvement_notes && (
                            <div>
                              <div className="font-medium text-gray-800 mb-1">
                                Improvement notes
                              </div>
                              <div className="whitespace-pre-wrap">
                                {aiSuggestionContext.enhancement.improvement_notes}
                              </div>
                            </div>
                          )}
                          {(aiSuggestionContext?.learning?.performance ||
                            aiSuggestionContext?.learning?.metrics) && (
                            <div>
                              <div className="font-medium text-gray-800 mb-1">
                                Recent performance and metrics
                              </div>
                              <div className="space-y-1">
                                {aiSuggestionContext?.learning?.performance &&
                                  Object.entries(aiSuggestionContext.learning.performance)
                                    .slice(0, 6)
                                    .map(([key, value]) => (
                                      <div key={`perf-${key}`}>
                                        {key}: {String(value)}
                                      </div>
                                    ))}
                                {aiSuggestionContext?.learning?.metrics &&
                                  Object.entries(aiSuggestionContext.learning.metrics)
                                    .slice(0, 6)
                                    .map(([key, value]) => (
                                      <div key={`metric-${key}`}>
                                        {key}: {String(value)}
                                      </div>
                                    ))}
                              </div>
                            </div>
                          )}
                          {!aiSuggestionContext?.enhancement?.improvement_notes &&
                            !aiSuggestionContext?.learning?.performance &&
                            !aiSuggestionContext?.learning?.metrics && (
                              <div className="text-gray-600">
                                No additional context available.
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Prediction Accuracy</h3>
            </div>
            {isForecastLoading && (
              <div className="text-sm text-gray-600">Loading prediction accuracy...</div>
            )}
            {!isForecastLoading && forecastError && (
              <div className="text-sm text-red-600">{forecastError}</div>
            )}
            {!isForecastLoading && !forecastError && !forecastVsActual && (
              <div className="text-sm text-gray-600">No prediction accuracy data available.</div>
            )}
            {!isForecastLoading && !forecastError && forecastVsActual && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex flex-wrap items-center gap-3">
                  {typeof accuracyPct === 'number' && (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 text-xs">
                      Accuracy {accuracyPct.toFixed(0)}%
                    </span>
                  )}
                  {forecastDelta && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                      {forecastDelta.value >= 0 ? 'Over-performed' : 'Under-performed'}{' '}
                      {Math.abs(forecastDelta.value).toFixed(1)}% ({forecastDelta.label})
                    </span>
                  )}
                </div>
                {platformAccuracyEntries.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">Platform insights</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {platformAccuracyEntries.map(([platform, stats]) => {
                        const s = stats as { share_pct?: number; clicks?: number } | undefined;
                        return (
                          <span
                            key={platform}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {platform}: {s?.share_pct ?? 0}% ({s?.clicks ?? 0} clicks)
                          </span>
                        );
                      })}
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
              <h3 className="text-lg font-semibold text-gray-900">AI Optimization Advice</h3>
            </div>
            {isOptimizationLoading && (
              <div className="text-sm text-gray-600">Loading optimization advice...</div>
            )}
            {!isOptimizationLoading && optimizationError && (
              <div className="text-sm text-red-600">{optimizationError}</div>
            )}
            {!isOptimizationLoading && !optimizationError && !optimizationAdvice && (
              <div className="text-sm text-gray-600">No optimization advice available.</div>
            )}
            {!isOptimizationLoading && !optimizationError && optimizationAdvice && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(optimizationAdvice.frequency_adjustment) &&
                  optimizationAdvice.frequency_adjustment.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Frequency adjustments
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.frequency_adjustment.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.platform}-freq`}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {item.recommended_posts_per_week > item.current_posts_per_week
                              ? `Increase ${item.platform} to ${item.recommended_posts_per_week}/wk`
                              : item.recommended_posts_per_week < item.current_posts_per_week
                              ? `Reduce ${item.platform} to ${item.recommended_posts_per_week}/wk`
                              : `Maintain ${item.platform} at ${item.current_posts_per_week}/wk`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(optimizationAdvice.platform_reallocation) &&
                  optimizationAdvice.platform_reallocation.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Platform effort signals
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.platform_reallocation.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.platform}-alloc`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.recommended_weight > item.current_weight
                              ? `Boost ${item.platform} allocation`
                              : item.recommended_weight < item.current_weight
                              ? `Reduce ${item.platform} effort`
                              : `Maintain ${item.platform} allocation`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(optimizationAdvice.topic_cluster_boost) &&
                  optimizationAdvice.topic_cluster_boost.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Theme cluster focus
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.topic_cluster_boost.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.theme_name}-boost`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            Boost {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {platformAdviceEntries.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">
                      Platform click distribution
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {platformAdviceEntries.map(([platform, stats]) => {
                        const s = stats as { share_pct?: number } | undefined;
                        return (
                          <span
                            key={`opt-${platform}`}
                            className="rounded-full bg-gray-100 px-3 py-1 text-gray-700"
                          >
                            {platform}: {s?.share_pct ?? 0}%
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </>
  );
}
