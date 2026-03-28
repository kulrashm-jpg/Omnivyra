/**
 * Strategic Theme Cards
 * Right-column panel for campaign strategy generation and weekly-theme review.
 */

import { useRef, useState } from 'react';
import {
  Palette, Calendar, LayoutList, CreditCard, ArrowRight, MessageSquare,
  Loader2, Sparkles, CheckCircle2, FileText, Zap,
  Target, BookOpen, MousePointerClick,
} from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity } from './plannerSessionStore';
import PlatformIcon from '../ui/PlatformIcon';
import ActivityWorkspaceDrawer, { type ContentGroup } from './ActivityWorkspaceDrawer';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import type { PlannerStrategicCard } from '../../lib/plannerStrategicCard';

const WEEK_COLORS = [
  { border: 'border-indigo-200', bg: 'from-indigo-50 to-purple-50', badge: 'bg-indigo-100 text-indigo-700', accent: 'bg-indigo-500', ring: 'ring-indigo-500' },
  { border: 'border-violet-200', bg: 'from-violet-50 to-pink-50', badge: 'bg-violet-100 text-violet-700', accent: 'bg-violet-500', ring: 'ring-violet-500' },
  { border: 'border-sky-200', bg: 'from-sky-50 to-cyan-50', badge: 'bg-sky-100 text-sky-700', accent: 'bg-sky-500', ring: 'ring-sky-500' },
  { border: 'border-emerald-200', bg: 'from-emerald-50 to-teal-50', badge: 'bg-emerald-100 text-emerald-700', accent: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { border: 'border-amber-200', bg: 'from-amber-50 to-yellow-50', badge: 'bg-amber-100 text-amber-700', accent: 'bg-amber-500', ring: 'ring-amber-500' },
  { border: 'border-rose-200', bg: 'from-rose-50 to-orange-50', badge: 'bg-rose-100 text-rose-700', accent: 'bg-rose-500', ring: 'ring-rose-500' },
];

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const INTELLIGENCE_SOURCES = [
  { value: 'hybrid' as const, label: 'Hybrid Intelligence', desc: 'Trend signals + AI reasoning', icon: Zap, themeSource: 'both' as const },
  { value: 'api' as const, label: 'API Intelligence', desc: 'Platform signals & market data', icon: Sparkles, themeSource: 'trend' as const },
  { value: 'blog' as const, label: 'Blog Intelligence', desc: 'Existing blogs + AI synthesis', icon: BookOpen, themeSource: 'blog' as const },
  { value: 'ai' as const, label: 'AI Strategic Engine', desc: 'Pure AI strategic planning', icon: FileText, themeSource: 'ai' as const },
] as const;

type IntelligenceSource = typeof INTELLIGENCE_SOURCES[number]['value'];

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

function SharingDots({ count }: { count: number }) {
  const dots = Math.min(count, 5);
  return (
    <span className="flex items-center gap-0.5" title={count === 1 ? 'Unique' : `Shared x ${count}`}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className={`inline-block rounded-full ${i === 0 ? 'w-2 h-2 bg-indigo-500' : 'w-2 h-2 border border-indigo-300 bg-white'}`} />
      ))}
    </span>
  );
}

