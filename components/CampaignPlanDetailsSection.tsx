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
type S = ReturnType<typeof useCampaignPlanningState>;

type CampaignState = ReturnType<typeof useCampaignPlanningState>;


export default function CampaignDetailsSection({ d }: { d: S }) {
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
    <>
          {/* Campaign Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg">
                  <Target className="h-6 w-6 text-white" />
                </div>
                Campaign Details
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name</label>
                  <input
                    type="text"
                    value={campaignData.name}
                    onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    placeholder="Enter campaign name"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timeframe</label>
                  <select
                    value={campaignData.timeframe}
                    onChange={(e) => setCampaignData({ ...campaignData, timeframe: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="week">1 Week</option>
                    <option value="month">1 Month</option>
                    <option value="quarter">1 Quarter</option>
                    <option value="year">1 Year</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={campaignData.startDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setCampaignData({ ...campaignData, startDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={campaignData.endDate}
                    min={campaignData.startDate || new Date().toISOString().split('T')[0]}
                    onChange={(e) => setCampaignData({ ...campaignData, endDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
              
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={campaignData.description}
                  onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  placeholder="Describe your campaign objectives and strategy"
                />
              </div>
            </div>

                {/* AI Program Capture Section */}
                {aiProgram && (
                  <div className="bg-gradient-to-br from-purple-100/80 via-indigo-100/80 to-blue-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-purple-300/50 p-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                      <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
                        <Target className="h-6 w-6 text-white" />
                      </div>
                      AI-Generated Campaign Program
                    </h2>
                    
                    <div className="bg-white/70 backdrop-blur-sm rounded-xl p-6 border border-gray-200/50 mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Program Overview</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">12</div>
                          <div className="text-sm opacity-90">Weeks</div>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.totalContent || '0'}</div>
                          <div className="text-sm opacity-90">Content Pieces</div>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.platforms?.length || '0'}</div>
                          <div className="text-sm opacity-90">Platforms</div>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-600">Program Description</label>
                          <div className="text-gray-800 mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {aiProgram.description || 'AI-generated campaign content program'}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-600">Target Platforms</label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {(aiProgram.platforms || ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok']).map((platform: string) => (
                              <span key={platform} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Weekly Breakdown */}
                    {aiProgram.weeks && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900">Weekly Breakdown</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {aiProgram.weeks.slice(0, 12).map((week: any, index: number) => (
                            <div 
                              key={index} 
                              onClick={() => openDailyPlanning(week)}
                              className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50 hover:shadow-lg hover:border-purple-300 cursor-pointer transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-900">Week {week.weekNumber}</h4>
                                <div className="flex items-center gap-2">
                                  {week.dailyPlanned && (
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  )}
                                  <span className="text-sm text-gray-500">{week.theme || 'Content Week'}</span>
                                </div>
                              </div>
                              
                              {/* Show actual dates if available */}
                              {week.dates && (
                                <div className="text-xs text-gray-600 mb-3 bg-gray-100 px-2 py-1 rounded">
                                  {week.dates.startFormatted} - {week.dates.endFormatted}
                                </div>
                              )}
                              
                              <div className="space-y-2">
                                {week.content?.slice(0, 3).map((content: any, contentIndex: number) => (
                                  <div key={contentIndex} className="flex items-center gap-2 text-sm">
                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                    <span className="text-gray-700">{content.type || 'Post'}</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-600">{content.platform || 'LinkedIn'}</span>
                                  </div>
                                ))}
                                {week.content?.length > 3 && (
                                  <div className="text-xs text-gray-500">+{week.content.length - 3} more</div>
                                )}
                              </div>
                              
                              {/* Click indicator */}
                              <div className="mt-3 text-xs text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                Click to plan daily activities →
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={organizeProgramIntoGoals}
                        className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        <CheckCircle className="h-5 w-5" />
                        Organize into Goals
                      </button>
                      <button
                        onClick={() => setShowProgramCapture(false)}
                        className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200"
                      >
                        Edit Program
                      </button>
                    </div>
                  </div>
                )}

                {/* View Campaign Plan Button */}
                <div className="bg-gradient-to-br from-blue-100/80 via-indigo-100/80 to-purple-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-300/50 p-6 mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
                      <Calendar className="h-6 w-6 text-white" />
                    </div>
                    Campaign Plan Management
                  </h2>
                  
                  {/* Plan Description */}
                  {planDescription ? (
                    <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 mb-6 border border-blue-200/50">
                      <h3 className="font-semibold text-gray-800 mb-3">Current Plan Description:</h3>
                      <div className="text-gray-700 text-sm leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {planDescription.split('\n').map((line, index) => {
                          if (line.startsWith('**') && line.endsWith('**')) {
                            return (
                              <div key={index} className="font-semibold text-gray-800 mt-3 mb-2">
                                {line.replace(/\*\*/g, '')}
                              </div>
                            );
                          } else if (line.startsWith('•')) {
                            return (
                              <div key={index} className="ml-4 mb-1">
                                {line}
                              </div>
                            );
                          } else if (line.trim() === '') {
                            return <div key={index} className="mb-2"></div>;
                          } else {
                            return (
                              <div key={index} className="mb-1">
                                {line}
                              </div>
                            );
                          }
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-yellow-50/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-yellow-200/50">
                      <p className="text-yellow-800 text-sm">
                        <strong>No campaign plan created yet.</strong> Generate a comprehensive content plan to get started.
                      </p>
                    </div>
                  )}
                  
                  <p className="text-gray-700 mb-6">
                    {hasExistingPlan 
                      ? 'Manage your existing campaign content plan with AI-powered refinements and amendments.'
                      : 'Create a comprehensive campaign content plan with AI-powered suggestions and optimizations.'
                    }
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                      <button
                        onClick={async () => {
                            if (campaignId) {
                              window.location.href = `/campaign-details/${campaignId}`;
                            } else {
                              // Try to load existing campaign first
                              await loadExistingCampaign();
                              if (campaignId) {
                                window.location.href = `/campaign-details/${campaignId}`;
                              } else {
                                notify('info', 'Please create a campaign first');
                              }
                            }
                          }}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                        >
                          <Calendar className="h-6 w-6" />
                          View Campaign Plan
                        </button>
                    
                    <button
                      onClick={() => setIsChatOpen(true)}
                      className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                    >
                      <Sparkles className="h-6 w-6" />
                      {hasExistingPlan ? 'Edit Campaign Plan' : 'Generate New Plan'}
                      </button>
                  </div>
                </div>

            {/* Content Goals Table */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
                Content Goals
              </h2>

              {/* Add New Goal Form */}
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Goal</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                    <select
                      value={newGoal.contentType}
                      onChange={(e) => setNewGoal({ ...newGoal, contentType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Type</option>
                      {contentTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                    <input
                      type="number"
                      value={newGoal.quantity}
                      onChange={(e) => setNewGoal({ ...newGoal, quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="10"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                    <select
                      value={newGoal.platform}
                      onChange={(e) => setNewGoal({ ...newGoal, platform: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Platform</option>
                      {platforms.map((platform) => (
                        <option key={platform.value} value={platform.value}>{platform.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Timeline</label>
                    <input
                      type="text"
                      value={newGoal.timeline}
                      onChange={(e) => setNewGoal({ ...newGoal, timeline: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="Week 1-2"
                    />
                  </div>
                  
                  <div className="flex items-end">
                    <button
                      onClick={addGoal}
                      className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-4 py-2 rounded-lg font-medium shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Goals Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Content Type</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Quantity</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Platform</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Timeline</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Priority</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignData.goals.map((goal) => {
                      const Icon = getContentTypeIcon(goal.contentType);
                      return (
                        <tr key={goal.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg bg-gradient-to-r ${getContentTypeColor(goal.contentType)}`}>
                                <Icon className="h-4 w-4 text-white" />
                              </div>
                              <span className="font-medium text-gray-900 capitalize">{goal.contentType}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-gray-900">{goal.quantity}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium text-white ${getPlatformColor(goal.platform)}`}>
                              {goal.platform.charAt(0).toUpperCase() + goal.platform.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-gray-700">{goal.timeline}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${getPriorityColor(goal.priority)} text-white`}>
                              {goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <button
                              onClick={() => removeGoal(goal.id)}
                              className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                
                {campaignData.goals.length === 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                      <Target className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Goals Added Yet</h3>
                    <p className="text-gray-600">Add your first content goal to get started with campaign planning</p>
                  </div>
                )}
              </div>
            </div>
          </div>

    </>
  );
}
