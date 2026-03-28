/**
 * Skeleton Builder Panel
 * Left panel in the Skeleton tab.
 * Always visible: Start date + Duration.
 * Sub-tabs:
 *   "Schedule" — manual Platform Content Matrix + Generate Skeleton button
 *   "AI Chat"  — chat interface to describe and refine skeleton; updates calendar on the right
 */

import { useRef, useState } from 'react';
import { Sparkles, Loader2, CalendarDays, Send } from 'lucide-react';
import { usePlannerSession, type StrategyContext } from './plannerSessionStore';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { PlatformContentMatrix } from './PlatformContentMatrix';
import ChatVoiceButton from '../ChatVoiceButton';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { buildPlannerExecutionHandoff, buildPlannerPrefilledPlanning } from '../../lib/plannerExecutionHandoff';

const DEFAULT_DURATION_WEEKS = 4;
const DURATION_OPTIONS = [1, 2, 4, 6, 8, 10, 12] as const;

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function deriveStrategyFromMatrix(
  platform_content_requests: Record<string, Record<string, number>> | null,
  duration_weeks: number,
  startDate: string,
  prev: StrategyContext | null | undefined
): StrategyContext | null {
  if (!platform_content_requests || Object.keys(platform_content_requests).length === 0) return null;
  const platforms = Object.keys(platform_content_requests);
  const posting_frequency: Record<string, number> = {};
  const contentSet = new Set<string>();
  for (const [p, ctMap] of Object.entries(platform_content_requests)) {
    let sum = 0;
    for (const [ct, count] of Object.entries(ctMap)) {
      if (count > 0) { sum += count; contentSet.add(ct); }
    }
    posting_frequency[p] = sum;
  }
  return {
    duration_weeks,
    platforms,
    posting_frequency,
    content_mix: Array.from(contentSet),
    campaign_goal: prev?.campaign_goal ?? '',
    target_audience: prev?.target_audience ?? '',
    planned_start_date: startDate,
  };
}

export interface SkeletonBuilderPanelProps {
  companyId?: string | null;
  onGenerate?: () => void;
  onConfirmed?: () => void;
  canConfirm?: boolean;
  strategyAlreadyConfirmed?: boolean;
}

