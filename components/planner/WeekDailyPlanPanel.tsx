/**
 * Week Daily-Plan Panel  (Strategy → "week → daily" layer)
 *
 * For one selected week, shows that week's FIXED skeleton slots grouped by day
 * (platform / content type / day are owned by the Skeleton and read-only here)
 * and lets the user attach a Topic + Objective onto each slot — the meaning the
 * later content step needs.
 *
 * "Auto-plan Week N" reuses /api/campaigns/ai/plan scoped to this single week
 * (scopeWeeks=[N]); the AI-produced topics are mapped ONTO the existing skeleton
 * slots (we never let the AI change platform/content-type/day).
 */

import { useMemo, useState } from 'react';
import { Loader2, Sparkles, Target, CalendarDays, ExternalLink } from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity } from './plannerSessionStore';
import PlatformIcon from '../ui/PlatformIcon';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { buildPlannerExecutionHandoff, buildPlannerPrefilledPlanning } from '../../lib/plannerExecutionHandoff';
import { classifyContentType } from '../../lib/shared/contentTypeClassification';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function flattenActivities(plan: { activities?: CalendarPlanActivity[]; days?: Array<{ week_number: number; day: string; activities?: CalendarPlanActivity[] }> } | null | undefined): CalendarPlanActivity[] {
  if (!plan) return [];
  if (Array.isArray(plan.activities) && plan.activities.length > 0) return plan.activities;
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    return plan.days.flatMap((d) =>
      (d.activities ?? []).map((a) => ({ ...a, day: a.day ?? d.day, week_number: a.week_number ?? d.week_number }))
    );
  }
  return [];
}

/** A slot has a real topic once its title is set and isn't just the week theme placeholder. */
function slotHasTopic(a: CalendarPlanActivity, themeTitle?: string): boolean {
  const t = (a.title ?? '').trim();
  if (!t) return false;
  if (themeTitle && t.toLowerCase() === themeTitle.trim().toLowerCase()) return false;
  return true;
}

