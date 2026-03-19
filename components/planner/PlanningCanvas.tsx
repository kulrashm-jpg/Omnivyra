/**
 * Planning Canvas
 * Views: Campaign, Month, Week, Day.
 * View switch: [Campaign] [Month] [Week] [Day]
 * Source data: plannerState.calendar_plan
 * Activity cards: platform, content type, title/theme. Click → open ActivityWorkspace (works in preview via localStorage).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Pencil, X, ChevronDown, ChevronRight } from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity, type CampaignStructurePhase } from './plannerSessionStore';
import { ActivityCardWithControls } from './ActivityCardWithControls';
import { SingleWeekExecutionView } from './SingleWeekExecutionView';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Get ISO date string for a given week + day. startDate = YYYY-MM-DD. */
function getDateForWeekDay(startDate: string | undefined, weekNum: number, dayName: string): string {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const d = new Date();
    d.setDate(d.getDate() + (weekNum - 1) * 7 + DAYS_ORDER.indexOf(dayName));
    return d.toISOString().slice(0, 10);
  }
  const base = new Date(startDate + 'T00:00:00');
  const dayOffset = DAYS_ORDER.indexOf(dayName);
  if (dayOffset < 0) return startDate;
  const target = new Date(base);
  target.setDate(base.getDate() + (weekNum - 1) * 7 + dayOffset);
  return target.toISOString().slice(0, 10);
}

/** Format date for display (e.g. "Mar 15") */
function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(5) ?? iso;
  }
}

/** Day of month from ISO (e.g. "2025-03-13" → 13) for day cell display */
function getDayOfMonth(iso: string): number {
  try {
    return new Date(iso + 'T00:00:00').getDate();
  } catch {
    return 0;
  }
}

export type CanvasViewMode = 'campaign' | 'month' | 'week';

const CREATOR_CONTENT_TYPES = new Set(['video', 'carousel', 'story', 'reel', 'image', 'short']);
type CampaignType = 'TEXT' | 'CREATOR' | 'HYBRID';

export type CreatorBadgeKind = 'AI' | 'CREATOR' | 'CREATOR_REQUIRED' | 'CREATOR_READY';

function getExecutionModeBadge(
  activity: { content_type?: string; creator_asset?: unknown; content_status?: string },
  campaignType: CampaignType
): CreatorBadgeKind {
  if (campaignType === 'TEXT') return 'AI';
  const ct = String(activity?.content_type ?? '').toLowerCase().trim();
  const isCreatorType = campaignType === 'CREATOR' || CREATOR_CONTENT_TYPES.has(ct);
  if (!isCreatorType) return 'AI';
  const hasAsset = Boolean(
    activity?.creator_asset &&
    typeof activity.creator_asset === 'object' &&
    ((activity.creator_asset as any)?.url || (Array.isArray((activity.creator_asset as any)?.files) && (activity.creator_asset as any).files?.length > 0))
  );
  const isReady = activity?.content_status === 'READY_FOR_PROMOTION' || hasAsset;
  return isReady ? 'CREATOR_READY' : 'CREATOR_REQUIRED';
}

function formatBadgeLabel(kind: CreatorBadgeKind): string {
  return kind.replace(/_/g, ' ');
}

interface PhaseCardProps {
  phase: CampaignStructurePhase;
  index: number;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updates: Partial<CampaignStructurePhase>) => void;
}