export function SkeletonBuilderPanel({
  companyId,
  onGenerate,
  onConfirmed,
  canConfirm = false,
  strategyAlreadyConfirmed = false,
}: SkeletonBuilderPanelProps) {
  const { state, setStrategyContext, setCampaignStructure, setCalendarPlan, confirmSkeleton } = usePlannerSession();
  const prev = state.execution_plan?.strategy_context;

  const startDate = (prev?.planned_start_date && /^\d{4}-\d{2}-\d{2}$/.test(prev.planned_start_date))
    ? prev.planned_start_date : defaultStartDate();
  const durationWeeks = prev?.duration_weeks ?? DEFAULT_DURATION_WEEKS;

  const [skeletonTab, setSkeletonTab] = useState<'schedule' | 'ai'>('schedule');

  // Schedule tab state
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // AI Chat tab state
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Schedule tab
  const platform_content_requests = state.platform_content_requests ?? null;
  const strategyFromMatrix = deriveStrategyFromMatrix(platform_content_requests, durationWeeks, startDate, prev);
  const canSchedule = durationWeeks > 0 && !!strategyFromMatrix && strategyFromMatrix.platforms.length > 0;

  const handleScheduleGenerate = async () => {
    if (!canSchedule || !strategyFromMatrix) return;
    if (!companyId) { setScheduleError('Select a company first.'); return; }
    setStrategyContext(strategyFromMatrix);
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const spine = state.campaign_design?.idea_spine;
      const mergedStrategyContext = {
        ...strategyFromMatrix,
        ...(prev?.selected_aspects?.length ? { selected_aspects: prev.selected_aspects } : {}),
        ...(prev?.selected_offerings?.length ? { selected_offerings: prev.selected_offerings } : {}),
      };
      const handoff = buildPlannerExecutionHandoff({
        skeleton_confirmed: state.skeleton_confirmed,
        strategy_confirmed: state.strategy_confirmed,
        idea_spine: spine,
        strategy_context: mergedStrategyContext,
        strategic_card: state.strategic_card,
        strategic_themes: state.strategic_themes,
        company_context_mode: state.campaign_design?.company_context_mode,
        focus_modules: state.campaign_design?.focus_modules,
        platform_content_requests,
        calendar_plan: state.calendar_plan ?? state.execution_plan?.calendar_plan,
      });
      const body: Record<string, unknown> = {
        preview_mode: true,
        mode: 'generate_plan',
        message: [spine?.refined_title ?? spine?.title, spine?.refined_description ?? spine?.description]
          .filter(Boolean).join('\n\n') || 'Generate campaign plan.',
        companyId,
        idea_spine: spine,
        strategy_context: handoff.strategy_context,
        campaign_direction: spine?.selected_angle ?? 'EDUCATION',
        company_context_mode: handoff.company_context_mode,
        focus_modules: handoff.focus_modules,
        campaign_type: state.campaign_type ?? 'TEXT',
        account_context: state.account_context,
        execution_handoff: handoff,
        prefilledPlanning: buildPlannerPrefilledPlanning(handoff),
      };
      if (platform_content_requests && Object.keys(platform_content_requests).length > 0) {
        body.platform_content_requests = platform_content_requests;
      }
      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Generation failed');
      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
      onGenerate?.();
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'Could not generate skeleton');
    } finally {
      setScheduleLoading(false);
    }
  };

  // Flatten calendar_plan into a simple activity array
  function flatActivities() {
    const cp = state.calendar_plan ?? state.execution_plan?.calendar_plan;
    if (!cp) return [];
    if (Array.isArray(cp.activities) && cp.activities.length > 0) return cp.activities;
    if (Array.isArray(cp.days) && cp.days.length > 0) {
      return cp.days.flatMap((d) =>
        (d.activities ?? []).map((a) => ({ ...a, day: a.day ?? d.day, week_number: a.week_number ?? d.week_number }))
      );
    }
    return [];
  }

  const touchedWeeks = new Set(
    flatActivities()
      .map((activity) => Number(activity.week_number) || 0)
      .filter((week) => week > 0)
  );
  const canSubmitSkeleton = canConfirm && touchedWeeks.size >= durationWeeks;

  function handleConfirmSkeleton() {
    if (!canSubmitSkeleton) return;
    confirmSkeleton();
    onConfirmed?.();
  }

  // AI Chat tab — send message, update calendar
  const handleChatSend = async () => {
    const text = chatMessage.trim();
    if (!text || chatLoading) return;
    if (!companyId) { setChatError('Select a company first.'); return; }

    setChatHistory((h) => [...h, { role: 'user', text }]);
    setChatMessage('');
    setChatLoading(true);
    setChatError(null);

    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      const calendarPlan = state.calendar_plan ?? state.execution_plan?.calendar_plan;
      const existing = flatActivities();
      const hasExisting = existing.length > 0;

      if (hasExisting) {
        // Use dedicated skeleton-command endpoint for modifications
        const res = await fetchWithAuth('/api/planner/skeleton-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            message: text,
            activities: existing,
            strategy_context: {
              duration_weeks: durationWeeks,
              planned_start_date: startDate,
              platforms: prev?.platforms ?? [],
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Command failed');

        const updatedActivities = Array.isArray(data.activities) ? data.activities : existing;

        // Rebuild days index from updated activities so all canvas views stay in sync
        const dayMap = new Map<string, { week_number: number; day: string; activities: typeof updatedActivities }>();
        for (const act of updatedActivities) {
          const key = `${act.week_number ?? 1}-${act.day ?? 'Monday'}`;
          if (!dayMap.has(key)) dayMap.set(key, { week_number: act.week_number ?? 1, day: act.day ?? 'Monday', activities: [] });
          dayMap.get(key)!.activities.push(act);
        }
        const updatedDays = Array.from(dayMap.values()).sort(
          (a, b) => a.week_number - b.week_number
        );

        setCalendarPlan({
          ...(calendarPlan ?? {}),
          activities: updatedActivities,
          days: updatedDays,
        });
        setChatHistory((h) => [...h, { role: 'assistant', text: data.reply ?? 'Skeleton updated.' }]);
      } else {
        // No skeleton yet — generate one from scratch
        const spine = state.campaign_design?.idea_spine;
        const strategyContext = prev ? {
          ...prev,
          duration_weeks: durationWeeks,
          planned_start_date: startDate,
        } : {
          duration_weeks: durationWeeks,
          planned_start_date: startDate,
          platforms: [],
          posting_frequency: {},
          content_mix: [],
          campaign_goal: '',
          target_audience: '',
        };
        const handoff = buildPlannerExecutionHandoff({
          skeleton_confirmed: state.skeleton_confirmed,
          strategy_confirmed: state.strategy_confirmed,
          idea_spine: spine,
          strategy_context: strategyContext,
          strategic_card: state.strategic_card,
          strategic_themes: state.strategic_themes,
          company_context_mode: state.campaign_design?.company_context_mode,
          focus_modules: state.campaign_design?.focus_modules,
          platform_content_requests,
          calendar_plan: state.calendar_plan ?? state.execution_plan?.calendar_plan,
        });
        const body: Record<string, unknown> = {
          preview_mode: true,
          mode: 'generate_plan',
          message: text,
          companyId,
          idea_spine: spine,
          strategy_context: handoff.strategy_context,
          campaign_direction: spine?.selected_angle ?? 'EDUCATION',
          company_context_mode: handoff.company_context_mode,
          focus_modules: handoff.focus_modules,
          campaign_type: state.campaign_type ?? 'TEXT',
          account_context: state.account_context,
          execution_handoff: handoff,
          prefilledPlanning: buildPlannerPrefilledPlanning(handoff),
        };
        if (platform_content_requests && Object.keys(platform_content_requests).length > 0) {
          body.platform_content_requests = platform_content_requests;
        }
        const res = await fetchWithAuth('/api/campaigns/ai/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Generation failed');
        const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
        const { campaign_structure, calendar_plan: newPlan } = weeksToCalendarPlan(weeks);
        setCampaignStructure(campaign_structure);
        setCalendarPlan(newPlan);
        setChatHistory((h) => [
          ...h,
          { role: 'assistant', text: weeks.length > 0 ? `Skeleton generated — ${weeks.length} weeks on the calendar.` : 'Done.' },
        ]);
        onGenerate?.();
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Could not update skeleton');
      setChatHistory((h) => h.slice(0, -1));
    } finally {
      setChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Start date + Duration — always visible */}
      <div className="flex-shrink-0 flex gap-3 p-4 pb-0">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-gray-500">Start date</label>
          <input
            type="date"
            value={startDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setStrategyContext({ ...(prev ?? {}), planned_start_date: e.target.value } as Partial<StrategyContext>)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-gray-500">Duration (weeks)</label>
          <select
            value={durationWeeks}
            onChange={(e) => setStrategyContext({ ...(prev ?? {}), duration_weeks: Number(e.target.value) || DEFAULT_DURATION_WEEKS } as Partial<StrategyContext>)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
          >
            {DURATION_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} week{n === 1 ? '' : 's'}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex-shrink-0 px-4 pt-3">
        <button
          type="button"
          onClick={handleConfirmSkeleton}
          disabled={!canSubmitSkeleton}
          title={!canSubmitSkeleton ? `Touch all ${durationWeeks} week${durationWeeks === 1 ? '' : 's'} in the skeleton first` : undefined}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
            canSubmitSkeleton
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          {strategyAlreadyConfirmed ? 'Confirm Skeleton And Open Build' : 'Confirm Skeleton And Open Strategy'}
        </button>
        <p className="mt-1 text-[11px] text-gray-500">
          Weeks covered: {touchedWeeks.size}/{durationWeeks}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex-shrink-0 flex gap-1 border-b border-gray-200 px-4 pt-3">
        <button
          type="button"
          onClick={() => setSkeletonTab('schedule')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            skeletonTab === 'schedule'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          Schedule
        </button>
        <button
          type="button"
          onClick={() => setSkeletonTab('ai')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            skeletonTab === 'ai'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          AI Chat
        </button>
      </div>

      {/* Schedule tab */}
      {skeletonTab === 'schedule' && (
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
          <PlatformContentMatrix companyId={companyId} durationWeeks={durationWeeks} />
          {scheduleError && <p className="text-xs text-red-600">{scheduleError}</p>}
          <button
            type="button"
            onClick={handleScheduleGenerate}
            disabled={!canSchedule || scheduleLoading || !companyId}
            className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {scheduleLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
              : 'Generate Skeleton'}
          </button>
        </div>
      )}

      {/* AI Chat tab */}
      {skeletonTab === 'ai' && (
        <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
          {/* Message history */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {chatHistory.length === 0 && (
              <div className="space-y-2 text-xs text-gray-400 leading-relaxed">
                {flatActivities().length === 0 ? (
                  <>
                    <p>Describe the skeleton you want to generate:</p>
                    <p className="text-gray-300 italic">&quot;4-week LinkedIn &amp; Instagram campaign, 3 posts per week&quot;</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-gray-500">Skeleton is ready. You can:</p>
                    <ul className="space-y-1 text-gray-400 list-none">
                      <li>➕ &quot;Add Instagram reels every Tuesday&quot;</li>
                      <li>🗑 &quot;Remove all Twitter posts from week 3&quot;</li>
                      <li>📅 &quot;Move Monday LinkedIn posts to Wednesday&quot;</li>
                      <li>📅 &quot;Move the week 2 Instagram story to March 25&quot;</li>
                      <li>➕ &quot;Add a Facebook post on Fridays for weeks 1–4&quot;</li>
                    </ul>
                  </>
                )}
              </div>
            )}
            {chatHistory.map((entry, i) => (
              <div
                key={i}
                className={`text-sm rounded-lg px-3 py-2 max-w-[90%] ${
                  entry.role === 'user'
                    ? 'ml-auto bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {entry.text}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-gray-100 text-gray-500 text-sm rounded-lg px-3 py-2 flex items-center gap-2 max-w-[90%]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating…
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {chatError && <p className="text-xs text-red-600 flex-shrink-0">{chatError}</p>}

          {/* Input row */}
          <div className="flex-shrink-0 flex gap-2 items-end">
            <textarea
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
              placeholder={flatActivities().length > 0 ? 'Add, remove, or move activities… e.g. "Add TikTok videos on Thursdays"' : 'Describe your skeleton…'}
              rows={2}
              disabled={chatLoading}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            />
            <ChatVoiceButton
              onTranscription={setChatMessage}
              disabled={chatLoading}
              title="Voice input"
            />
            <button
              type="button"
              onClick={handleChatSend}
              disabled={chatLoading || !chatMessage.trim()}
              title="Send"
              className="flex-shrink-0 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {chatLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