function CardsView({
  companyId,
  selectedWeek,
  onSelectWeek,
  onConfirmed,
  canConfirm = false,
  skeletonAlreadyConfirmed = false,
}: {
  companyId?: string | null;
  selectedWeek?: number | null;
  onSelectWeek?: (week: number | null) => void;
  onConfirmed?: () => void;
  canConfirm?: boolean;
  skeletonAlreadyConfirmed?: boolean;
}) {
  const { state, setStrategicThemes, setStrategicCard, confirmStrategy } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const strategicCard = state.strategic_card ?? null;
  const [intelligenceSource, setIntelligenceSource] = useState<IntelligenceSource>('hybrid');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const lastClickRef = useRef<{ week: number; time: number } | null>(null);

  const sourceConfig = INTELLIGENCE_SOURCES.find((s) => s.value === intelligenceSource) ?? INTELLIGENCE_SOURCES[0];

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
    if (!companyId) {
      setGenerateError('Select a company first.');
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const strat = state.strategy_context;
      const body: Record<string, unknown> = {
        companyId,
        theme_source: sourceConfig.themeSource,
        duration_weeks: strat?.duration_weeks ?? 4,
        strategy_context: strat
          ? {
              ...strat,
              duration_weeks: strat.duration_weeks ?? 4,
              target_audience: Array.isArray(strat.target_audience)
                ? strat.target_audience.filter(Boolean)
                : strat.target_audience,
            }
          : { duration_weeks: 4 },
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
      const raw: Array<{ week: number; title: string; phase_label?: string; objective?: string; content_focus?: string; cta_focus?: string }> = Array.isArray(data.themes) ? data.themes : [];
      const returnedCard =
        data?.strategic_card && typeof data.strategic_card === 'object' && !Array.isArray(data.strategic_card)
          ? (data.strategic_card as PlannerStrategicCard)
          : null;
      setStrategicCard(returnedCard);
      setStrategicThemes(raw.filter((t) => typeof t.week === 'number' && typeof t.title === 'string'));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate themes');
    } finally {
      setGenerating(false);
    }
  }

  function handleConfirmStrategy() {
    if (!canConfirm) return;
    confirmStrategy();
    onConfirmed?.();
  }

  return (
    <div className="flex flex-col h-full">
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
              <option key={s.value} value={s.value}>{s.label} - {s.desc}</option>
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
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating...</>
            : <><sourceConfig.icon className="h-3.5 w-3.5" />{themes.length > 0 ? 'Regenerate Cards' : 'Generate Cards'}</>}
        </button>
        {generateError && <p className="text-[11px] text-red-600">{generateError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-20 space-y-2">
        {strategicCard && (
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                  Campaign Strategy Card
                </p>
                <h4 className="mt-1 text-sm font-semibold text-gray-900">
                  {strategicCard.core.polished_title || strategicCard.core.topic || 'Untitled strategy'}
                </h4>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-indigo-700 border border-indigo-200">
                {strategicCard.source_label}
              </span>
            </div>
            {strategicCard.core.summary && (
              <p className="text-xs text-gray-700 leading-relaxed">{strategicCard.core.summary}</p>
            )}
            <div className="grid grid-cols-1 gap-2">
              {strategicCard.strategic_context.campaign_goal && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Campaign goal</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.strategic_context.campaign_goal}</p>
                </div>
              )}
              {strategicCard.strategic_context.target_audience.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Target audience</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.strategic_context.target_audience.join(', ')}</p>
                </div>
              )}
              {strategicCard.strategic_context.key_message && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Key message</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.strategic_context.key_message}</p>
                </div>
              )}
              {strategicCard.intelligence.why_now && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Why now</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.intelligence.why_now}</p>
                </div>
              )}
              {strategicCard.intelligence.expected_transformation && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Intended outcome</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.intelligence.expected_transformation}</p>
                </div>
              )}
              {strategicCard.execution.execution_stage && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Execution stage</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.execution.execution_stage}</p>
                </div>
              )}
              {strategicCard.blueprint.progression_summary && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Weekly arc</p>
                  <p className="text-[11px] text-gray-700">{strategicCard.blueprint.progression_summary}</p>
                </div>
              )}
            </div>
          </div>
        )}

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
                <div className={`p-4 bg-gradient-to-br ${color.bg} rounded-[10px]`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${color.badge}`}>
                          Week {theme.week}
                        </span>
                        {theme.phase_label && (
                          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color.badge} opacity-80`}>
                            {theme.phase_label}
                          </span>
                        )}
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                            <MessageSquare className="h-2.5 w-2.5" />
                            AI Chat active
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 leading-snug">
                        {theme.title || <span className="text-gray-400 italic font-normal">No theme set</span>}
                      </p>
                      {theme.objective && (
                        <div className="flex items-start gap-1.5">
                          <Target className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-gray-600 leading-snug">{theme.objective}</p>
                        </div>
                      )}
                      {(theme.content_focus || theme.cta_focus) && (
                        <div className="flex flex-col gap-1 pt-1 border-t border-black/5">
                          {theme.content_focus && (
                            <div className="flex items-start gap-1.5">
                              <Palette className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />
                              <p className="text-[11px] text-gray-600 leading-snug">{theme.content_focus}</p>
                            </div>
                          )}
                          {theme.cta_focus && (
                            <div className="flex items-start gap-1.5">
                              <MousePointerClick className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />
                              <p className="text-[11px] text-gray-600 leading-snug">{theme.cta_focus}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1 ${color.accent}`} />
                  </div>
                  {isSelected && (
                    <p className="mt-2 text-[10px] text-gray-500">
                      Click AI Chat on the left to edit this week. Double-click to clear the selection.
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {themes.length > 0 && (
        <div className="absolute bottom-3 left-0 right-0 px-3 flex flex-col items-center gap-1.5 pointer-events-none">
          <button
            type="button"
            onClick={handleConfirmStrategy}
            disabled={!canConfirm}
            className={`pointer-events-auto w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold shadow-xl transition-all ${
              canConfirm
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            {skeletonAlreadyConfirmed ? 'Confirm Strategy And Open Build' : 'Confirm Strategy And Open Skeleton'}
          </button>
          <p className="pointer-events-auto w-full rounded-lg border border-indigo-100 bg-white/95 px-3 py-2 text-[11px] text-gray-600 shadow-sm">
            Weekly planning starts after both Skeleton and Strategy are confirmed.
          </p>
        </div>
      )}
    </div>
  );
}

function ThemesTab({ companyId, onOpenWorkspace }: { companyId?: string | null; onOpenWorkspace: (g: ContentGroup) => void }) {
  const { state } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const plan = state.calendar_plan ?? state.execution_plan?.calendar_plan;
  const hasSkeleton = Boolean(plan?.activities?.length || plan?.days?.length);

  function getAllGroupsForWeek(week: number): ContentGroup[] {
    if (!plan) return [];
    let acts: CalendarPlanActivity[] = [];
    if (Array.isArray(plan.activities) && plan.activities.length > 0) {
      acts = (plan.activities as CalendarPlanActivity[]).filter((a) => a.week_number === week);
    } else if (Array.isArray(plan.days) && plan.days.length > 0) {
      acts = plan.days
        .filter((d) => d.week_number === week)
        .flatMap((d) => (d.activities ?? []).map((a) => ({ ...a, day: a.day ?? d.day, week_number: week })));
    }
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
                  <button
                    key={gi}
                    type="button"
                    onClick={() => onOpenWorkspace(group)}
                    className="w-full text-left px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-indigo-50/50 transition-colors group"
                  >
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

export function StrategicThemeCards({
  companyId,
  selectedWeek,
  onSelectWeek,
  onConfirmed,
  canConfirm = false,
  skeletonAlreadyConfirmed = false,
}: {
  companyId?: string | null;
  selectedWeek?: number | null;
  onSelectWeek?: (week: number | null) => void;
  onConfirmed?: () => void;
  canConfirm?: boolean;
  skeletonAlreadyConfirmed?: boolean;
}) {
  const { state } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const [innerTab, setInnerTab] = useState<'cards' | 'themes'>('cards');
  const [activeWorkspace, setActiveWorkspace] = useState<ContentGroup | null>(null);

  return (
    <>
      <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Palette className="h-4 w-4 text-indigo-600" />
            Strategic Themes
          </h3>
          {themes.length > 0 && (
            <span className="text-xs text-gray-400">{themes.length} week{themes.length !== 1 ? 's' : ''}</span>
          )}
        </div>

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

        <div className="flex-1 min-h-0 overflow-hidden relative">
          {innerTab === 'cards' ? (
            <CardsView
              companyId={companyId}
              selectedWeek={selectedWeek}
              onSelectWeek={onSelectWeek}
              onConfirmed={onConfirmed}
              canConfirm={canConfirm}
              skeletonAlreadyConfirmed={skeletonAlreadyConfirmed}
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