function PhaseCard({ phase, index, isEditing, onEdit, onCancelEdit, onSave }: PhaseCardProps) {
  const [label, setLabel] = useState(phase.label ?? '');
  const [objective, setObjective] = useState(phase.objective ?? '');
  const [contentFocus, setContentFocus] = useState(phase.content_focus ?? '');
  const [ctaFocus, setCtaFocus] = useState(phase.cta_focus ?? '');

  useEffect(() => {
    if (isEditing) {
      setLabel(phase.label ?? '');
      setObjective(phase.objective ?? '');
      setContentFocus(phase.content_focus ?? '');
      setCtaFocus(phase.cta_focus ?? '');
    }
  }, [isEditing, phase.label, phase.objective, phase.content_focus, phase.cta_focus]);

  const handleSave = () => {
    onSave({ label: label.trim() || undefined, objective: objective.trim() || undefined, content_focus: contentFocus.trim() || undefined, cta_focus: ctaFocus.trim() || undefined });
  };

  if (isEditing) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-indigo-700">Edit Phase {index + 1}</span>
          <button type="button" onClick={onCancelEdit} className="p-1 rounded hover:bg-indigo-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Awareness"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Objective</label>
          <input
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. Build brand awareness"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Content Focus</label>
          <input
            type="text"
            value={contentFocus}
            onChange={(e) => setContentFocus(e.target.value)}
            placeholder="e.g. Education, thought leadership"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">CTA Focus</label>
          <input
            type="text"
            value={ctaFocus}
            onChange={(e) => setCtaFocus(e.target.value)}
            placeholder="e.g. Sign up, download guide"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Save Phase
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900">{phase.label ?? `Phase ${index + 1}`}</div>
          <div className="text-sm text-gray-600 mt-1">
            Weeks {phase.week_start}–{phase.week_end}
          </div>
          {phase.objective && (
            <div className="text-sm text-gray-700 mt-2">{phase.objective}</div>
          )}
          {(phase.content_focus || phase.cta_focus) && (
            <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
              {phase.content_focus && <span>Content: {phase.content_focus}</span>}
              {phase.cta_focus && <span>CTA: {phase.cta_focus}</span>}
            </div>
          )}
          {phase.narrative_hint && !phase.objective && (
            <div className="text-xs text-gray-500 mt-1">{phase.narrative_hint}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="p-2 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit phase"
        >
          <Pencil className="h-4 w-4 text-gray-500" />
        </button>
      </div>
    </div>
  );
}

interface WeekData {
  week?: number;
  theme?: string;
  phase_label?: string;
}

export interface PlanningCanvasProps {
  campaignId?: string | null;
  companyId?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function PlanningCanvas({ campaignId, companyId, collapsed, onToggleCollapse }: PlanningCanvasProps) {
  const { state, setCampaignStructure, setSelectedActivity } = usePlannerSession();
  const strategicThemes = state.strategic_themes ?? [];
  const healthReport = state.health_report as any;
  const lowConfidenceIds = new Set<string>(
    healthReport?.role_distribution?.low_confidence_activities?.map((a: any) => a.id) ?? []
  );
  const [viewMode, setViewMode] = useState<CanvasViewMode>('campaign');
  const [editingPhaseIndex, setEditingPhaseIndex] = useState<number | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set());
  /** Single-week execution: selected week (1-based) and day name */
  const [selectedDay, setSelectedDay] = useState<{ weekNumber: number; dayName: string } | null>(null);

  const campaignType: CampaignType = (state.campaign_type === 'TEXT' || state.campaign_type === 'CREATOR' || state.campaign_type === 'HYBRID')
    ? state.campaign_type
    : 'TEXT';
  const campaignStructure = state.campaign_design?.campaign_structure;
  // Prefer state.calendar_plan (the direct mutable field) so AI-chat edits are immediately visible.
  const calendarPlan = state.calendar_plan ?? state.execution_plan?.calendar_plan;
  const weeks = calendarPlan?.weeks ?? [];
  const activities = calendarPlan?.activities ?? state.execution_plan?.activity_cards ?? [];
  const phases = campaignStructure?.phases ?? [];
  const strategy_context = state.execution_plan?.strategy_context;
  const startDate = (strategy_context?.planned_start_date && /^\d{4}-\d{2}-\d{2}$/.test(strategy_context.planned_start_date))
    ? strategy_context.planned_start_date
    : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

  const openActivityWorkspace = (activity: CalendarPlanActivity) => {
    const workspaceKey = campaignId
      ? `activity-workspace-${campaignId}-${activity.execution_id}`
      : `activity-workspace-planner-preview-${activity.execution_id}`;
    const payload = {
      campaignId: campaignId ?? null,
      weekNumber: activity.week_number,
      day: activity.day ?? 'Monday',
      activityId: activity.execution_id,
      title: activity.title,
      topic: activity.title,
      description: '',
      dailyExecutionItem: {
        topic: activity.title,
        title: activity.title,
        platform: activity.platform,
        content_type: activity.content_type,
      },
      schedules: [],
    };
    try {
      if (typeof window !== 'undefined') {
        if (campaignId) {
          window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        } else {
          window.localStorage.setItem(workspaceKey, JSON.stringify(payload));
        }
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch {
      // ignore
    }
  };

  const updatePhase = (index: number, updates: Partial<CampaignStructurePhase>) => {
    const structure = state.campaign_design?.campaign_structure;
    if (!structure || index < 0 || index >= structure.phases.length) return;
    const phases = [...structure.phases];
    const existing = phases[index];
    const merged = { ...existing, ...updates };
    phases[index] = merged.id ? merged : { ...merged, id: `phase-${index}-legacy` };
    setCampaignStructure({ ...structure, phases });
    setEditingPhaseIndex(null);
  };

  if (collapsed) {
    return (
      <div className="flex-1 flex items-center justify-center border border-dashed border-gray-300 rounded-lg bg-gray-50">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Expand canvas ▶
        </button>
      </div>
    );
  }

  const viewContent = weeks.length === 0 ? (
    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
      <p className="text-sm">No calendar plan yet.</p>
      <p className="text-xs mt-2">
        Use Campaign Parameters or AI Planning Assistant to generate your plan.
      </p>
    </div>
  ) : viewMode === 'campaign' ? (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-800">Campaign Structure (Most Detailed)</h3>
      {campaignStructure?.narrative && (
        <p className="text-sm text-gray-600 mb-3">{campaignStructure.narrative}</p>
      )}
      {(phases.length > 0 ? phases : weeks.slice(0, 12).map((w, i) => ({ id: `w${(w as WeekData)?.week ?? i + 1}`, label: (w as WeekData)?.phase_label ?? (w as WeekData)?.theme ?? `Week ${(w as WeekData)?.week ?? i + 1}`, week_start: (w as WeekData)?.week ?? i + 1, week_end: (w as WeekData)?.week ?? i + 1 }))).map((phaseOrWeek, i) => {
        const phaseId = (phaseOrWeek as CampaignStructurePhase).id ?? `phase-${i}`;
        const isPhase = 'week_start' in phaseOrWeek && 'week_end' in phaseOrWeek;
        const phaseWeeks = weeks.filter((w) => {
          const wn = (w as WeekData)?.week ?? 0;
          return isPhase ? wn >= (phaseOrWeek as CampaignStructurePhase).week_start! && wn <= (phaseOrWeek as CampaignStructurePhase).week_end! : true;
        });
        const isExpanded = expandedPhases.has(phaseId);
        const togglePhase = () => setExpandedPhases((s) => {
          const next = new Set(s);
          if (next.has(phaseId)) next.delete(phaseId);
          else next.add(phaseId);
          return next;
        });
        return (
          <div key={phaseId} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={togglePhase}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="font-medium text-gray-900">{(phaseOrWeek as CampaignStructurePhase).label ?? (phaseOrWeek as { label?: string }).label ?? `Phase ${i + 1}`}</span>
              {isPhase && (
                <span className="text-xs text-gray-500">
                  Weeks {(phaseOrWeek as CampaignStructurePhase).week_start}–{(phaseOrWeek as CampaignStructurePhase).week_end}
                </span>
              )}
              {!phases.length && (
                <span className="text-xs text-gray-500">Week {(phaseOrWeek as { week_start?: number }).week_start}</span>
              )}
            </button>
            {isExpanded && (
              <div className="border-t border-gray-100 pl-6 pr-4 pb-4 space-y-3">
                {phaseWeeks.map((w, wi) => {
                  const week = w as WeekData;
                  const weekNum = (week?.week ?? wi + 1) as number;
                  const label = strategicThemes.find((t) => t.week === weekNum)?.title ?? week?.phase_label ?? week?.theme ?? `Week ${weekNum}`;
                  const isWeekExpanded = expandedWeeks.has(weekNum);
                  const weekActivities = activities.filter((a) => a.week_number === weekNum);
                  const byDay = DAYS_ORDER.map((d) => ({ day: d, acts: weekActivities.filter((a) => (a.day ?? 'Monday') === d) }));
                  const toggleWeek = () => setExpandedWeeks((s) => {
                    const next = new Set(s);
                    if (next.has(weekNum)) next.delete(weekNum);
                    else next.add(weekNum);
                    return next;
                  });
                  return (
                    <div key={weekNum} className="rounded-lg border border-gray-100 bg-gray-50/50">
                      <button
                        type="button"
                        onClick={toggleWeek}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100/80 rounded-lg"
                      >
                        {isWeekExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="text-sm font-medium text-gray-800">Week {weekNum}: {label}</span>
                        <span className="text-xs text-gray-500">({weekActivities.length} activities)</span>
                      </button>
                      {isWeekExpanded && (
                        <div className="pl-6 pr-3 pb-3 space-y-2">
                          {byDay.map(({ day, acts }) =>
                            acts.length > 0 ? (
                              <div key={day}>
                                <div className="text-xs font-medium text-gray-600 py-1">{day}</div>
                                <div className="flex flex-wrap gap-1">
                                  {acts.map((a) => {
                                    const siblings = acts.filter((x) => x !== a && (x.title ?? '') === (a.title ?? ''));
                                    const sharedGroup = siblings.length > 0 ? [a, ...siblings] : [a];
                                    const repurposeIndex = sharedGroup.findIndex((x) => x.execution_id === a.execution_id) + 1;
                                    const repurposeTotal = sharedGroup.length;
                                    const showRepurpose = repurposeTotal > 1;
                                    return (
                                      <ActivityCardWithControls
                                        key={a.execution_id}
                                        activity={a}
                                        variant="compact"
                                        companyId={companyId}
                                        showRepurpose={showRepurpose}
                                        repurposeIndex={repurposeIndex}
                                        repurposeTotal={repurposeTotal}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null
                          )}
                          {weekActivities.length === 0 && (
                            <div className="text-xs text-gray-500 py-1">No daily activities</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  ) : viewMode === 'month' ? (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Month View — Weekly</h3>
      <p className="text-xs text-gray-500">Expand a month to see its weeks.</p>
      <div className="space-y-2">
        {Array.from({ length: Math.max(1, Math.ceil(weeks.length / 4)) }, (_, i) => i + 1).map((m) => {
          const monthWeeks = weeks.slice((m - 1) * 4, m * 4);
          const isExpanded = expandedMonths.has(m);
          const toggleMonth = () => setExpandedMonths((s) => {
            const next = new Set(s);
            if (next.has(m)) next.delete(m);
            else next.add(m);
            return next;
          });
          return (
            <div key={m} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={toggleMonth}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
              >
                {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <span className="font-medium text-gray-900">Month {m}</span>
                <span className="text-xs text-gray-500">({monthWeeks.length} weeks)</span>
              </button>
              {isExpanded && monthWeeks.length > 0 && (
                <div className="border-t border-gray-100 pl-6 pr-4 pb-4 pt-2 space-y-2">
                  {monthWeeks.map((w, wi) => {
                    const week = w as WeekData;
                    const weekNum = (week?.week ?? (m - 1) * 4 + wi + 1) as number;
                    const label = strategicThemes.find((t) => t.week === weekNum)?.title ?? week?.phase_label ?? week?.theme ?? `Week ${weekNum}`;
                    const weekActivities = activities.filter((a) => a.week_number === weekNum);
                    return (
                      <div key={weekNum} className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                        <div className="text-sm font-medium text-gray-800">Week {weekNum}: {label}</div>
                        {weekActivities.length > 0 && (
                          <div className="text-xs text-gray-500 mt-1">{weekActivities.length} activities</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  ) : viewMode === 'week' ? (
    <SingleWeekExecutionView
      weeks={weeks}
      activities={activities}
      strategicThemes={strategicThemes}
      startDate={startDate}
      campaignId={campaignId}
      companyId={companyId}
      selectedWeekNumber={selectedDay?.weekNumber ?? 1}
      selectedDayName={selectedDay?.dayName ?? 'Monday'}
      onWeekSelect={(wn) =>
        setSelectedDay((prev) => (prev ? { ...prev, weekNumber: wn } : { weekNumber: wn, dayName: 'Monday' }))
      }
      onDaySelect={(day) =>
        setSelectedDay((prev) => (prev ? { ...prev, dayName: day } : { weekNumber: 1, dayName: day }))
      }
      onActivityClick={openActivityWorkspace}
    />
  ) : (
    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
      <p className="text-sm">Select a view from the tabs above.</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
        {(['campaign', 'month', 'week'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1.5 rounded text-sm font-medium capitalize ${
              viewMode === mode
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {viewContent}
      </div>
    </div>
  );
}
