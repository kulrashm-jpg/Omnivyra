/**
 * Strategy Tab
 * Campaign goal dropdown, target audience chips, AI recommendations.
 * Opportunity Insights + Strategic theme builder (BOLT).
 * Strategic Themes: generate and apply weekly themes before skeleton.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { usePlannerSession, type StrategicThemeEntry } from '../plannerSessionStore';
import { OpportunityInsightsTab } from '../OpportunityInsightsTab';
import { MultiSelectDropdown } from '../../ui/dropdown';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { Sparkles, Loader2, Palette, RotateCcw, Trash2, Target, Layers } from 'lucide-react';

const CAMPAIGN_GOAL_OPTIONS = [
  'Brand Awareness',
  'Lead Generation',
  'Product Education',
  'Product Launch',
  'Community Growth',
  'Customer Retention',
  'Thought Leadership',
  'Event Promotion',
] as const;

const TARGET_AUDIENCE_OPTIONS = [
  'B2B Marketers',
  'Founders / Entrepreneurs',
  'Marketing Leaders',
  'Sales Teams',
  'Product Managers',
  'Developers',
  'General Consumers',
] as const;

/** Normalize a string | string[] field to string[] */
function toStringArray(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim());
  const s = String(val).trim();
  if (!s) return [];
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

const GOAL_INCOMPATIBLE_PAIRS: [string, string][] = [
  ['Brand Awareness', 'Thought Leadership'],
  ['Lead Generation', 'Product Launch'],
  ['Customer Retention', 'Community Growth'],
];

function validateGoals(goals: string[]): string | null {
  if (goals.length <= 1) return null;
  for (const [a, b] of GOAL_INCOMPATIBLE_PAIRS) {
    if (goals.includes(a) && goals.includes(b)) return 'Selected goals cannot be combined.';
  }
  return null;
}

export interface StrategyTabProps {
  companyId?: string | null;
  campaignId?: string | null;
  onOpportunityApplied?: () => void;
  onGeneratePlan?: () => void;
}

