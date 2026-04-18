import React from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { formatPlanMarkersForDisplay } from './FormattedAIMessage';
import {
  ResolvedPostingMetadata,
  WeekExecutionTopicCard,
  WeekPlatformContent,
} from './StructuredPlanSections';
import { StructuredPlanPreview } from './StructuredPlanPreview';
import { buildReviewActivityCardsForWeek } from './reviewActivityHelpers';
import type { ChatMessage, StructuredPlan } from './types';

type ReplaceSelection = { week: number; text: string } | null;

type PlanOverviewOverlayProps = {
  isOpen: boolean;
  structuredPlan: StructuredPlan | null;
  reviewWeekNumber: number;
  replaceMode: boolean;
  replaceSelection: ReplaceSelection;
  newMessage: string;
  inputClearKey: number;
  isBusy: boolean;
  isLoading: boolean;
  isTyping: boolean;
  isRecsChat: boolean;
  uiErrorMessage: string | null;
  messages: ChatMessage[];
  structuredPlanMessageId: number | null;
  context?: string;
  campaignId?: string;
  isSavingDraftForView: boolean;
  onClose: () => void;
  onSetReviewWeekNumber: (week: number) => void;
  onSetNewMessage: (value: string) => void;
  onSetReplaceMode: React.Dispatch<React.SetStateAction<boolean>>;
  onSetReplaceSelection: (selection: ReplaceSelection) => void;
  onSetUiErrorMessage: (message: string | null) => void;
  onSetInputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onPromptDailyWeek: (week: number) => void;
  onSubmitInput: () => void;
  onSaveDraftAndView: () => void;
  onSaveForLater: () => void;
  onSubmitPlan: () => void;
  planningContext: {
    lastCollectedPlanningContextFromApi: Record<string, unknown> | null;
    prefilledPlanning: Record<string, unknown> | null;
    collectedPlanningContext: Record<string, unknown> | null;
    hasProvidedPlatformContentRequests: boolean;
    planningPlatformContentRequests: Record<string, Record<string, string>>;
    planningCrossPlatformSharingEnabled: boolean;
    planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
  };
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

export function PlanOverviewOverlay({
  isOpen,
  structuredPlan,
  reviewWeekNumber,
  replaceMode,
  replaceSelection,
  newMessage,
  inputClearKey,
  isBusy,
  isLoading,
  isTyping,
  isRecsChat,
  uiErrorMessage,
  messages,
  structuredPlanMessageId,
  context,
  campaignId,
  isSavingDraftForView,
  onClose,
  onSetReviewWeekNumber,
  onSetNewMessage,
  onSetReplaceMode,
  onSetReplaceSelection,
  onSetUiErrorMessage,
  onSetInputRef,
  onPromptDailyWeek,
  onSubmitInput,
  onSaveDraftAndView,
  onSaveForLater,
  onSubmitPlan,
  planningContext,
  inputRef,
  messagesEndRef,
}: PlanOverviewOverlayProps) {
  if (!isOpen || !structuredPlan) return null;

  return (
    <div
      className="absolute inset-0 bg-white z-40 flex flex-col"
      onMouseUp={(e) => {
        if (!replaceMode) return;
        if (typeof window === 'undefined') return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('input, textarea, button')) return;
        const selection = window.getSelection?.();
        const selectedText = selection?.toString?.().trim?.() || '';
        if (!selectedText) return;
        try {
          selection?.removeAllRanges?.();
        } catch {
          // no-op
        }
        if (selectedText.length > 800) {
          onSetUiErrorMessage('Selection is too long for editing. Please select a shorter snippet (<= 800 chars).');
          return;
        }
        const weekEl = target.closest('[data-week]') as HTMLElement | null;
        const weekAttr = weekEl?.getAttribute('data-week') || '';
        const weekNumber = Number(weekAttr);
        if (!Number.isFinite(weekNumber) || weekNumber < 1) {
          onSetUiErrorMessage('Select text inside a Week card (left) or Week blueprint (right) to use Edit mode.');
          return;
        }
        onSetUiErrorMessage(null);
        onSetReplaceSelection({ week: weekNumber, text: selectedText });
        onSetReviewWeekNumber(weekNumber);
      }}
    >
      <div className="bg-indigo-600 text-white p-3 flex items-center justify-between shrink-0">
        <h3 className="text-lg font-bold">Review & Refine Plan</h3>
        <p className="text-purple-100 text-sm hidden sm:inline">Make changes through chat on the right, then Submit. To replace text: click Edit, select the portion to change, then type the new words.</p>
        <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-[45%] min-w-[280px] overflow-y-auto p-4 border-r border-gray-200 bg-gray-50">
          <div className="grid grid-cols-1 gap-3">
            {structuredPlan.weeks.map((week) => {
              const themeLabel = week.theme || week.phase_label || `Week ${week.week}`;
              const hasDaily = week.daily && week.daily.length > 0;
              const topicsWithExecution = buildReviewActivityCardsForWeek(week, planningContext);
              const hasEnrichedTopics = topicsWithExecution.length > 0;
              const platformTargets = Object.entries((week as any)?.platform_allocation || {})
                .map(([platform, count]) => `${platform}: ${count}`)
                .filter(Boolean);
              const contentTypes = Array.isArray((week as any)?.content_type_mix) ? (week as any).content_type_mix : [];

              return (
                <div
                  key={week.week}
                  data-week={week.week}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSetReviewWeekNumber(week.week)}
                  onKeyDown={(e) => e.key === 'Enter' && onSetReviewWeekNumber(week.week)}
                  className={`border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                    reviewWeekNumber === week.week ? 'ring-2 ring-indigo-400' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-900">Week {week.week}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPromptDailyWeek(week.week);
                      }}
                      disabled={isBusy}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50"
                      title="Generate daily plan"
                    >
                      <Sparkles className="h-3 w-3" />
                      AI daily
                    </button>
                  </div>
                  <div className="text-xs text-gray-600 font-medium mb-1">{themeLabel}</div>
                  {week.primary_objective && <div className="text-xs text-gray-600 mb-1">{week.primary_objective}</div>}
                  {hasEnrichedTopics ? (
                    <div className="mt-2 space-y-2 text-xs">
                      {(week as any)?.weeklyContextCapsule && (
                        <div className="rounded border border-indigo-100 bg-indigo-50/50 p-2 text-gray-700">
                          <div><span className="font-medium">Audience:</span> {(week as any).weeklyContextCapsule.audienceProfile || '—'}</div>
                          <div><span className="font-medium">Weekly intent:</span> {(week as any).weeklyContextCapsule.weeklyIntent || '—'}</div>
                          <div><span className="font-medium">Tone:</span> {(week as any).weeklyContextCapsule.toneGuidance || '—'}</div>
                        </div>
                      )}
                      <div className="space-y-2">
                        {topicsWithExecution.map((topic, idx) => (
                          <WeekExecutionTopicCard
                            key={`${week.week}-topic-${idx}`}
                            topic={topic as any}
                            idx={idx}
                            creatorInstructionSummary={
                              typeof topic?.topicExecution?.creator_instruction === 'object' &&
                              topic?.topicExecution?.creator_instruction
                                ? Object.entries(topic.topicExecution.creator_instruction as Record<string, unknown>)
                                    .filter(([, value]) => typeof value === 'string' && String(value).trim())
                                    .slice(0, 5)
                                    .map(([key, value]) => `${key}: ${String(value).trim()}`)
                                    .join(' | ')
                                    .slice(0, 220) || null
                                : null
                            }
                          />
                        ))}
                      </div>
                      {hasDaily && <span className="text-green-600">✓ {week.daily!.length} days</span>}
                    </div>
                  ) : (
                    <>
                      {week.summary && <div className="mb-2 text-xs italic text-gray-600 border-l-2 border-emerald-200 pl-2">{week.summary}</div>}
                      {(week.topics_to_cover?.length ?? 0) > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Topics to cover:</div><ul className="list-disc list-inside text-xs text-gray-700">{week.topics_to_cover!.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                      {week.objectives && week.objectives.length > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Objectives:</div><ul className="list-disc list-inside text-xs text-gray-700">{week.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
                      {platformTargets.length > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Platform allocation:</div><div className="flex flex-wrap gap-1 mt-0.5">{platformTargets.map((item, i) => <span key={i} className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs">{item}</span>)}</div></div>}
                      {contentTypes.length > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Content mix:</div><div className="flex flex-wrap gap-1 mt-0.5">{contentTypes.map((item, i) => <span key={i} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs">{item}</span>)}</div></div>}
                      {week.goals && week.goals.length > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Goals:</div><ul className="list-disc list-inside text-xs text-gray-700">{week.goals.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
                      {week.suggested_days_to_post && week.suggested_days_to_post.length > 0 && <div className="mb-2"><div className="text-gray-500 font-medium text-xs">Suggested posting days:</div><div className="flex flex-wrap gap-1 mt-0.5">{week.suggested_days_to_post.map((d, i) => <span key={i} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs">{d}</span>)}</div></div>}
                      <div className="text-xs space-y-1 mb-1">
                        <WeekPlatformContent week={week} />
                        {week.cta_type && <div className="text-gray-500">CTA: {week.cta_type} • KPI: {week.weekly_kpi_focus || '—'}</div>}
                        {hasDaily && <span className="text-green-600">✓ {week.daily!.length} days</span>}
                      </div>
                    </>
                  )}
                  <ResolvedPostingMetadata week={week} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
          <div className="border-b bg-white px-4 pt-3 pb-2">
            <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
              {structuredPlan.weeks.map((w) => (
                <button
                  key={`right-week-tab-${w.week}`}
                  type="button"
                  onClick={() => onSetReviewWeekNumber(w.week)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${reviewWeekNumber === w.week ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  Week {w.week}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1.5">
              <p>To replace text in a week: click <strong>Edit</strong>, select the portion you want to change (in the plan), then type the new wording and send.</p>
              <p className="text-xs">Edit via natural language, e.g. &quot;Week 1 Facebook topic: Professional neglecting personal lives&quot;, &quot;Same post on Facebook and LinkedIn&quot;, &quot;Week 3 LinkedIn: 2 posts, 1 article&quot;</p>
            </div>
            {messages.filter((m) => {
              if (m.type === 'user') {
                const text = (m.message || '').trim();
                if (text.startsWith('Apply a precise text replacement in the structured weekly blueprint')) return false;
                if (text.includes('Replace EXACT text:') && text.includes('With EXACT text:')) return false;
              }
              return true;
            }).map((m) => (
              <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${m.type === 'user' ? (isRecsChat ? 'bg-emerald-600 text-white' : 'bg-indigo-500 text-white') : 'bg-gray-100 text-gray-900'}`}>
                  {m.type === 'ai' && structuredPlanMessageId === m.id ? (
                    <div className="whitespace-pre-wrap" data-week={reviewWeekNumber}>
                      <StructuredPlanPreview
                        plan={{ ...structuredPlan, weeks: structuredPlan.weeks.filter((w) => w.week === reviewWeekNumber) }}
                        lastCollectedPlanningContextFromApi={planningContext.lastCollectedPlanningContextFromApi}
                        prefilledPlanning={planningContext.prefilledPlanning}
                        collectedPlanningContext={planningContext.collectedPlanningContext}
                        hasProvidedPlatformContentRequests={planningContext.hasProvidedPlatformContentRequests}
                        planningPlatformContentRequests={planningContext.planningPlatformContentRequests}
                        planningCrossPlatformSharingEnabled={planningContext.planningCrossPlatformSharingEnabled}
                        planningCrossPlatformScheduleMode={planningContext.planningCrossPlatformScheduleMode}
                      />
                    </div>
                  ) : <div className="whitespace-pre-wrap">{formatPlanMarkersForDisplay(m.message)}</div>}
                </div>
              </div>
            ))}
            {isTyping && <div className="flex justify-start"><div className="bg-gray-100 px-3 py-2 rounded-lg text-sm text-gray-600">Thinking...</div></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="sticky bottom-0 bg-white border-t shrink-0">
            <div className="p-3 sm:p-4 space-y-2">
              {uiErrorMessage && <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">{uiErrorMessage}</div>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSetReplaceMode((value) => !value);
                    onSetReplaceSelection(null);
                    onSetUiErrorMessage(null);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  disabled={isBusy}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${replaceMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'} disabled:opacity-50`}
                  title="Edit mode: highlight text, then type edited text"
                >
                  Edit
                </button>
                {replaceMode && replaceSelection?.text && (
                  <div className="flex-1 min-w-0 flex items-center gap-2 text-xs text-gray-700">
                    <div className="truncate"><span className="font-medium">Week {replaceSelection.week}:</span> “{replaceSelection.text}”</div>
                    <button type="button" onClick={() => onSetReplaceSelection(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-50">Clear</button>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  key={inputClearKey}
                  ref={onSetInputRef}
                  type="text"
                  value={newMessage}
                  onChange={(e) => onSetNewMessage(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSubmitInput();
                    }
                  }}
                  placeholder={replaceMode ? `Type the edited text and press Enter (Week ${replaceSelection?.week ?? reviewWeekNumber}).` : 'e.g. Week 1 Facebook topic: Professional neglecting personal lives. Week 3 LinkedIn: 2 posts, 1 article.'}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  disabled={isBusy}
                />
                <button
                  onClick={onSubmitInput}
                  disabled={isBusy || !newMessage.trim() || (replaceMode && !replaceSelection?.text?.trim())}
                  className={`px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${isRecsChat ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                </button>
              </div>
            </div>
            <div className="px-4 pb-4 flex justify-between items-center gap-3">
              <button onClick={onClose} className="text-gray-600 hover:text-gray-800 text-sm">Close</button>
              <div className="flex flex-wrap gap-2">
                {context === 'campaign-planning' && campaignId && (
                  <button
                    onClick={onSaveDraftAndView}
                    disabled={isSavingDraftForView}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSavingDraftForView ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save & view on campaign
                  </button>
                )}
                <button onClick={onSaveForLater} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg text-sm font-medium">Save for Later</button>
                <button onClick={onSubmitPlan} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors">Submit This Plan</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
