/** Part 2/2 of DailyPlanView.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  Users, 
  Target, 
  Plus, 
  Edit3, 
  Trash2, 
  Save, 
  Sparkles,
  CheckCircle,
  AlertCircle,
  Brain,
  Eye,
  Lock,
  Unlock,
  Loader2,
  Mic,
  FileText,
  Video,
  Image,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import ContentCreationPanel from './ContentCreationPanel';
import VoiceNotesComponent from './VoiceNotesComponent';
import PlatformIcon from './ui/PlatformIcon';
import AIGenerationProgress from './AIGenerationProgress';
import { parseDailyExecutionMetadata } from '../lib/dailyExecutionMetadata';

import { getRetentionBadge, hasMasterGenerated, hasAiGeneratedMasterContent, hasVariantsReady, hasAiAdaptedVariant, hasDiscoverabilityOptimization, hasAlgorithmicFormattingOptimization, hasMediaSearchSuggestions, getMediaStatusBadge, getExecutionReadinessBadge, getExecutionJobPills, hasSchedulableExecutionJob, countStrategicFactors } from './DailyPlanViewModel';

type S = ReturnType<typeof useDailyPlanning>;

export default function DailyPlanView({ d }: { d: S }) {
  const {
    activeTab,
    addNewActivity,
    aiEditPermission,
    aiSuggestions,
    applyAISuggestion,
    asObject,
    autopilotSummary,
    commitDailyPlan,
    confirmDeleteActivity,
    dailyActivities,
    daysOfWeek,
    deleteActivity,
    deleteReason,
    executionModeActive,
    expandedDayCards,
    fallbackPlatforms,
    generateAISuggestions,
    getActivitiesForDay,
    getActivityScheduleGroup,
    getAllContentTypes,
    handleContentSave,
    handleVoiceTranscription,
    improveDailyPlan,
    initializeDailyActivities,
    isDayActivitiesMaximized,
    isDayActivitiesMinimized,
    isGeneratingSuggestions,
    isLoading,
    legacyDailyDetected,
    loadCommittedDailyActivities,
    mapDailyExecutionItemToActivity,
    normalizeComparableText,
    notice,
    notify,
    openActivityWorkspace,
    openContentPanel,
    openDayActivitiesView,
    openVoiceNotes,
    pendingDeleteActivityId,
    platformCatalogPlatforms,
    platformContentTypes,
    platforms,
    runAutopilotWeek,
    saveDailyPlan,
    selectedActivityAnchor,
    selectedActivityIdForDetail,
    selectedActivityScheduleGroup,
    selectedDay,
    setActiveTab,
    setAiEditPermission,
    setAiSuggestions,
    setAutopilotSummary,
    setDailyActivities,
    setDeleteReason,
    setExecutionModeActive,
    setExpandedDayCards,
    setIsDayActivitiesMaximized,
    setIsDayActivitiesMinimized,
    setIsGeneratingSuggestions,
    setIsLoading,
    setLegacyDailyDetected,
    setNotice,
    setPendingDeleteActivityId,
    setPlatformCatalogPlatforms,
    setSelectedActivityIdForDetail,
    setSelectedDay,
    setShowAiSuggestions,
    setShowContentPanel,
    setShowDayActivitiesView,
    showAiSuggestions,
    showContentPanel,
    showDayActivitiesView,
    toggleDayCardSize,
    updateActivity,
    warnExecutionIntegrity,
    week, campaignId, campaignData, onSave, initialDay,
  } = d;

    return (
    <div className="space-y-6">
      {notice && (
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
      )}
      {pendingDeleteActivityId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-amber-900">Delete this activity? (Super admin only)</span>
          <input
            type="text"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 min-w-[120px] rounded border border-amber-300 px-2 py-1 text-gray-800"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPendingDeleteActivityId(null); setDeleteReason(''); }} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
            <button type="button" onClick={confirmDeleteActivity} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      )}
      {/* Header with Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Week {week.weekNumber} Daily Planning</h3>
              <p className="text-sm text-gray-600">Plan your daily activities and content</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={runAutopilotWeek}
              className="bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              ⚡ Autopilot Week
            </button>
            <button
              onClick={() => setAiEditPermission(!aiEditPermission)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                aiEditPermission 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {aiEditPermission ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {aiEditPermission ? 'AI Can Edit' : 'AI Read Only'}
            </button>
            <button
              onClick={generateAISuggestions}
              disabled={isGeneratingSuggestions}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              {isGeneratingSuggestions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Get AI Suggestions
                </>
              )}
            </button>
          </div>
        </div>
        {isGeneratingSuggestions && (
          <div className="mt-3">
            <AIGenerationProgress
              isActive={true}
              message="Generating AI suggestions…"
              expectedSeconds={35}
            />
          </div>
        )}
        {autopilotSummary && (
          <div className="mt-3 text-xs text-gray-700 flex items-center gap-3">
            <span>✔ Scheduled {autopilotSummary.scheduled} items</span>
            <span>⚠ Skipped {autopilotSummary.skipped} (missing media)</span>
          </div>
        )}
        {executionModeActive && (
          <div className="mt-1 text-xs text-indigo-700">
            ⚡ Execution Mode
          </div>
        )}
        {legacyDailyDetected && (
          <div className="mt-2 text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded px-2 py-1 inline-block">
            Legacy daily plan detected — please regenerate weekly plan.
          </div>
        )}
        {week?.autopilot_result && (
          <div className="mt-1 text-xs text-gray-600">
            AI used {countStrategicFactors(dailyActivities)} strategic factors.
          </div>
        )}
        
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
          {[
            { id: 'planning', label: 'Daily Planning', icon: Calendar },
            { id: 'content', label: 'Content Creation', icon: FileText },
            { id: 'voice', label: 'Voice Notes', icon: Mic }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
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
      </div>

      {/* AI Suggestions Panel */}
      {showAiSuggestions && aiSuggestions.length > 0 && activeTab === 'planning' && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            AI Suggestions for Week {week.weekNumber}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiSuggestions.map((suggestion, index) => (
              <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{suggestion.day}</span>
                  <button
                    onClick={() => applyAISuggestion(suggestion)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-sm text-gray-600">{suggestion.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    {suggestion.platform}
                  </span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    {suggestion.contentType}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Creation Panel */}
      {activeTab === 'content' && (
        <ContentCreationPanel
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onContentSave={handleContentSave}
        />
      )}

      {/* Voice Notes Panel */}
      {activeTab === 'voice' && (
        <VoiceNotesComponent
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onTranscriptionComplete={handleVoiceTranscription}
        />
      )}

      {/* Daily Activities Grid */}
      {activeTab === 'planning' && (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
          {daysOfWeek.map((day, dayIndex) => {
            const dayActivities = getActivitiesForDay(day);
            const isExpanded = expandedDayCards.has(day);
            const date = new Date(week.dates?.start || new Date());
            date.setDate(date.getDate() + dayIndex);
            
            return (
              <div
                key={day}
                className={`bg-gray-50 rounded-xl p-4 border transition-colors ${
                  selectedDay === day ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => openDayActivitiesView(day)}
                    className="text-left hover:text-indigo-700 transition-colors"
                    title={`Open ${day} daily view`}
                  >
                    <h4 className="font-semibold text-gray-900">{day}</h4>
                    <p className="text-xs text-gray-500">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDayCardSize(day);
                      }}
                      className="p-1 hover:bg-indigo-100 rounded text-indigo-600"
                      title={isExpanded ? 'Minimize card' : 'Maximize card'}
                    >
                      {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => improveDailyPlan(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="AI Improve Day Plan"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openContentPanel(day)}
                      className="p-1 hover:bg-blue-100 rounded text-blue-600"
                      title="Add Content"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openVoiceNotes(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="Voice Notes"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => addNewActivity(day)}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Add Activity"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {dayActivities.length > 0 && dayActivities.some(a => a.status !== 'committed') && (
                      <button
                        onClick={() => commitDailyPlan(day)}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200"
                        title="Submit Day Plan"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                </div>

              {!isExpanded ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white/70 p-3 text-center text-xs text-gray-600">
                  {dayActivities.length} activit{dayActivities.length === 1 ? 'y' : 'ies'} hidden
                </div>
              ) : (
                <div className="space-y-2">
                  {dayActivities.map((activity) => (
                    <div key={activity.id} className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{activity.time}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            activity.status === 'committed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : activity.status === 'scheduled'
                                ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                          title={`Status: ${activity.status === 'committed' ? 'submitted' : activity.status === 'scheduled' ? 'scheduled' : 'draft'}`}
                        >
                          {activity.status === 'committed' ? 'submitted' : activity.status === 'scheduled' ? 'scheduled' : 'draft'}
                        </span>
                        {activity.aiSuggested && (
                          <div title="AI Suggested">
                            <Sparkles className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                        {activity.aiEdited && (
                          <div title="AI Edited">
                            <Brain className="h-3 w-3 text-blue-500" />
                          </div>
                        )}
                        {activity.content && (
                          <div title="Has Content">
                            <FileText className="h-3 w-3 text-green-500" />
                          </div>
                        )}
                        {activity.voiceNotes && activity.voiceNotes.length > 0 && (
                          <div title="Has Voice Notes">
                            <Mic className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                        {hasMasterGenerated(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">
                            🧠 Master Generated
                          </span>
                        )}
                        {hasAiGeneratedMasterContent(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                            ✨ AI Generated Master
                          </span>
                        )}
                        {hasVariantsReady(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-100 text-cyan-700">
                            ⚙️ Variants Ready
                          </span>
                        )}
                        {hasAiAdaptedVariant(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky-100 text-sky-700">
                            🌐 AI Adapted
                          </span>
                        )}
                        {hasDiscoverabilityOptimization(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-lime-100 text-lime-700">
                            📈 Discoverability Optimized
                          </span>
                        )}
                        {hasAlgorithmicFormattingOptimization(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                            🧠 Algorithm Optimized
                          </span>
                        )}
                        {hasMediaSearchSuggestions(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-100 text-cyan-700">
                            🔍 Media Suggestions Ready
                          </span>
                        )}
                        {getExecutionReadinessBadge(activity.dailyExecutionItem) && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getExecutionReadinessBadge(activity.dailyExecutionItem)?.className}`}
                          >
                            {getExecutionReadinessBadge(activity.dailyExecutionItem)?.label}
                          </span>
                        )}
                        {getExecutionJobPills(activity.dailyExecutionItem).length > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                            {getExecutionJobPills(activity.dailyExecutionItem).join(' ')}
                          </span>
                        )}
                        {hasSchedulableExecutionJob(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">
                            🗓 Schedulable
                          </span>
                        )}
                        {getMediaStatusBadge(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                            {getMediaStatusBadge(activity.dailyExecutionItem)}
                          </span>
                        )}
                        {getRetentionBadge(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                            {getRetentionBadge(activity.dailyExecutionItem)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateActivity(activity.id, { status: 'completed' })}
                          className="p-1 hover:bg-green-100 rounded text-green-600"
                        >
                          <CheckCircle className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteActivity(activity.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => openActivityWorkspace(activity.id)}
                        className="w-full text-left text-sm font-semibold text-indigo-700 hover:text-indigo-800 hover:underline"
                        title="Open activity workspace"
                      >
                        {activity.title || activity.topic || 'Open activity workspace'}
                      </button>
                      <input
                        type="text"
                        value={activity.title}
                        onChange={(e) => updateActivity(activity.id, { title: e.target.value })}
                        className="w-full text-sm font-medium border-none bg-transparent focus:outline-none"
                        placeholder="Activity title"
                      />
                      
                      <div className="flex gap-2">
                        <select
                          value={activity.platform}
                          onChange={(e) => updateActivity(activity.id, { platform: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {platforms.map(platform => (
                            <option key={platform} value={platform}>{platform}</option>
                          ))}
                        </select>
                        <select
                          value={activity.contentType}
                          onChange={(e) => updateActivity(activity.id, { contentType: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {(platformContentTypes[activity.platform as keyof typeof platformContentTypes] || getAllContentTypes()).map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        value={activity.description}
                        onChange={(e) => updateActivity(activity.id, { description: e.target.value })}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 h-16 resize-none"
                        placeholder="Activity description..."
                      />
                      {(activity.dailyExecutionItem?.master_content?.decision_trace ||
                        activity.dailyExecutionItem?.writer_content_brief ||
                        activity.dailyExecutionItem?.master_content ||
                        (Array.isArray(activity.dailyExecutionItem?.platform_variants) &&
                          activity.dailyExecutionItem?.platform_variants.some((v) => v?.adaptation_trace))) && (
                        <details className="text-xs border border-gray-200 rounded px-2 py-2 bg-gray-50">
                          <summary className="cursor-pointer font-medium text-gray-700">AI Decision</summary>
                          <div className="mt-2 space-y-1 text-gray-600">
                            {activity.dailyExecutionItem?.writer_content_brief && (
                              <div>
                                <span className="font-medium">Writer brief:</span>{' '}
                                {String((activity.dailyExecutionItem.writer_content_brief as any)?.core_message || 'available')}
                              </div>
                            )}
                            {activity.dailyExecutionItem?.master_content && (
                              <div>
                                <span className="font-medium">Master content:</span>{' '}
                                {activity.dailyExecutionItem.master_content.generation_status}
                              </div>
                            )}
                            {Array.isArray(activity.dailyExecutionItem?.platform_variants) && (
                              <div>
                                <span className="font-medium">Variants:</span>{' '}
                                {activity.dailyExecutionItem.platform_variants.length}
                              </div>
                            )}
                            {activity.dailyExecutionItem?.master_content?.decision_trace && (
                              <>
                                <div>
                                  <span className="font-medium">Objective:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.objective}
                                </div>
                                <div>
                                  <span className="font-medium">Pain point:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.pain_point}
                                </div>
                                <div>
                                  <span className="font-medium">Tone:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.tone_used}
                                </div>
                                <div>
                                  <span className="font-medium">Narrative role:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.narrative_role}
                                </div>
                              </>
                            )}
                            {(() => {
                              const variants = Array.isArray(activity.dailyExecutionItem?.platform_variants)
                                ? activity.dailyExecutionItem!.platform_variants!
                                : [];
                              const selectedVariant =
                                variants.find((v) => String(v?.platform || '').toLowerCase() === String(activity.platform || '').toLowerCase()) ||
                                variants[0];
                              const trace = selectedVariant?.adaptation_trace;
                              if (!trace) return null;
                              return (
                                <>
                                  <div>
                                    <span className="font-medium">Platform strategy:</span> {trace.style_strategy}
                                  </div>
                                  <div>
                                    <span className="font-medium">Character limit:</span>{' '}
                                    {trace.character_limit_used ?? 'none'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Format used:</span> {trace.format_family}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </details>
                      )}
                      {(() => {
                        const variants = Array.isArray(activity.dailyExecutionItem?.platform_variants)
                          ? activity.dailyExecutionItem!.platform_variants!
                          : [];
                        const selectedVariant =
                          variants.find((v) => String(v?.platform || '').toLowerCase() === String(activity.platform || '').toLowerCase()) ||
                          variants[0];
                        const mediaSearchIntent = selectedVariant?.media_search_intent;
                        const requirements = Array.isArray(mediaSearchIntent?.media_requirements)
                          ? mediaSearchIntent.media_requirements
                          : [];
                        if (requirements.length === 0) return null;
                        const requiredItems = requirements.filter((r) => r.required);
                        const optionalItems = requirements.filter((r) => !r.required);
                        const mediaIcon = (mediaType: string) =>
                          mediaType === 'video' ? '🎥' : '🖼';
                        const copyPrimary = (query: string) => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(query).catch(() => undefined);
                          }
                        };
                        return (
                          <details className="text-xs border border-cyan-200 rounded px-2 py-2 bg-cyan-50">
                            <summary className="cursor-pointer font-medium text-cyan-800">Media Search Suggestions</summary>
                            <div className="mt-2 space-y-1 text-cyan-900">
                              {requiredItems.length > 0 && (
                                <div>
                                  <span className="font-medium">Required</span>
                                  <div className="mt-1 space-y-2">
                                    {requiredItems.map((item, idx) => (
                                      <div key={`${item.role}-required-${idx}`} className="rounded border border-cyan-200 bg-white px-2 py-1">
                                        <div className="font-medium">
                                          {mediaIcon(item.media_type)} {item.role.replace(/_/g, ' ')} Required
                                        </div>
                                        <div><span className="font-medium">Primary Search:</span> {item.primary_query}</div>
                                        {item.alternative_queries.length > 0 && (
                                          <div>
                                            <span className="font-medium">Alternatives:</span>{' '}
                                            {item.alternative_queries.join(' | ')}
                                          </div>
                                        )}
                                        <div><span className="font-medium">Orientation:</span> {item.orientation}</div>
                                        <button
                                          type="button"
                                          onClick={() => copyPrimary(item.primary_query)}
                                          className="mt-1 text-[11px] px-2 py-0.5 rounded bg-cyan-100 hover:bg-cyan-200"
                                        >
                                          Copy
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {optionalItems.length > 0 && (
                                <div>
                                  <span className="font-medium">Optional</span>
                                  <div className="mt-1 space-y-2">
                                    {optionalItems.map((item, idx) => (
                                      <div key={`${item.role}-optional-${idx}`} className="rounded border border-cyan-200 bg-white px-2 py-1">
                                        <div className="font-medium">
                                          {mediaIcon(item.media_type)} {item.role.replace(/_/g, ' ')} Optional
                                        </div>
                                        <div><span className="font-medium">Primary Search:</span> {item.primary_query}</div>
                                        <div><span className="font-medium">Orientation:</span> {item.orientation}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })()}
                    </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}

      {/* Focused Daily View */}
      {showDayActivitiesView && selectedDay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div
            className={`w-full overflow-hidden bg-white shadow-2xl transition-all duration-200 ${
              isDayActivitiesMaximized
                ? 'h-full max-h-full rounded-none'
                : 'max-w-3xl max-h-[85vh] rounded-2xl'
            }`}
          >
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedDay} - Activities
                </h3>
                <p className="text-sm text-gray-500">
                  {getActivitiesForDay(selectedDay).length} item{getActivitiesForDay(selectedDay).length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsDayActivitiesMinimized((prev) => !prev)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  title={isDayActivitiesMinimized ? 'Expand' : 'Minimize'}
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsDayActivitiesMaximized((prev) => !prev)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  title={isDayActivitiesMaximized ? 'Restore' : 'Maximize'}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setShowDayActivitiesView(false);
                    setIsDayActivitiesMinimized(false);
                    setIsDayActivitiesMaximized(false);
                  }}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {!isDayActivitiesMinimized && (
              <div
                className={`overflow-y-auto p-4 space-y-3 ${
                  isDayActivitiesMaximized ? 'max-h-[calc(100vh-76px)]' : 'max-h-[calc(85vh-76px)]'
                }`}
              >
                {getActivitiesForDay(selectedDay).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    No activities planned for {selectedDay}.
                  </div>
                ) : (
                  getActivitiesForDay(selectedDay).map((activity) => (
                    <div
                      key={`day-view-${activity.id}`}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-gray-900">{activity.title}</div>
                        <div className="text-xs text-gray-500">{activity.time}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
                        <PlatformIcon platform={activity.platform} size={12} showLabel /> • {activity.contentType} • {activity.status}
                      </div>

                      {activity.description && (
                        <button
                          type="button"
                          onClick={() => openActivityWorkspace(activity.id)}
                          className="mt-2 w-full rounded border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-left text-sm text-gray-700 whitespace-pre-wrap hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                          title="Open activity workspace"
                        >
                          {activity.description}
                        </button>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedActivityIdForDetail(activity.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-700"
                        >
                          Schedule by platform
                        </button>
                        <button
                          type="button"
                          onClick={() => openActivityWorkspace(activity.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-700"
                        >
                          Open activity workspace
                        </button>
                      </div>

                      <div className="mt-3 border-t border-gray-200 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-xs text-gray-600">
                          Date
                          <input
                            type="date"
                            value={activity.date || ''}
                            min={campaignData?.start_date || new Date().toISOString().split('T')[0]}
                            onChange={(e) => updateActivity(activity.id, { date: e.target.value })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          Time
                          <input
                            type="time"
                            value={activity.time || '09:00'}
                            onChange={(e) => updateActivity(activity.id, { time: e.target.value })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          />
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity-specific scheduler view */}
      {selectedActivityAnchor && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selectedActivityAnchor.title}</h3>
                <p className="text-sm text-gray-500">
                  {selectedActivityScheduleGroup.length} platform schedule
                  {selectedActivityScheduleGroup.length === 1 ? '' : 's'} • {selectedActivityAnchor.day}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openActivityWorkspace(selectedActivityAnchor.id)}
                  className="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-sm hover:bg-indigo-50"
                >
                  Open Activity Workspace
                </button>
                <button
                  onClick={() => setSelectedActivityIdForDetail(null)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              {selectedActivityScheduleGroup.map((item) => (
                <div key={`activity-schedule-${item.id}`} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-gray-900"><PlatformIcon platform={item.platform} size={14} showLabel /></div>
                    <div className="text-xs text-gray-500">{item.contentType}</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-xs text-gray-600">
                      Date
                      <input
                        type="date"
                        value={item.date || ''}
                        min={campaignData?.start_date || new Date().toISOString().split('T')[0]}
                        onChange={(e) => updateActivity(item.id, { date: e.target.value })}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      Time
                      <input
                        type="time"
                        value={item.time || '09:00'}
                        onChange={(e) => updateActivity(item.id, { time: e.target.value })}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={saveDailyPlan}
          className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
        >
          <Save className="h-5 w-5" />
          Save Daily Plan
        </button>
      </div>
    </div>
  );
}





export { default } from './DailyPlanViewMain';