export function StrategyTab({
  companyId,
  campaignId,
  onOpportunityApplied,
}: StrategyTabProps) {
  const {
    state,
    setIdeaSpine,
    setStrategyContext,
    setStrategicThemes,
    clearStrategicThemes,
    setSourceIds,
    setPlannerEntryMode,
  } = usePlannerSession();
  const strat = state.execution_plan?.strategy_context;
  const recommendedGoal = state.recommended_goal ?? null;
  const recommendedAudience = state.recommended_audience ?? null;

  const goalList = toStringArray(strat?.campaign_goal);
  const targetAudienceList = toStringArray(strat?.target_audience);
  const [goalError, setGoalError] = useState<string | null>(null);

  // Strategic config from company profile
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

  const selectedAspects = strat?.selected_aspects ?? [];
  const selectedOfferings = strat?.selected_offerings ?? [];

  const offeringsForSelectedAspects = useMemo(() => {
    if (!strategicConfig || selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) {
      (strategicConfig.offerings_by_aspect[aspect] ?? []).forEach((o) => seen.add(o));
    }
    return Array.from(seen);
  }, [selectedAspects, strategicConfig]);

  // Keep only valid offerings when aspects change
  useEffect(() => {
    if (selectedOfferings.length === 0) return;
    const allowed = new Set(offeringsForSelectedAspects);
    const next = selectedOfferings.filter((o) => allowed.has(o));
    if (next.length !== selectedOfferings.length) {
      const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
      setStrategyContext({ ...base, selected_offerings: next });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringsForSelectedAspects]);

  const applyGoals = (goals: string[]) => {
    const err = validateGoals(goals);
    if (err) { setGoalError(err); return; }
    setGoalError(null);
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, campaign_goal: goals.filter(Boolean).join(', ') });
  };

  const applyAudience = (audience: string[]) => {
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, target_audience: audience });
  };

  const toggleAudience = (item: string) => {
    const set = new Set(targetAudienceList);
    if (set.has(item)) set.delete(item);
    else set.add(item);
    applyAudience(Array.from(set));
  };

  const toggleAspect = (aspect: string) => {
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    const set = new Set(selectedAspects);
    if (set.has(aspect)) set.delete(aspect); else set.add(aspect);
    setStrategyContext({ ...base, selected_aspects: Array.from(set) });
  };

  const toggleOffering = (offering: string) => {
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    const set = new Set(selectedOfferings);
    if (set.has(offering)) set.delete(offering); else set.add(offering);
    setStrategyContext({ ...base, selected_offerings: Array.from(set) });
  };

  const applyRecommendedGoal = () => {
    if (recommendedGoal) applyGoals([...new Set([...goalList, recommendedGoal])]);
  };

  const applyRecommendedAudience = () => {
    if (recommendedAudience?.length) {
      const merged = [...new Set([...targetAudienceList, ...recommendedAudience])];
      applyAudience(merged);
    }
  };

  const hasRecommendations = (recommendedGoal && recommendedGoal.trim()) || (recommendedAudience?.length ?? 0) > 0;

  const [themesLoading, setThemesLoading] = useState(false);
  const [generatedThemes, setGeneratedThemes] = useState<StrategicThemeEntry[]>([]);
  const [themesError, setThemesError] = useState<string | null>(null);

  type CampaignSuggestion = {
    id: string;
    topic: string;
    opportunity_score: number | null;
    suggested_campaign_title: string;
    suggested_duration: number;
    themes: { week: number; title: string }[];
  };
  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setSuggestions([]);
      return;
    }
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
        if (!res.ok) throw new Error(data?.error || 'Failed to load suggestions');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setSuggestions(raw as CampaignSuggestion[]);
      })
      .catch((err) => {
        if (!cancelled) setSuggestionsError(err instanceof Error ? err.message : 'Failed to load suggestions.');
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const handleApplySuggestion = (s: CampaignSuggestion) => {
    setIdeaSpine({
      title: s.topic,
      description: s.suggested_campaign_title,
      origin: 'opportunity',
      source_id: s.id,
      refined_title: s.suggested_campaign_title,
      refined_description: s.topic,
    });
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, duration_weeks: s.suggested_duration });
    setStrategicThemes(s.themes);
    setSourceIds({ source_opportunity_id: s.id, opportunity_score: s.opportunity_score ?? undefined });
    setPlannerEntryMode('opportunity');
    setAppliedSuggestion(s.id);
    onOpportunityApplied?.();
  };

  const spine = state.campaign_design?.idea_spine ?? state.idea_spine;
  const stratForThemes = state.execution_plan?.strategy_context ?? state.strategy_context;
  const hasIdeaForThemes = Boolean((spine?.refined_title ?? spine?.title ?? '').trim()) || Boolean((spine?.refined_description ?? spine?.description ?? '').trim());

  const handleGenerateThemes = async () => {
    if (!companyId || !hasIdeaForThemes) {
      setThemesError(!companyId ? 'Select a company first.' : 'Complete Campaign Context (idea/title and description) first.');
      return;
    }
    setThemesLoading(true);
    setThemesError(null);
    setGeneratedThemes([]);
    try {
      const res = await fetch('/api/planner/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          companyId,
          idea_spine: spine,
          strategy_context: stratForThemes,
          trend_context: state.campaign_design?.trend_context ?? state.trend_context ?? undefined,
          duration_weeks: stratForThemes?.duration_weeks ?? 6,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to generate themes');
      const raw = Array.isArray(data?.themes) ? data.themes : [];
      const themes: StrategicThemeEntry[] = raw
        .map((t: unknown, i: number) => {
          if (t && typeof t === 'object' && 'week' in t && 'title' in t)
            return { week: Number((t as { week: unknown }).week) || i + 1, title: String((t as { title: unknown }).title ?? '') };
          if (typeof t === 'string') return { week: i + 1, title: t };
          return null;
        })
        .filter((x): x is StrategicThemeEntry => x !== null && x.title.trim() !== '');
      setGeneratedThemes(themes);
    } catch (e) {
      setThemesError(e instanceof Error ? e.message : 'Could not generate themes');
    } finally {
      setThemesLoading(false);
    }
  };

  const handleApplyThemes = () => {
    const themes = generatedThemes.length > 0 ? generatedThemes : (state.strategic_themes ?? []);
    if (themes.length > 0) {
      setStrategicThemes(themes);
      setGeneratedThemes([]);
    }
  };

  const appliedThemes = state.strategic_themes ?? [];
  const displayThemes = generatedThemes.length > 0 ? generatedThemes : appliedThemes;

  const handleThemeChange = (weekIndex: number, value: string) => {
    if (generatedThemes.length > 0) {
      setGeneratedThemes((prev) => {
        const next = prev.map((t, i) => (i === weekIndex ? { ...t, title: value } : t));
        return next;
      });
    } else {
      const current = state.strategic_themes ?? [];
      const next = current.map((t, i) => (i === weekIndex ? { ...t, title: value } : t));
      setStrategicThemes(next);
    }
  };

  const handleRegenerateThemes = () => {
    setGeneratedThemes([]);
    handleGenerateThemes();
  };

  const handleClearThemes = () => {
    clearStrategicThemes();
    setGeneratedThemes([]);
  };

  return (
    <div className="p-4 space-y-4">
      {hasRecommendations && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            Recommended based on campaign theme
          </div>
          <div className="space-y-2">
            {recommendedGoal && (
              <button
                type="button"
                onClick={applyRecommendedGoal}
                className="block w-full text-left px-3 py-2 rounded border border-indigo-200 bg-white text-sm text-indigo-800 hover:bg-indigo-50 transition-colors"
              >
                <span className="text-gray-500 text-xs">Recommended Goal:</span> {recommendedGoal}
              </button>
            )}
            {recommendedAudience?.length ? (
              <button
                type="button"
                onClick={applyRecommendedAudience}
                className="block w-full text-left px-3 py-2 rounded border border-indigo-200 bg-white text-sm text-indigo-800 hover:bg-indigo-50 transition-colors"
              >
                <span className="text-gray-500 text-xs">Recommended Audience:</span> {recommendedAudience.join(', ')}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Campaign Goal & Audience</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaign goal</label>
            <MultiSelectDropdown
              options={CAMPAIGN_GOAL_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={goalList}
              onChange={applyGoals}
              placeholder="Select goal(s)…"
              className="w-full"
              size="sm"
            />
            {goalError && <p className="text-xs text-red-600 mt-1">{goalError}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Target audience</label>
            <div className="flex flex-wrap gap-1.5">
              {TARGET_AUDIENCE_OPTIONS.map((item) => {
                const selected = targetAudienceList.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleAudience(item)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                        : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            {targetAudienceList.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">Selected: {targetAudienceList.join(', ')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Strategic Focus — aspects + offerings from company profile */}
      {companyId && strategicConfig && strategicConfig.strategic_aspects.length > 0 && (
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-600" />
            Strategic Focus
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Select strategic aspects (and specific offerings) to anchor this campaign. AI will align content topics and messaging to your selections.
          </p>

          {/* Aspect chips */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {strategicConfig.strategic_aspects.map((aspect) => {
              const active = selectedAspects.includes(aspect);
              return (
                <button
                  key={aspect}
                  type="button"
                  onClick={() => toggleAspect(aspect)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                      : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                  }`}
                >
                  {aspect}
                </button>
              );
            })}
          </div>

          {/* Offerings under selected aspects */}
          {offeringsForSelectedAspects.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">Offerings</p>
              <div className="flex flex-wrap gap-1.5">
                {offeringsForSelectedAspects.map((offering) => {
                  const label = offering.includes(':') ? offering.split(':').slice(1).join(':').trim() : offering;
                  const active = selectedOfferings.includes(offering);
                  return (
                    <button
                      key={offering}
                      type="button"
                      onClick={() => toggleOffering(offering)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                          : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedAspects.length > 0 && offeringsForSelectedAspects.length === 0 && (
            <p className="text-xs text-gray-400">No offerings configured for this aspect.</p>
          )}
        </div>
      )}

      {companyId && (
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-amber-600" />
            Opportunity Campaign Suggestions
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Campaign ideas from Opportunity Radar. Click &quot;Use for Campaign&quot; to prefill context and themes.
          </p>
          {appliedSuggestion && (
            <p className="text-xs text-green-600 mb-2 font-medium">Campaign suggestion applied.</p>
          )}
          {suggestionsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading suggestions…
            </div>
          ) : suggestionsError ? (
            <p className="text-xs text-red-600">{suggestionsError}</p>
          ) : suggestions.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No trending opportunities match the criteria.</p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div>
                    <p className="text-xs font-medium text-amber-800">Trending Opportunity</p>
                    <p className="text-sm text-gray-800">{s.topic}</p>
                    <p className="text-xs text-gray-600 mt-0.5">Suggested Campaign: {s.suggested_campaign_title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplySuggestion(s)}
                    className="shrink-0 px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Use for Campaign
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Palette className="h-4 w-4 text-indigo-600" />
          Strategic Themes
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Generate weekly themes for your campaign, then apply them before building the skeleton.
        </p>
        <div className="space-y-2 mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateThemes}
            disabled={themesLoading || !companyId || !hasIdeaForThemes}
            className="px-3 py-2 text-sm rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 flex items-center gap-2"
          >
            {themesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Themes
          </button>
          {displayThemes.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleRegenerateThemes}
                disabled={themesLoading || !companyId || !hasIdeaForThemes}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Regenerate Themes
              </button>
              <button
                type="button"
                onClick={handleClearThemes}
                className="px-3 py-2 text-sm rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear Themes
              </button>
              <button
                type="button"
                onClick={handleApplyThemes}
                className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Apply Themes to Campaign
              </button>
            </>
          )}
        </div>
        {themesError && <p className="text-xs text-red-600 mb-2">{themesError}</p>}
        {displayThemes.length > 0 && (
          <div className="space-y-2">
            {displayThemes.map((theme, i) => (
              <div key={theme.week} className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 shrink-0 w-14">Week {theme.week}</span>
                <input
                  type="text"
                  value={theme.title}
                  onChange={(e) => handleThemeChange(i, e.target.value)}
                  placeholder={`Theme for week ${theme.week}`}
                  className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Opportunity Insights</h3>
        <OpportunityInsightsTab
          companyId={companyId}
          campaignId={campaignId}
          onApplied={onOpportunityApplied}
        />
      </div>
    </div>
  );
}