export function WeekDailyPlanPanel({
  companyId,
  campaignId,
  week,
}: {
  companyId?: string | null;
  campaignId?: string | null;
  week: number;
}) {
  const { state, mergePlanActivities } = usePlannerSession();
  const theme = (state.strategic_themes ?? []).find((t) => t.week === week) ?? null;
  const plan = state.calendar_plan ?? state.execution_plan?.calendar_plan;
  const allActivities = useMemo(() => flattenActivities(plan), [plan]);

  const [autoLoading, setAutoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer the persisted campaign id (set by "Create campaign & build content")
  // over the page-level prop, so the workspace resolves the real DB blueprint.
  const effectiveCampaignId =
    (typeof state.source_ids?.campaign_id === 'string' && state.source_ids.campaign_id.trim()
      ? state.source_ids.campaign_id.trim()
      : null) ?? (campaignId && campaignId.trim() ? campaignId.trim() : null);
  const campaignBuilt = Boolean(effectiveCampaignId);

  // Open the REAL, content-type-aware Activity Workspace for one slot via the
  // DB-backed entry (campaignId + executionId) so resolve.ts loads the
  // persisted blueprint → BOLT text formats / text+asset / creator workspace.
  function openActivityWorkspace(a: CalendarPlanActivity) {
    if (!effectiveCampaignId) return;
    const execId = a.execution_id ?? `wk${week}-${a.day}-${a.platform}-${a.content_type}`;
    if (typeof window !== 'undefined') {
      window.open(
        `/activity-workspace?campaignId=${encodeURIComponent(effectiveCampaignId)}&executionId=${encodeURIComponent(execId)}`,
        '_blank'
      );
    }
  }

  const weekActivities = allActivities.filter((a) => (Number(a.week_number) || 1) === week);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPlanActivity[]>();
    for (const a of weekActivities) {
      const day = a.day ?? 'Monday';
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(a);
    }
    return Array.from(map.entries()).sort(
      (a, b) => DAY_ORDER.indexOf(a[0]) - DAY_ORDER.indexOf(b[0])
    );
  }, [weekActivities]);

  const plannedCount = weekActivities.filter((a) => slotHasTopic(a, theme?.title)).length;
  const totalSlots = weekActivities.length;
  const fullyPlanned = totalSlots > 0 && plannedCount === totalSlots;

  // Commit a single-field edit. Activity objects are referentially stable within
  // this render (flatten returns the stored array when present), so we patch by
  // identity and re-merge the full activity list.
  function commit(target: CalendarPlanActivity, patch: Partial<CalendarPlanActivity>) {
    const next = allActivities.map((a) => (a === target ? { ...a, ...patch } : a));
    mergePlanActivities(next);
  }

  async function handleAutoPlan() {
    if (!companyId) { setError('Select a company first.'); return; }
    if (totalSlots === 0) { setError('This week has no skeleton slots to plan.'); return; }
    setAutoLoading(true);
    setError(null);
    try {
      const spine = state.idea_spine ?? undefined;
      const strat = state.strategy_context ?? null;
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
        calendar_plan: plan ?? null,
      });
      const themeLine = theme
        ? `Week ${week} theme: "${theme.title}". ${theme.objective ?? ''} ${theme.content_focus ?? ''}`.trim()
        : `Plan week ${week}.`;
      const body: Record<string, unknown> = {
        preview_mode: true,
        mode: 'generate_plan',
        message: `Fill in concrete per-day topics and objectives ONLY for week ${week}, keeping every existing platform, content type and day exactly as-is. ${themeLine}`,
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
        scopeWeeks: [week],
        currentPlan: { weeks: (plan?.weeks as unknown[]) ?? [] },
      };
      if (state.platform_content_requests && Object.keys(state.platform_content_requests).length > 0) {
        body.platform_content_requests = state.platform_content_requests;
      }
      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Auto-plan failed');

      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { calendar_plan: generated } = weeksToCalendarPlan(weeks);
      const genWeekActs = flattenActivities(generated).filter((a) => (Number(a.week_number) || 1) === week);
      // Ordered pool of AI topics/objectives for this week.
      const pool = genWeekActs
        .map((a) => ({ title: (a.title ?? a.theme ?? '').trim(), objective: (a.objective ?? '').trim() }))
        .filter((p) => p.title);
      if (pool.length === 0) throw new Error('AI returned no topics for this week. Try refining the theme.');

      // Map topics ONTO the fixed skeleton slots (preserve platform/content_type/day).
      let i = 0;
      const next = allActivities.map((a) => {
        if ((Number(a.week_number) || 1) !== week) return a;
        const pick = pool[i % pool.length];
        i += 1;
        return {
          ...a,
          title: pick.title,
          objective: pick.objective || a.objective,
          theme: theme?.title ?? a.theme,
        };
      });
      mergePlanActivities(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not auto-plan this week');
    } finally {
      setAutoLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Week header + theme summary */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-indigo-600" />
            Week {week} — Daily Plan
          </h3>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              fullyPlanned
                ? 'bg-emerald-100 text-emerald-700'
                : plannedCount > 0
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {totalSlots === 0 ? 'No slots' : `${plannedCount}/${totalSlots} planned`}
          </span>
        </div>
        {theme && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-gray-800">{theme.title}</p>
            {theme.objective && (
              <p className="text-[11px] text-gray-500 flex items-start gap-1">
                <Target className="h-3 w-3 mt-0.5 flex-shrink-0 text-gray-400" />
                {theme.objective}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={handleAutoPlan}
          disabled={autoLoading || totalSlots === 0}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {autoLoading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Auto-planning week {week}…</>
            : <><Sparkles className="h-3.5 w-3.5" />Auto-plan Week {week}</>}
        </button>
        {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      </div>

      {/* Day-by-day slots */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {totalSlots === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <CalendarDays className="h-8 w-8 text-gray-200 mb-3" />
            <p className="text-xs text-gray-400 leading-relaxed">
              No skeleton slots for Week {week}. Add cadence for this week in the Skeleton step first.
            </p>
          </div>
        ) : (
          byDay.map(([day, acts]) => (
            <div key={day} className="rounded-lg border border-gray-200">
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                {day}
              </div>
              <div className="divide-y divide-gray-100">
                {acts.map((a, idx) => {
                  // Activities sharing the same title on a day are ONE piece of
                  // content repurposed across platforms — show which variant
                  // this is (1/3, 2/3, 3/3) using that group, in visual order.
                  const titleKey = (a.title ?? '').trim();
                  const shareGroup = titleKey
                    ? acts.filter((x) => (x.title ?? '').trim() === titleKey)
                    : [a];
                  const shareTotal = shareGroup.length;
                  const shareIndex =
                    shareGroup.findIndex((x) =>
                      x.execution_id != null
                        ? x.execution_id === a.execution_id
                        : x === a
                    ) + 1;
                  return (
                  <div key={a.execution_id ?? `${day}-${idx}`} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlatformIcon platform={a.platform ?? 'linkedin'} size={13} showLabel />
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">
                          {a.content_type ?? 'post'}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                            shareTotal > 1
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                          title={
                            shareTotal > 1
                              ? `Shared content — variant ${shareIndex} of ${shareTotal} across platforms`
                              : 'Unique content'
                          }
                        >
                          {shareTotal > 1 ? `${shareIndex}/${shareTotal}` : 'Unique'}
                        </span>
                        {(() => {
                          const cls = classifyContentType(a.content_type);
                          const tone =
                            cls.mode === 'video_brief'
                              ? 'bg-amber-50 text-amber-700'
                              : cls.mode === 'unsupported'
                                ? 'bg-gray-100 text-gray-400'
                                : 'bg-emerald-50 text-emerald-700';
                          return (
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${tone}`}
                              title={
                                cls.isVideoBrief
                                  ? 'Video — Omnivyra gives you the full theme + marketing brief; you produce & upload'
                                  : cls.builtInOmnivyra
                                    ? 'Built in Omnivyra (generated for you)'
                                    : 'Not a supported buildable content type'
                              }
                            >
                              {cls.isVideoBrief ? 'Video · Brief' : cls.label}
                            </span>
                          );
                        })()}
                      </div>
                      <button
                        type="button"
                        onClick={() => openActivityWorkspace(a)}
                        disabled={!campaignBuilt}
                        title={
                          campaignBuilt
                            ? 'Open the full Activity Workspace for this post (text → BOLT brief; creator/video → Creator workspace)'
                            : 'Click "Create campaign & build content" first to enable the full workspace'
                        }
                        className={`flex items-center gap-1 flex-shrink-0 text-[10px] font-semibold ${
                          campaignBuilt
                            ? 'text-indigo-600 hover:text-indigo-800'
                            : 'text-gray-300 cursor-not-allowed'
                        }`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Activity Workspace
                      </button>
                    </div>
                    <input
                      type="text"
                      value={a.title ?? ''}
                      onChange={(e) => commit(a, { title: e.target.value })}
                      placeholder="Topic / angle for this post…"
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg"
                    />
                    <textarea
                      value={a.objective ?? ''}
                      onChange={(e) => commit(a, { objective: e.target.value })}
                      placeholder="Objective (what this post should achieve)…"
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg resize-none"
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
