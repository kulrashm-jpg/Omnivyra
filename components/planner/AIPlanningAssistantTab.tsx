/**
 * AI Planning Assistant Tab
 * Chat-style interface: user prompts call /api/campaigns/ai/plan; updates planner state with returned plan.
 */

import React, { useState } from 'react';
import { usePlannerSession, type StrategicThemeEntry } from './plannerSessionStore';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { Send, Loader2 } from 'lucide-react';
import ChatVoiceButton from '../ChatVoiceButton';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { buildPlannerExecutionHandoff, buildPlannerPrefilledPlanning } from '../../lib/plannerExecutionHandoff';

export interface AIPlanningAssistantTabProps {
  companyId?: string | null;
}

export function AIPlanningAssistantTab({ companyId }: AIPlanningAssistantTabProps) {
  const { state, setCampaignStructure, setCalendarPlan, setRecommendedSuggestions, setStrategicThemes, setStrategicCard } = usePlannerSession();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

  const spine = state.campaign_design?.idea_spine;
  const strat = state.execution_plan?.strategy_context;
  const calendarPlan = state.execution_plan?.calendar_plan ?? state.calendar_plan;
  const hasIdea = Boolean((spine?.refined_title ?? spine?.title ?? '').trim()) || Boolean((spine?.refined_description ?? spine?.description ?? '').trim());
  const hasCalendarPlan = Boolean(calendarPlan?.activities?.length) || Boolean(calendarPlan?.days?.length);

  const handleSend = async () => {
    const text = message.trim();
    if (!text) return;
    if (!companyId) {
      setError('Select a company first.');
      return;
    }
    if (!hasIdea) {
      setError('Complete Campaign Context (idea/title and description) first.');
      return;
    }

    setLoading(true);
    setError(null);
    setHistory((h) => [...h, { role: 'user', text }]);
    setMessage('');

    const isThemeRequest = /generate themes|suggest themes/i.test(text);

    try {
      if (isThemeRequest) {
        const handoff = buildPlannerExecutionHandoff({
          skeleton_confirmed: state.skeleton_confirmed,
          strategy_confirmed: state.strategy_confirmed,
          idea_spine: spine,
          strategy_context: strat,
          strategic_card: state.strategic_card,
          strategic_themes: state.strategic_themes,
          company_context_mode: state.campaign_design?.company_context_mode,
          focus_modules: state.campaign_design?.focus_modules,
          platform_content_requests: state.platform_content_requests,
          calendar_plan: calendarPlan,
        });
        const res = await fetchWithAuth('/api/planner/generate-themes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            idea_spine: spine,
            strategy_context: handoff.strategy_context,
            company_context_mode: handoff.company_context_mode,
            focus_modules: handoff.focus_modules,
            trend_context: state.campaign_design?.trend_context ?? state.trend_context ?? undefined,
            duration_weeks: handoff.strategy_context?.duration_weeks ?? 4,
            execution_handoff: handoff,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to generate themes');
        const raw = Array.isArray(data?.themes) ? data.themes : [];
        const themes: StrategicThemeEntry[] = raw
          .map((t: unknown, i: number) => {
            if (t && typeof t === 'object' && 'week' in t && 'title' in t)
              return {
                week: Number((t as { week: unknown }).week) || i + 1,
                title: String((t as { title: unknown }).title ?? ''),
                phase_label: 'phase_label' in t ? String((t as { phase_label?: unknown }).phase_label ?? '') : undefined,
                objective: 'objective' in t ? String((t as { objective?: unknown }).objective ?? '') : undefined,
                content_focus: 'content_focus' in t ? String((t as { content_focus?: unknown }).content_focus ?? '') : undefined,
                cta_focus: 'cta_focus' in t ? String((t as { cta_focus?: unknown }).cta_focus ?? '') : undefined,
              };
            if (typeof t === 'string') return { week: i + 1, title: t };
            return null;
          })
          .filter((x): x is StrategicThemeEntry => x !== null && x.title.trim() !== '');
        if (themes.length > 0) {
          if (data?.strategic_card && typeof data.strategic_card === 'object' && !Array.isArray(data.strategic_card)) {
            setStrategicCard(data.strategic_card);
          }
          setStrategicThemes(themes);
          setHistory((h) => [...h, { role: 'assistant', text: `Generated ${themes.length} weekly themes. You can apply them in the Strategy tab and then generate your skeleton.` }]);
        } else {
          setHistory((h) => [...h, { role: 'assistant', text: 'No themes were generated. Ensure your campaign idea and description are filled in.' }]);
        }
        setLoading(false);
        return;
      }

      const usePlannerCommand = hasCalendarPlan && calendarPlan;
      const handoff = buildPlannerExecutionHandoff({
        skeleton_confirmed: state.skeleton_confirmed,
        strategy_confirmed: state.strategy_confirmed,
        idea_spine: spine,
        strategy_context: strat,
        strategic_card: state.strategic_card,
        strategic_themes: state.strategic_themes,
        company_context_mode: state.campaign_design?.company_context_mode,
        focus_modules: state.campaign_design?.focus_modules,
        platform_content_requests: state.platform_content_requests,
        calendar_plan: calendarPlan,
      });
      const sourceIds = state.source_ids ?? {};
      const body: Record<string, unknown> = {
        preview_mode: true,
        mode: usePlannerCommand ? 'planner_command' : 'generate_plan',
        message: text,
        companyId,
        idea_spine: spine,
        strategy_context: handoff.strategy_context,
        campaign_direction: spine?.selected_angle ?? 'EDUCATION',
        company_context_mode: handoff.company_context_mode,
        focus_modules: handoff.focus_modules,
        execution_handoff: handoff,
        prefilledPlanning: buildPlannerPrefilledPlanning(handoff),
        ...(sourceIds.source_opportunity_id ? { opportunity_id: sourceIds.source_opportunity_id } : {}),
        ...(sourceIds.opportunity_score != null ? { opportunity_score: sourceIds.opportunity_score } : {}),
      };
      if (usePlannerCommand && calendarPlan) {
        body.calendar_plan = calendarPlan;
        body.platform_content_requests = state.platform_content_requests ?? undefined;
        body.campaign_type = state.campaign_type ?? undefined;
      }
      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Plan generation failed');

      if (usePlannerCommand && data?.plan?.calendar_plan) {
        setCalendarPlan(data.plan.calendar_plan);
        setHistory((h) => [...h, { role: 'assistant', text: 'Calendar updated.' }]);
      } else {
        const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
        const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
        setCampaignStructure(campaign_structure);
        setCalendarPlan(calendar_plan);
        const recGoal = typeof data?.recommended_goal === 'string' ? data.recommended_goal.trim() : null;
        const recAud = Array.isArray(data?.recommended_audience)
          ? (data.recommended_audience as string[]).filter((s) => typeof s === 'string' && s.trim())
          : null;
        if (recGoal || (recAud?.length ?? 0) > 0) {
          setRecommendedSuggestions(recGoal ?? null, recAud ?? null);
        }
        setHistory((h) => [...h, { role: 'assistant', text: weeks.length > 0 ? `Generated plan with ${weeks.length} weeks.` : 'Plan generated.' }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate plan');
      setHistory((h) => h.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
        {history.length === 0 && (
          <p className="text-sm text-gray-500">
            Ask for a campaign plan. Example: &quot;Generate a 4-week LinkedIn campaign with 3 posts per week.&quot; Or: &quot;Generate themes&quot; / &quot;Suggest themes&quot; for weekly themes.
          </p>
        )}
        {history.map((entry, i) => (
          <div
            key={i}
            className={`text-sm ${entry.role === 'user' ? 'text-right text-indigo-700' : 'text-left text-gray-700'}`}
          >
            {entry.text}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2 items-end">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder="Describe your campaign..."
          rows={2}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          disabled={loading}
        />
        <ChatVoiceButton
          onTranscription={setMessage}
          disabled={loading}
          title="Voice input: describe your campaign or give commands"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !message.trim()}
          title="Send"
          className="flex-shrink-0 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
