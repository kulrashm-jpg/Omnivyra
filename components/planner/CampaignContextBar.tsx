/**
 * Campaign Context Bar
 * Description → Campaign Goal → Target Audience → Message/CTA →
 * Opportunity Suggestions → Opportunity Insights → Strategic Themes.
 * Title is auto-derived from description/themes (not entered manually).
 * Refine with AI removed.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Sparkles, Loader2, Target, Palette, RotateCcw, Trash2, Layers } from 'lucide-react';
import { usePlannerSession, type IdeaSpine, type StrategicThemeEntry } from './plannerSessionStore';
import { OpportunityInsightsTab } from './OpportunityInsightsTab';
import { MultiSelectDropdown } from '../ui/dropdown';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

type CampaignSuggestion = {
  id: string;
  topic: string;
  opportunity_score: number | null;
  suggested_campaign_title: string;
  suggested_duration: number;
  themes: { week: number; title: string }[];
};

const CAMPAIGN_GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Product Education', 'Product Launch',
  'Community Growth', 'Customer Retention', 'Thought Leadership', 'Event Promotion',
] as const;

const GOAL_INCOMPATIBLE_PAIRS: [string, string][] = [
  ['Brand Awareness', 'Thought Leadership'],
  ['Lead Generation', 'Product Launch'],
  ['Customer Retention', 'Community Growth'],
];

const TARGET_AUDIENCE_OPTIONS = [
  'B2B Marketers', 'Founders / Entrepreneurs', 'Marketing Leaders',
  'Sales Teams', 'Product Managers', 'Developers', 'General Consumers',
] as const;

function toList(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim());
  return String(val).trim().split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

function validateGoals(goals: string[]): string | null {
  if (goals.length <= 1) return null;
  for (const [a, b] of GOAL_INCOMPATIBLE_PAIRS) {
    if (goals.includes(a) && goals.includes(b)) return 'Selected goals cannot be combined.';
  }
  return null;
}

export interface CampaignContextBarProps {
  recommendation_context?: Record<string, unknown> | null;
  opportunity_context?: Record<string, unknown> | null;
  initial_idea?: string | null;
  companyId?: string | null;
  campaignId?: string | null;
  onOpportunityApplied?: () => void;
}

export function CampaignContextBar({
  recommendation_context,
  opportunity_context,
  initial_idea,
  companyId,
  campaignId,
  onOpportunityApplied,
}: CampaignContextBarProps) {
  const {
    state,
    setIdeaSpine,
    setStrategyContext,
    setStrategicThemes,
    clearStrategicThemes,
    setSourceIds,
    setPlannerEntryMode,
  } = usePlannerSession();
  const spine = state.campaign_design?.idea_spine;
  const strat = state.execution_plan?.strategy_context;

  const [collapsed, setCollapsed] = useState(false);

  // ── Description (title auto-derived) ────────────────────────────────────
  const [description, setDescription] = useState(spine?.refined_description ?? spine?.description ?? '');

  // Sync description from spine when updated externally (opportunity prefill, apply suggestion)
  useEffect(() => {
    setDescription(spine?.refined_description ?? spine?.description ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spine?.refined_description, spine?.description]);

  const saveSpine = useCallback((desc: string, currentSpine: IdeaSpine | null | undefined) => {
    const trimmed = desc.trim();
    // Title is auto-derived from description (first ~80 chars) or existing theme
    const autoTitle = trimmed.slice(0, 80) || (state.strategic_themes?.[0]?.title ?? 'Campaign');
    setIdeaSpine({
      ...(currentSpine ?? { origin: 'direct' }),
      title: autoTitle,
      description: trimmed,
      refined_title: autoTitle,
      refined_description: trimmed || undefined,
    } as IdeaSpine);
  }, [setIdeaSpine, state.strategic_themes]);

  // Debounced save
  useEffect(() => {
    const t = setTimeout(() => saveSpine(description, spine), 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description]);

  // ── Campaign Goal ────────────────────────────────────────────────────────
  const goalList = toList(strat?.campaign_goal);
  const [goalError, setGoalError] = useState<string | null>(null);

  const handleGoalChange = (vals: string[]) => {
    const err = validateGoals(vals);
    if (err) { setGoalError(err); return; }
    setGoalError(null);
    const base = strat ?? { duration_weeks: 6, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, campaign_goal: vals.filter(Boolean).join(', ') });
  };

  // ── Target Audience ──────────────────────────────────────────────────────
  const audienceList = toList(strat?.target_audience);
  const applyAudience = (vals: string[]) => {
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, target_audience: vals });
  };

  // ── Message / CTA ────────────────────────────────────────────────────────
  const keyMessage = (strat as { key_message?: string } | null)?.key_message ?? '';

  // ── Strategic Focus (aspects + offerings from company profile) ───────────
  type StrategicConfig = { strategic_aspects: string[]; offerings_by_aspect: Record<string, string[]> };
  const [strategicConfig, setStrategicConfig] = useState<StrategicConfig | null>(null);

  useEffect(() => {
    if (!companyId) { setStrategicConfig(null); return; }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        const config = data?.recommendation_strategic_config;
        const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
        if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
          const sortAz = (a: string, b: string) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });
          const sortedAspects = [...config.strategic_aspects].sort(sortAz);
          const sortedMap: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(map ?? {})) {
            sortedMap[k] = Array.isArray(v) ? [...v as string[]].sort(sortAz) : [];
          }
          setStrategicConfig({ strategic_aspects: sortedAspects, offerings_by_aspect: sortedMap });
        }
      })
      .catch(() => { if (!cancelled) setStrategicConfig(null); });
    return () => { cancelled = true; };
  }, [companyId]);

  const selectedAspects: string[] = (strat as any)?.selected_aspects ?? [];
  const selectedOfferings: string[] = (strat as any)?.selected_offerings ?? [];

  const offeringsForSelectedAspects = useMemo(() => {
    if (!strategicConfig || selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) {
      (strategicConfig.offerings_by_aspect[aspect] ?? []).forEach((o) => seen.add(o));
    }
    return Array.from(seen);
  }, [selectedAspects, strategicConfig]);

  useEffect(() => {
    if (selectedOfferings.length === 0) return;
    const allowed = new Set(offeringsForSelectedAspects);
    const next = selectedOfferings.filter((o) => allowed.has(o));
    if (next.length !== selectedOfferings.length) {
      const base = strat ?? { duration_weeks: 6, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
      setStrategyContext({ ...base, selected_offerings: next } as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringsForSelectedAspects]);

  // ── Opportunity suggestions ──────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const [expandSuggestions, setExpandSuggestions] = useState(false);
  const [expandInsights, setExpandInsights] = useState(false);

  useEffect(() => {
    if (!companyId) { setSuggestions([]); return; }
    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    fetch('/api/planner/suggest-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ companyId }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed');
        return data;
      })
      .then((data) => { if (!cancelled) setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions as CampaignSuggestion[] : []); })
      .catch((err) => { if (!cancelled) setSuggestionsError(err instanceof Error ? err.message : 'Failed to load suggestions.'); })
      .finally(() => { if (!cancelled) setSuggestionsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => { if (suggestions.length > 0) setExpandSuggestions(true); }, [suggestions.length]);

  // ── Prefill from entry context ───────────────────────────────────────────
  useEffect(() => {
    if (recommendation_context) {
      const t = (recommendation_context.polished_title ?? recommendation_context.trend_topic ?? recommendation_context.topic ?? '') as string;
      const d = (recommendation_context.summary ?? '') as string;
      setIdeaSpine({ title: t, description: d, origin: 'recommendation', source_id: (recommendation_context.id as string) ?? null, refined_title: t, refined_description: d });
    } else if (opportunity_context) {
      const t = (opportunity_context.title ?? '') as string;
      const d = (opportunity_context.summary ?? '') as string;
      setIdeaSpine({ title: t, description: d, origin: 'opportunity', source_id: (opportunity_context.id as string) ?? null, refined_title: t, refined_description: d });
    } else if (initial_idea) {
      const t = initial_idea.slice(0, 80);
      setIdeaSpine({ title: t, description: initial_idea, origin: 'direct', refined_title: t, refined_description: initial_idea });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation_context, opportunity_context, initial_idea]);

  const handleApplySuggestion = (s: CampaignSuggestion) => {
    setIdeaSpine({ title: s.suggested_campaign_title, description: s.topic, origin: 'opportunity', source_id: s.id, refined_title: s.suggested_campaign_title, refined_description: s.topic });
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, duration_weeks: s.suggested_duration });
    setStrategicThemes(s.themes);
    setSourceIds({ source_opportunity_id: s.id, opportunity_score: s.opportunity_score ?? undefined });
    setPlannerEntryMode('opportunity');
    setAppliedSuggestion(s.id);
    onOpportunityApplied?.();
  };

  // ── Strategic Themes ─────────────────────────────────────────────────────
  const [themesLoading, setThemesLoading] = useState(false);
  const [generatedThemes, setGeneratedThemes] = useState<StrategicThemeEntry[]>([]);
  const [themesError, setThemesError] = useState<string | null>(null);
  // Source: 'ai' | 'trend' | 'both'
  const [themeSource, setThemeSource] = useState<'ai' | 'trend' | 'both'>('ai');
  // Alternatives from regenerate: [optionA, optionB]
  const [themeAlternatives, setThemeAlternatives] = useState<[StrategicThemeEntry[], StrategicThemeEntry[]] | null>(null);
  const [selectedAlt, setSelectedAlt] = useState<0 | 1>(0);

  const stratForThemes = state.execution_plan?.strategy_context ?? state.strategy_context;
  const trendCtx = state.campaign_design?.trend_context ?? state.trend_context ?? null;
  const hasTrendContext = Boolean(trendCtx?.recommendation_id || trendCtx?.trend_topic);
  const hasIdea = Boolean(description.trim()) || Boolean((spine?.title ?? '').trim());

  function parseThemes(raw: unknown[]): StrategicThemeEntry[] {
    return raw
      .map((t, i) => {
        if (t && typeof t === 'object' && 'week' in t && 'title' in t)
          return { week: Number((t as { week: unknown }).week) || i + 1, title: String((t as { title: unknown }).title ?? '') };
        if (typeof t === 'string') return { week: i + 1, title: t };
        return null;
      })
      .filter((x): x is StrategicThemeEntry => x !== null && x.title.trim() !== '');
  }

  const handleGenerateThemes = async (withAlternatives = false) => {
    if (!companyId) { setThemesError('Select a company first.'); return; }
    if (themeSource === 'ai' && !hasIdea) { setThemesError('Enter a description first.'); return; }
    if (themeSource === 'trend' && !hasTrendContext) { setThemesError('No trend context — use AI or Both instead.'); return; }
    setThemesLoading(true);
    setThemesError(null);
    setThemeAlternatives(null);
    try {
      const res = await fetch('/api/planner/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          companyId,
          idea_spine: spine,
          strategy_context: stratForThemes,
          trend_context: trendCtx,
          duration_weeks: stratForThemes?.duration_weeks ?? 6,
          theme_source: themeSource,
          alternatives: withAlternatives ? 2 : 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to generate themes');
      if (withAlternatives && Array.isArray(data?.alternatives) && data.alternatives.length === 2) {
        const altA = parseThemes(data.alternatives[0]);
        const altB = parseThemes(data.alternatives[1]);
        setThemeAlternatives([altA, altB]);
        setSelectedAlt(0);
        setGeneratedThemes(altA);
      } else {
        setGeneratedThemes(parseThemes(Array.isArray(data?.themes) ? data.themes : []));
      }
    } catch (e) {
      setThemesError(e instanceof Error ? e.message : 'Could not generate themes');
    } finally {
      setThemesLoading(false);
    }
  };

  const handleApplyThemes = () => {
    const themes = generatedThemes.length > 0 ? generatedThemes : (state.strategic_themes ?? []);
    if (themes.length === 0) return;
    const firstTitle = themes[0].title;
    const currentSpine = spine ?? { title: '', description: '', origin: 'direct' as const };
    setIdeaSpine({ ...currentSpine, title: currentSpine.title || firstTitle, refined_title: currentSpine.refined_title || firstTitle });
    setStrategicThemes(themes);
    setGeneratedThemes([]);
    setThemeAlternatives(null);
  };

  const appliedThemes = state.strategic_themes ?? [];
  const displayThemes = generatedThemes.length > 0 ? generatedThemes : appliedThemes;

  const handleThemeChange = (weekIndex: number, value: string) => {
    if (generatedThemes.length > 0) {
      const updated = generatedThemes.map((t, i) => (i === weekIndex ? { ...t, title: value } : t));
      setGeneratedThemes(updated);
      if (themeAlternatives) {
        const alts: [StrategicThemeEntry[], StrategicThemeEntry[]] = [
          selectedAlt === 0 ? updated : themeAlternatives[0],
          selectedAlt === 1 ? updated : themeAlternatives[1],
        ];
        setThemeAlternatives(alts);
      }
    } else {
      setStrategicThemes((state.strategic_themes ?? []).map((t, i) => (i === weekIndex ? { ...t, title: value } : t)));
    }
  };

  const handleAddCard = () => {
    const current = generatedThemes.length > 0 ? generatedThemes : (state.strategic_themes ?? []);
    const nextWeek = current.length > 0 ? Math.max(...current.map((t) => t.week)) + 1 : 1;
    const newTheme: StrategicThemeEntry = { week: nextWeek, title: '' };
    if (generatedThemes.length > 0) {
      setGeneratedThemes([...generatedThemes, newTheme]);
    } else {
      setStrategicThemes([...current, newTheme]);
    }
  };

  return (
    <div className="bg-white">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700">Campaign Context</span>
        {collapsed ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronUp className="h-4 w-4 text-gray-500" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 pt-0 space-y-3">

          {/* Campaign Goal */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Goal</label>
            <MultiSelectDropdown
              options={CAMPAIGN_GOAL_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={goalList}
              onChange={handleGoalChange}
              placeholder="Select goal(s)…"
              className="w-full"
              size="sm"
            />
            {goalError && <p className="text-xs text-red-600 mt-1">{goalError}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => saveSpine(description, spine)}
              placeholder="Describe your campaign idea, goals, or context..."
              rows={2}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Target Audience */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Audience</label>
            <MultiSelectDropdown
              options={TARGET_AUDIENCE_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={audienceList}
              onChange={applyAudience}
              placeholder="Select target audience…"
              className="w-full"
              size="sm"
            />
          </div>

          {/* Message / CTA */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Message / CTA</label>
            <input
              type="text"
              value={keyMessage}
              onChange={(e) => {
                const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
                setStrategyContext({ ...base, key_message: e.target.value });
              }}
              placeholder="Key message or call-to-action"
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
            />
          </div>

          {/* Strategic Focus — aspects + offerings */}
          {companyId && strategicConfig && strategicConfig.strategic_aspects.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-indigo-500" />
                Strategic Focus
              </p>
              <MultiSelectDropdown
                options={strategicConfig.strategic_aspects.map((a) => ({ value: a, label: a }))}
                values={selectedAspects}
                onChange={(vals) => {
                  const base = strat ?? { duration_weeks: 6, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
                  setStrategyContext({ ...base, selected_aspects: vals } as any);
                }}
                placeholder="Select strategic aspects…"
                className="w-full"
                size="sm"
              />
              {selectedAspects.length > 0 && (
                <MultiSelectDropdown
                  options={offeringsForSelectedAspects.map((o) => ({
                    value: o,
                    label: o.includes(':') ? o.split(':').slice(1).join(':').trim() : o,
                  }))}
                  values={selectedOfferings}
                  onChange={(vals) => {
                    const base = strat ?? { duration_weeks: 6, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
                    setStrategyContext({ ...base, selected_offerings: vals } as any);
                  }}
                  placeholder={offeringsForSelectedAspects.length === 0 ? 'No offerings for selected aspects' : 'Select offerings…'}
                  className="w-full"
                  size="sm"
                />
              )}
            </div>
          )}

          {/* Opportunity suggestions */}
          {companyId && (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => setExpandSuggestions((e) => !e)}
                  className="w-full flex items-center justify-between text-left py-1.5 text-sm font-semibold text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {expandSuggestions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Target className="h-4 w-4 text-amber-600" />
                    Opportunity Suggestions
                  </span>
                </button>
                {expandSuggestions && (
                  <div className="pl-6 space-y-2 mt-1">
                    {appliedSuggestion && <p className="text-xs text-green-600 font-medium">Applied.</p>}
                    {suggestionsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />Loading…
                      </div>
                    ) : suggestionsError ? (
                      <p className="text-xs text-red-600">{suggestionsError}</p>
                    ) : suggestions.length === 0 ? (
                      <p className="text-xs text-gray-400 py-1">No trending opportunities.</p>
                    ) : (
                      <div className="space-y-2">
                        {suggestions.map((s) => (
                          <div key={s.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-amber-800">{s.topic}</p>
                              <p className="text-xs text-gray-600 mt-0.5">{s.suggested_campaign_title}</p>
                            </div>
                            <button type="button" onClick={() => handleApplySuggestion(s)} className="shrink-0 px-2.5 py-1 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-700">
                              Use
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setExpandInsights((e) => !e)}
                  className="w-full flex items-center justify-between text-left py-1.5 text-sm font-semibold text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {expandInsights ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Opportunity Insights
                  </span>
                </button>
                {expandInsights && (
                  <div className="pl-6 mt-1">
                    <OpportunityInsightsTab companyId={companyId} campaignId={campaignId} onApplied={onOpportunityApplied} />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Strategic Themes */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <Palette className="h-3.5 w-3.5 text-indigo-600" />
              Strategic Themes
            </h3>

            {/* Source toggle: AI / Trend / Both */}
            <div className="flex gap-1 mb-2">
              {(['ai', ...(hasTrendContext ? ['trend', 'both'] : [])] as ('ai' | 'trend' | 'both')[]).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setThemeSource(src)}
                  className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors capitalize ${
                    themeSource === src
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {src === 'ai' ? 'AI' : src === 'trend' ? 'Trend' : 'Both'}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => handleGenerateThemes(false)}
                disabled={themesLoading || !companyId}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 flex items-center gap-1.5"
              >
                {themesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {displayThemes.length > 0 ? 'Generate New' : 'Generate Themes'}
              </button>
              {(displayThemes.length > 0 || generatedThemes.length > 0) && (
                <button
                  type="button"
                  onClick={() => { setGeneratedThemes([]); handleGenerateThemes(true); }}
                  disabled={themesLoading || !companyId}
                  title="Get two alternative theme sets to compare"
                  className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Regenerate (A/B)
                </button>
              )}
              <button
                type="button"
                onClick={handleAddCard}
                title="Add a blank theme card"
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
              >
                + Add Card
              </button>
              {displayThemes.length > 0 && (
                <button
                  type="button"
                  onClick={() => { clearStrategicThemes(); setGeneratedThemes([]); setThemeAlternatives(null); }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
              {generatedThemes.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyThemes}
                  className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Apply
                </button>
              )}
            </div>

            {/* A/B alternative picker */}
            {themeAlternatives && (
              <div className="flex gap-1.5 mb-2">
                {(['Option A', 'Option B'] as const).map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setSelectedAlt(idx as 0 | 1);
                      setGeneratedThemes(themeAlternatives[idx as 0 | 1]);
                    }}
                    className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                      selectedAlt === idx
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="text-[10px] text-gray-400 self-center ml-1">Pick a set, then Apply</span>
              </div>
            )}

            {themesError && <p className="text-xs text-red-600 mb-2">{themesError}</p>}

            {/* Theme list — editable inputs */}
            {displayThemes.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {displayThemes.map((theme, i) => (
                  <div key={`${theme.week}-${i}`} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 shrink-0 w-10">Wk {theme.week}</span>
                    <input
                      type="text"
                      value={theme.title}
                      onChange={(e) => handleThemeChange(i, e.target.value)}
                      placeholder={`Week ${theme.week} theme…`}
                      className="flex-1 min-w-0 px-2.5 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
