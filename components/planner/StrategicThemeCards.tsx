/**
 * Strategic Theme Cards
 * Right-column panel — Cards tab and Themes tab.
 *
 * Cards tab — two-step flow:
 *  Step 1: Select intelligence source → Generate Cards → cards appear (one per week)
 *          Click card = select for AI Chat. Double-click = deselect.
 *          Floating "Create Weekly Plan" button converts themes to activities.
 *  Step 2: Week plan view — Week 1 / Week 2 / … tab row at top.
 *          Click a week tab → shows that week's activity list.
 *          Click any activity → Activity Workspace with content.
 *
 * Themes tab: flat content-first list.
 */

import { useRef, useState } from 'react';
import {
  Palette, Calendar, LayoutList, CreditCard, ArrowRight, MessageSquare,
  Loader2, Sparkles, ArrowLeft, CheckCircle2, FileText, Zap, ChevronRight,
} from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity } from './plannerSessionStore';
import PlatformIcon from '../ui/PlatformIcon';
import ActivityWorkspaceDrawer, { type ContentGroup } from './ActivityWorkspaceDrawer';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { weeksToCalendarPlan } from './calendarPlanConverter';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_COLORS = [
  { border: 'border-indigo-200', bg: 'from-indigo-50 to-purple-50',  badge: 'bg-indigo-100 text-indigo-700',  accent: 'bg-indigo-500',  ring: 'ring-indigo-500',  tab: 'bg-indigo-600 text-white',  tabIdle: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
  { border: 'border-violet-200', bg: 'from-violet-50 to-pink-50',    badge: 'bg-violet-100 text-violet-700',  accent: 'bg-violet-500',  ring: 'ring-violet-500',  tab: 'bg-violet-600 text-white',  tabIdle: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
  { border: 'border-sky-200',    bg: 'from-sky-50 to-cyan-50',       badge: 'bg-sky-100 text-sky-700',        accent: 'bg-sky-500',     ring: 'ring-sky-500',     tab: 'bg-sky-600 text-white',     tabIdle: 'bg-sky-50 text-sky-700 hover:bg-sky-100' },
  { border: 'border-emerald-200',bg: 'from-emerald-50 to-teal-50',   badge: 'bg-emerald-100 text-emerald-700',accent: 'bg-emerald-500', ring: 'ring-emerald-500', tab: 'bg-emerald-600 text-white', tabIdle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  { border: 'border-amber-200',  bg: 'from-amber-50 to-yellow-50',   badge: 'bg-amber-100 text-amber-700',   accent: 'bg-amber-500',   ring: 'ring-amber-500',   tab: 'bg-amber-600 text-white',   tabIdle: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
  { border: 'border-rose-200',   bg: 'from-rose-50 to-orange-50',    badge: 'bg-rose-100 text-rose-700',     accent: 'bg-rose-500',    ring: 'ring-rose-500',    tab: 'bg-rose-600 text-white',    tabIdle: 'bg-rose-50 text-rose-700 hover:bg-rose-100' },
];

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const INTELLIGENCE_SOURCES = [
  { value: 'hybrid' as const, label: 'Hybrid Intelligence',  desc: 'Trend signals + AI reasoning',      icon: Zap,       themeSource: 'both'  as const },
  { value: 'api'    as const, label: 'API Intelligence',     desc: 'Platform signals & market data',    icon: Sparkles,  themeSource: 'trend' as const },
  { value: 'ai'     as const, label: 'AI Strategic Engine',  desc: 'Pure AI strategic planning',        icon: FileText,  themeSource: 'ai'    as const },
] as const;

type IntelligenceSource = typeof INTELLIGENCE_SOURCES[number]['value'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function activityKey(week: number, day: string, title: string): string {
  return `${week}:${day}:${title}`.toLowerCase().replace(/\s+/g, '_');
}

function groupActivitiesForWeek(
  activities: CalendarPlanActivity[],
  companyId?: string | null
): Array<{ day: string; groups: ContentGroup[] }> {
  const byDay = new Map<string, CalendarPlanActivity[]>();
  for (const act of activities) {
    const day = act.day ?? 'Monday';
    const existing = byDay.get(day) ?? [];
    existing.push(act);
    byDay.set(day, existing);
  }
  const sortedDays = Array.from(byDay.keys()).sort(
    (a, b) => (DAY_ORDER.indexOf(a) ?? 99) - (DAY_ORDER.indexOf(b) ?? 99)
  );
  return sortedDays.map((day) => {
    const dayActivities = byDay.get(day) ?? [];
    const groupMap = new Map<string, CalendarPlanActivity[]>();
    for (const act of dayActivities) {
      const key =
        (act.title ?? act.theme ?? act.execution_id ?? '').trim().toLowerCase() ||
        (act.execution_id ?? String(Math.random()));
      const existing = groupMap.get(key) ?? [];
      existing.push(act);
      groupMap.set(key, existing);
    }
    const groups: ContentGroup[] = Array.from(groupMap.values()).map((acts) => {
      const first = acts[0];
      const platforms = [...new Set(acts.map((a) => a.platform ?? 'linkedin').filter(Boolean))];
      const contentTypes: Record<string, string> = {};
      for (const a of acts) {
        if (a.platform) contentTypes[a.platform] = a.content_type ?? 'post';
      }
      return {
        title: first.title ?? first.theme ?? 'Untitled',
        day,
        week: first.week_number ?? 0,
        platforms,
        contentTypes,
        theme: first.theme,
        objective: first.objective,
        companyId,
      };
    });
    return { day, groups };
  });
}

/** 1 filled dot + (count-1) empty dots */
function SharingDots({ count }: { count: number }) {
  const dots = Math.min(count, 5);
  return (
    <span className="flex items-center gap-0.5" title={count === 1 ? 'Unique' : `Shared × ${count}`}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className={`inline-block rounded-full ${i === 0 ? 'w-2 h-2 bg-indigo-500' : 'w-2 h-2 border border-indigo-300 bg-white'}`} />
      ))}
    </span>
  );
}

// ─── Step 1: Cards view ───────────────────────────────────────────────────────

function CardsView({
  companyId,
  selectedWeek,
  onSelectWeek,
  onEnterPlanView,
}: {
  companyId?: string | null;
  selectedWeek?: number | null;
  onSelectWeek?: (week: number | null) => void;
  onEnterPlanView: () => void;
}) {
  const { state, setStrategicThemes, setCampaignStructure, setCalendarPlan } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const [intelligenceSource, setIntelligenceSource] = useState<IntelligenceSource>('hybrid');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [convertingToPlan, setConvertingToPlan] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const lastClickRef = useRef<{ week: number; time: number } | null>(null);

  const sourceConfig = INTELLIGENCE_SOURCES.find((s) => s.value === intelligenceSource) ?? INTELLIGENCE_SOURCES[0];

  // Single click → select for AI Chat; double-click on same selected card → deselect
  function handleCardClick(week: number) {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.week === week && now - last.time < 400 && selectedWeek === week) {
      onSelectWeek?.(null);
      lastClickRef.current = null;
    } else {
      onSelectWeek?.(week);
      lastClickRef.current = { week, time: now };
    }
  }

  async function handleGenerate() {
    if (!companyId) { setGenerateError('Select a company first.'); return; }
    setGenerating(true);
    setGenerateError(null);
    try {
      const strat = state.strategy_context;
      const body: Record<string, unknown> = {
        companyId,
        theme_source: sourceConfig.themeSource,
        duration_weeks: strat?.duration_weeks ?? 6,
        strategy_context: { duration_weeks: strat?.duration_weeks ?? 6 },
        idea_spine: state.idea_spine,
        trend_context: state.trend_context,
      };
      const res = await fetchWithAuth('/api/planner/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Generation failed');
      const raw: Array<{ week: number; title: string }> = Array.isArray(data.themes) ? data.themes : [];
      setStrategicThemes(raw.filter((t) => typeof t.week === 'number' && typeof t.title === 'string'));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate themes');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateWeeklyPlan() {
    if (!companyId) { setConvertError('Select a company first.'); return; }
    setConvertingToPlan(true);
    setConvertError(null);
    try {
      const strat = state.strategy_context;
      const spine = state.idea_spine;
      const pcr = state.platform_content_requests;

      const body: Record<string, unknown> = {
        preview_mode: true,
        mode: 'generate_plan',
        message: [spine?.refined_title ?? spine?.title, spine?.refined_description ?? spine?.description]
          .filter(Boolean).join('\n\n') || 'Generate campaign plan based on strategic themes.',
        companyId,
        idea_spine: spine,
        strategy_context: strat ? {
          ...strat,
          target_audience: Array.isArray(strat.target_audience)
            ? strat.target_audience.filter(Boolean).join(', ')
            : (strat.target_audience ?? ''),
        } : { duration_weeks: themes.length || 6 },
        campaign_direction: spine?.selected_angle ?? 'EDUCATION',
        company_context_mode: 'full_company_context',
        campaign_type: state.campaign_type ?? 'TEXT',
        account_context: state.account_context,
        prefilledPlanning: { strategic_themes: themes.map((t) => t.title) },
      };
      if (pcr && Object.keys(pcr).length > 0) body.platform_content_requests = pcr;

      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Plan generation failed');

      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
      onEnterPlanView();
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Could not create weekly plan');
    } finally {
      setConvertingToPlan(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Intelligence source + generate */}
      <div className="flex-shrink-0 p-3 border-b border-gray-100 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
            Intelligence Source
          </span>
          <select
            value={intelligenceSource}
            onChange={(e) => setIntelligenceSource(e.target.value as IntelligenceSource)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            {INTELLIGENCE_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label} — {s.desc}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {generating
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
            : <><sourceConfig.icon className="h-3.5 w-3.5" />{themes.length > 0 ? 'Regenerate Cards' : 'Generate Cards'}</>}
        </button>
        {generateError && <p className="text-[11px] text-red-600">{generateError}</p>}
      </div>

      {/* Theme cards — scrollable, padded bottom for FAB */}
      <div className="flex-1 overflow-y-auto p-3 pb-20 space-y-2">
        {themes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Palette className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-xs text-gray-400 leading-relaxed">
              Select an intelligence source and click <strong>Generate Cards</strong>.
            </p>
          </div>
        ) : (
          themes.map((theme, i) => {
            const color = WEEK_COLORS[i % WEEK_COLORS.length];
            const isSelected = selectedWeek === theme.week;

            return (
              <div
                key={theme.week}
                onClick={() => handleCardClick(theme.week)}
                className={`rounded-xl cursor-pointer transition-all select-none ${
                  isSelected
                    ? `ring-2 ${color.ring} border-2 border-transparent shadow-md`
                    : `border-2 ${color.border} hover:shadow-sm`
                }`}
              >
                {/* Card body */}
                <div className={`p-4 bg-gradient-to-br ${color.bg} rounded-[10px]`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Week badge */}
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${color.badge}`}>
                          Week {theme.week}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                            <MessageSquare className="h-2.5 w-2.5" />
                            AI Chat active
                          </span>
                        )}
                      </div>
                      {/* Theme title */}
                      <p className="text-sm font-semibold text-gray-900 leading-snug">
                        {theme.title || <span className="text-gray-400 italic font-normal">No theme set</span>}
                      </p>
                    </div>
                    {/* Color accent dot */}
                    <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1 ${color.accent}`} />
                  </div>
                  {isSelected && (
                    <p className="mt-2 text-[10px] text-gray-500">
                      Click AI Chat tab on the left to edit · double-click to deselect
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating "Create Weekly Plan" button */}
      {themes.length > 0 && (
        <div className="absolute bottom-3 left-0 right-0 px-3 flex flex-col items-center gap-1.5 pointer-events-none">
          {convertError && (
            <p className="text-[11px] text-red-600 bg-white px-3 py-1 rounded-lg shadow border border-red-100 pointer-events-auto">
              {convertError}
            </p>
          )}
          <button
            type="button"
            onClick={handleCreateWeeklyPlan}
            disabled={convertingToPlan}
            className="pointer-events-auto w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-xl hover:bg-indigo-700 disabled:opacity-60 transition-all"
          >
            {convertingToPlan
              ? <><Loader2 className="h-4 w-4 animate-spin" />Building Weekly Plan…</>
              : <><Zap className="h-4 w-4" />Create Weekly Plan<ChevronRight className="h-4 w-4 ml-auto" /></>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Weekly Plan view ─────────────────────────────────────────────────

function WeeklyPlanView({
  companyId,
  selectedWeek,
  onSelectWeek,
  onBack,
}: {
  companyId?: string | null;
  selectedWeek?: number | null;
  onSelectWeek?: (week: number | null) => void;
  onBack: () => void;
}) {
  const { state } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const plan = state.calendar_plan ?? state.execution_plan?.calendar_plan;

  const [activeWeekTab, setActiveWeekTab] = useState<number>(themes[0]?.week ?? 1);
  const [contentMap, setContentMap] = useState<Record<string, Record<string, string>>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [activeWorkspace, setActiveWorkspace] = useState<{ group: ContentGroup; variants?: Record<string, string> } | null>(null);
  const lastClickRef = useRef<{ key: string; time: number } | null>(null);

  function getActivitiesForWeek(week: number): CalendarPlanActivity[] {
    if (!plan) return [];
    if (Array.isArray(plan.activities) && plan.activities.length > 0)
      return (plan.activities as CalendarPlanActivity[]).filter((a) => a.week_number === week);
    if (Array.isArray(plan.days) && plan.days.length > 0)
      return plan.days
        .filter((d) => d.week_number === week)
        .flatMap((d) => (d.activities ?? []).map((a) => ({ ...a, day: a.day ?? d.day, week_number: week })));
    return [];
  }

  // Single click → select for AI Chat; double-click → open workspace
  function handleActivityClick(group: ContentGroup) {
    const key = activityKey(group.week, group.day, group.title);
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.key === key && now - last.time < 400) {
      setActiveWorkspace({ group, variants: contentMap[key] });
      lastClickRef.current = null;
    } else {
      onSelectWeek?.(group.week);
      lastClickRef.current = { key, time: now };
    }
  }

  async function handleLoadContent(group: ContentGroup) {
    if (!companyId) return;
    const key = activityKey(group.week, group.day, group.title);
    setLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetchWithAuth('/api/planner/generate-workspace-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId, topic: group.title, platforms: group.platforms,
          contentTypes: group.contentTypes, theme: group.theme,
          objective: group.objective, week: group.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.variants) {
        setContentMap((prev) => ({ ...prev, [key]: data.variants }));
      }
    } finally {
      setLoadingKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  const activeTheme = themes.find((t) => t.week === activeWeekTab);
  const activeColor = WEEK_COLORS[(themes.findIndex((t) => t.week === activeWeekTab)) % WEEK_COLORS.length];
  const activities = getActivitiesForWeek(activeWeekTab);
  const dayGroups = groupActivitiesForWeek(activities, companyId);

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top bar */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Cards
          </button>
          <span className="text-gray-300">·</span>
          <span className="text-xs font-semibold text-gray-700">Weekly Plan</span>
          <span className="ml-auto text-[10px] text-gray-400 italic">click = select · double-click = open workspace</span>
        </div>

        {/* Week tabs — scrollable horizontal row */}
        <div className="flex-shrink-0 flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-100 bg-white">
          {themes.map((theme, i) => {
            const color = WEEK_COLORS[i % WEEK_COLORS.length];
            const isActive = activeWeekTab === theme.week;
            return (
              <button
                key={theme.week}
                type="button"
                onClick={() => setActiveWeekTab(theme.week)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isActive ? color.tab : color.tabIdle
                }`}
              >
                <span>Wk {theme.week}</span>
              </button>
            );
          })}
        </div>

        {/* Active week header */}
        {activeTheme && (
          <div className={`flex-shrink-0 px-4 py-3 bg-gradient-to-r ${activeColor.bg} border-b border-gray-100`}>
            <p className="text-xs font-semibold text-gray-800">{activeTheme.title}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {activities.length} activit{activities.length !== 1 ? 'ies' : 'y'} across {dayGroups.length} day{dayGroups.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {/* Activities — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {!plan || activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Calendar className="h-8 w-8 text-gray-200 mb-3" />
              <p className="text-xs text-gray-400">No activities for Week {activeWeekTab}.</p>
            </div>
          ) : (
            dayGroups.map(({ day, groups }) => (
              <div key={day}>
                {/* Day header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 sticky top-0">
                  <Calendar className="h-3 w-3 text-gray-400" />
                  <span className="text-[11px] font-semibold text-gray-600">{day}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{groups.length} piece{groups.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Activity cards */}
                {groups.map((group) => {
                  const key = activityKey(group.week, group.day, group.title);
                  const hasContent = Boolean(contentMap[key]);
                  const isLoading = loadingKeys.has(key);

                  return (
                    <div
                      key={key}
                      onClick={() => handleActivityClick(group)}
                      className="px-3 py-3 border-b border-gray-100 cursor-pointer hover:bg-indigo-50/40 transition-colors group"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 mt-1.5"><SharingDots count={group.platforms.length} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 leading-snug group-hover:text-indigo-700">{group.title}</p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {group.platforms.map((p) => (
                              <span key={p} className="flex items-center gap-1">
                                <PlatformIcon platform={p} size={12} />
                                <span className="text-[10px] text-gray-400 capitalize">{group.contentTypes[p] ?? 'post'}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                          {hasContent ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setActiveWorkspace({ group, variants: contentMap[key] }); }}
                              className="flex items-center gap-1 text-[10px] text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Open
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleLoadContent(group); }}
                              disabled={isLoading}
                              className="flex items-center gap-1 text-[10px] text-indigo-600 font-medium border border-indigo-200 rounded px-2 py-0.5 hover:bg-indigo-50 disabled:opacity-50"
                            >
                              {isLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                              {isLoading ? 'Loading…' : 'Load Content'}
                            </button>
                          )}
                          <ArrowRight className="h-3 w-3 text-gray-300 group-hover:text-indigo-400" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {activeWorkspace && (
        <ActivityWorkspaceDrawer
          group={activeWorkspace.group}
          initialVariants={activeWorkspace.variants}
          onClose={() => setActiveWorkspace(null)}
        />
      )}
    </>
  );
}

// ─── Themes Tab ───────────────────────────────────────────────────────────────

function ThemesTab({ companyId, onOpenWorkspace }: { companyId?: string | null; onOpenWorkspace: (g: ContentGroup) => void }) {
  const { state } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const plan = state.calendar_plan ?? state.execution_plan?.calendar_plan;
  const hasSkeleton = Boolean(plan?.activities?.length || plan?.days?.length);

  function getAllGroupsForWeek(week: number): ContentGroup[] {
    if (!plan) return [];
    let acts: CalendarPlanActivity[] = [];
    if (Array.isArray(plan.activities) && plan.activities.length > 0)
      acts = (plan.activities as CalendarPlanActivity[]).filter((a) => a.week_number === week);
    else if (Array.isArray(plan.days) && plan.days.length > 0)
      acts = plan.days
        .filter((d) => d.week_number === week)
        .flatMap((d) => (d.activities ?? []).map((a) => ({ ...a, day: a.day ?? d.day, week_number: week })));
    return groupActivitiesForWeek(acts, companyId).flatMap((dg) => dg.groups);
  }

  if (themes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-4">
        <LayoutList className="h-8 w-8 text-gray-200 mb-3" />
        <p className="text-xs text-gray-400 leading-relaxed">Generate themes from the Cards tab first.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {themes.map((theme, i) => {
        const color = WEEK_COLORS[i % WEEK_COLORS.length];
        const groups = hasSkeleton ? getAllGroupsForWeek(theme.week) : [];
        return (
          <div key={theme.week}>
            <div className={`px-3 py-2.5 bg-gradient-to-r ${color.bg} flex items-center gap-2`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.accent}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${color.badge.split(' ')[1]}`}>Wk {theme.week}</span>
              <span className="text-xs font-medium text-gray-800 truncate flex-1">{theme.title}</span>
              {groups.length > 0 && <span className="text-[10px] text-gray-400 flex-shrink-0">{groups.length}p</span>}
            </div>
            {!hasSkeleton ? (
              <div className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] text-gray-400 bg-white">
                <Calendar className="h-3 w-3" />Create a weekly plan first.
              </div>
            ) : groups.length === 0 ? (
              <div className="px-4 py-2.5 text-[11px] text-gray-400">No content for Week {theme.week}.</div>
            ) : (
              <div className="bg-white">
                {groups.map((group, gi) => (
                  <button key={gi} type="button" onClick={() => onOpenWorkspace(group)}
                    className="w-full text-left px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-indigo-50/50 transition-colors group">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 mt-1"><SharingDots count={group.platforms.length} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 truncate group-hover:text-indigo-700">{group.title}</p>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {group.platforms.map((p) => <PlatformIcon key={p} platform={p} size={11} />)}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 text-gray-300 group-hover:text-indigo-400 self-center flex-shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function StrategicThemeCards({
  companyId,
  selectedWeek,
  onSelectWeek,
}: {
  companyId?: string | null;
  selectedWeek?: number | null;
  onSelectWeek?: (week: number | null) => void;
}) {
  const { state } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const [innerTab, setInnerTab] = useState<'cards' | 'themes'>('cards');
  const [viewMode, setViewMode] = useState<'cards' | 'plan'>('cards');
  const [activeWorkspace, setActiveWorkspace] = useState<ContentGroup | null>(null);

  return (
    <>
      <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Palette className="h-4 w-4 text-indigo-600" />
            Strategic Themes
          </h3>
          {themes.length > 0 && (
            <span className="text-xs text-gray-400">{themes.length} week{themes.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Sub-tabs (only in cards step, not plan view) */}
        {viewMode === 'cards' && (
          <div className="flex-shrink-0 flex border-b border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={() => setInnerTab('cards')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors ${
                innerTab === 'cards'
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />Cards
            </button>
            <button
              type="button"
              onClick={() => setInnerTab('themes')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors ${
                innerTab === 'themes'
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" />Themes
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {viewMode === 'plan' ? (
            <WeeklyPlanView
              companyId={companyId}
              selectedWeek={selectedWeek}
              onSelectWeek={onSelectWeek}
              onBack={() => setViewMode('cards')}
            />
          ) : innerTab === 'cards' ? (
            <CardsView
              companyId={companyId}
              selectedWeek={selectedWeek}
              onSelectWeek={onSelectWeek}
              onEnterPlanView={() => setViewMode('plan')}
            />
          ) : (
            <div className="overflow-y-auto h-full">
              <ThemesTab companyId={companyId} onOpenWorkspace={(g) => setActiveWorkspace(g)} />
            </div>
          )}
        </div>
      </div>

      {activeWorkspace && (
        <ActivityWorkspaceDrawer
          group={activeWorkspace}
          onClose={() => setActiveWorkspace(null)}
        />
      )}
    </>
  );
}
