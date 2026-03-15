/**
 * Content Tab
 * Edit topic, angle, CTA for selected calendar activity.
 * Select activity from calendar (via selected_activity in planner session).
 */

import React, { useState, useEffect } from 'react';
import { usePlannerSession, type CalendarPlanActivity } from '../plannerSessionStore';
import { ExternalLink, Sparkles, Loader2 } from 'lucide-react';

export interface ContentTabProps {
  campaignId?: string | null;
  companyId?: string | null;
}

export function ContentTab({ campaignId, companyId }: ContentTabProps) {
  const { state, setCalendarPlan, setSelectedActivity } = usePlannerSession();
  const selected = state.selected_activity ?? null;
  const calendarPlan = state.execution_plan?.calendar_plan ?? state.calendar_plan;
  const activities = calendarPlan?.activities ?? [];

  const [topic, setTopic] = useState(selected?.title ?? selected?.theme ?? '');
  const [angle, setAngle] = useState((selected as CalendarPlanActivity & { angle?: string })?.angle ?? '');
  const [cta, setCta] = useState((selected as CalendarPlanActivity & { cta?: string })?.cta ?? (selected as CalendarPlanActivity & { objective?: string })?.objective ?? '');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (selected) {
      setTopic(selected.title ?? selected.theme ?? '');
      setAngle((selected as CalendarPlanActivity & { angle?: string })?.angle ?? '');
      setCta((selected as CalendarPlanActivity & { cta?: string })?.cta ?? (selected as CalendarPlanActivity & { objective?: string })?.objective ?? '');
    }
  }, [selected]);

  const updateActivityInPlan = (updates: Partial<CalendarPlanActivity>) => {
    if (!selected?.execution_id || !calendarPlan) return;
    const nextActivities = (activities as CalendarPlanActivity[]).map((a) =>
      a.execution_id === selected.execution_id ? { ...a, ...updates } : a
    );
    setCalendarPlan({ ...calendarPlan, activities: nextActivities });
  };

  const handleSave = () => {
    if (!selected) return;
    updateActivityInPlan({
      title: topic.trim() || undefined,
      theme: topic.trim() || undefined,
      ...(angle !== undefined && { angle }),
      ...(cta !== undefined && { objective: cta, cta }),
    } as Partial<CalendarPlanActivity & { angle?: string; cta?: string }>);
  };

  const handleGenerateTopic = async () => {
    if (!companyId || !selected) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preview_mode: true,
          mode: 'planner_command',
          message: `Suggest a topic for this activity: ${selected.platform}/${selected.content_type}, week ${selected.week_number}, ${selected.day}. Current: ${topic || 'none'}`,
          companyId,
          calendar_plan: calendarPlan,
          idea_spine: state.campaign_design?.idea_spine,
          strategy_context: state.execution_plan?.strategy_context,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.plan?.calendar_plan?.activities) {
        const updated = (data.plan.calendar_plan.activities as CalendarPlanActivity[]).find(
          (a: CalendarPlanActivity) => a.execution_id === selected.execution_id
        );
        if (updated?.title) setTopic(updated.title);
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const openActivityWorkspace = () => {
    if (!selected) return;
    const workspaceKey = campaignId
      ? `activity-workspace-${campaignId}-${selected.execution_id}`
      : `activity-workspace-planner-preview-${selected.execution_id}`;
    const payload = {
      campaignId: campaignId ?? null,
      weekNumber: selected.week_number,
      day: selected.day ?? 'Monday',
      activityId: selected.execution_id,
      title: selected.title,
      topic: selected.title,
      description: '',
      dailyExecutionItem: {
        topic: selected.title,
        title: selected.title,
        platform: selected.platform,
        content_type: selected.content_type,
      },
      schedules: [],
    };
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch {
      // ignore
    }
  };

  if (!selected) {
    return (
      <div className="p-4 text-sm text-gray-500">
        <p>Click an activity on the calendar to edit its topic, angle, and CTA.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-sm">
        <span className="font-medium text-indigo-800">
          {selected.platform}/{selected.content_type}
        </span>
        <span className="text-indigo-600 ml-1">
          Week {selected.week_number} · {selected.day ?? '—'}
        </span>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={handleSave}
            placeholder="Activity topic / theme"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
          <button
            type="button"
            onClick={handleGenerateTopic}
            disabled={generating}
            className="px-3 py-2 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 flex items-center gap-1"
            title="Generate topic with AI"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Angle</label>
        <input
          type="text"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          onBlur={handleSave}
          placeholder="Narrative angle or focus"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">CTA</label>
        <input
          type="text"
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          onBlur={handleSave}
          placeholder="Call to action"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>
      <button
        type="button"
        onClick={openActivityWorkspace}
        className="w-full px-4 py-2 rounded-lg border border-indigo-300 text-indigo-700 text-sm font-medium hover:bg-indigo-50 flex items-center justify-center gap-2"
      >
        <ExternalLink className="h-4 w-4" />
        Open in Workspace
      </button>
      <button
        type="button"
        onClick={() => setSelectedActivity(null)}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Clear selection
      </button>
    </div>
  );
}
