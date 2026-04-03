/**
 * Campaign Context Bar
 * Description -> Campaign Goal -> Target Audience -> Message/CTA ->
 * Opportunity Suggestions -> Opportunity Insights.
 * Strategy card generation now happens in the right-hand strategy panel.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Loader2, Target, Layers } from 'lucide-react';
import { usePlannerSession, type IdeaSpine } from './plannerSessionStore';
import { OpportunityInsightsTab } from './OpportunityInsightsTab';
import { MultiSelectDropdown } from '../ui/dropdown';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { buildPlannerStrategicCard } from '../../lib/plannerStrategicCard';

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

const CONTENT_FORMAT_OPTIONS = [
  'Short-form Video (Reels / TikTok)',
  'Long-form Video (YouTube)',
  'Carousel Post',
  'Static Image / Infographic',
  'Newsletter / Email',
  'Podcast / Audio',
  'Live / Webinar',
  'Thread (Twitter/X)',
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

const DEFAULT_STRATEGY_BASE = {
  duration_weeks: 4,
  platforms: [],
  posting_frequency: {},
  content_mix: [],
  campaign_goal: '',
  target_audience: '',
};

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
    setStrategicCard,
    setSourceIds,
    setPlannerEntryMode,
  } = usePlannerSession();
  const spine = state.campaign_design?.idea_spine;
  const strat = state.execution_plan?.strategy_context;

  const [collapsed, setCollapsed] = useState(false);
  const [description, setDescription] = useState(spine?.refined_description ?? spine?.description ?? '');
  const [goalError, setGoalError] = useState<string | null>(null);

  type StrategicConfig = { strategic_aspects: string[]; offerings_by_aspect: Record<string, string[]> };
  const [strategicConfig, setStrategicConfig] = useState<StrategicConfig | null>(null);
  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const [expandSuggestions, setExpandSuggestions] = useState(false);
  const [expandInsights, setExpandInsights] = useState(false);

  useEffect(() => {
    setDescription(spine?.refined_description ?? spine?.description ?? '');
  }, [spine?.refined_description, spine?.description]);

  const saveSpine = useCallback((desc: string, currentSpine: IdeaSpine | null | undefined) => {
    const trimmed = desc.trim();
    const autoTitle = trimmed.slice(0, 80) || (state.strategic_themes?.[0]?.title ?? 'Campaign');
    setIdeaSpine({
      ...(currentSpine ?? { origin: 'direct' }),
      title: autoTitle,
      description: trimmed,
      refined_title: autoTitle,
      refined_description: trimmed || undefined,
    } as IdeaSpine);
  }, [setIdeaSpine, state.strategic_themes]);

  useEffect(() => {
    const t = setTimeout(() => saveSpine(description, spine), 400);
    return () => clearTimeout(t);
  }, [description, saveSpine, spine]);

  const goalList = toList(strat?.campaign_goal);
  const handleGoalChange = (vals: string[]) => {
    const err = validateGoals(vals);
    if (err) {
      setGoalError(err);
      return;
    }
    setGoalError(null);
    const base = strat ?? DEFAULT_STRATEGY_BASE;
    setStrategyContext({ ...base, campaign_goal: vals.filter(Boolean).join(', ') });
  };

  const audienceList = toList(strat?.target_audience);
  const applyAudience = (vals: string[]) => {
    const base = strat ?? DEFAULT_STRATEGY_BASE;
    setStrategyContext({ ...base, target_audience: vals });
  };

  const contentFormatList: string[] = (strat as { content_formats?: string[] } | null)?.content_formats ?? [];
  const applyContentFormats = (vals: string[]) => {
    const base = strat ?? DEFAULT_STRATEGY_BASE;
    setStrategyContext({ ...base, content_formats: vals } as never);
  };

  const keyMessage = (strat as { key_message?: string } | null)?.key_message ?? '';

  useEffect(() => {
    if (!companyId) {
      setStrategicConfig(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        const config = data?.recommendation_strategic_config;
        const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
        if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
          const sortAz = (a: string, b: string) =>
            a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });
          const sortedAspects = [...config.strategic_aspects].sort(sortAz);
          const sortedMap: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(map ?? {})) {
            sortedMap[k] = Array.isArray(v) ? [...(v as string[])].sort(sortAz) : [];
          }
          setStrategicConfig({ strategic_aspects: sortedAspects, offerings_by_aspect: sortedMap });
        }
      })
      .catch(() => {
        if (!cancelled) setStrategicConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const selectedAspects: string[] = (strat as { selected_aspects?: string[] } | null)?.selected_aspects ?? [];
  const selectedOfferings: string[] = (strat as { selected_offerings?: string[] } | null)?.selected_offerings ?? [];

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
      const base = strat ?? DEFAULT_STRATEGY_BASE;
      setStrategyContext({ ...base, selected_offerings: next } as never);
    }
  }, [offeringsForSelectedAspects, selectedOfferings, setStrategyContext, strat]);

  useEffect(() => {
    if (!companyId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    fetchWithAuth('/api/planner/suggest-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed');
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions as CampaignSuggestion[] : []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSuggestionsError(err instanceof Error ? err.message : 'Failed to load suggestions.');
        }
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (suggestions.length > 0) setExpandSuggestions(true);
  }, [suggestions.length]);

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
  }, [recommendation_context, opportunity_context, initial_idea, setIdeaSpine]);

  const handleApplySuggestion = (s: CampaignSuggestion) => {
    setIdeaSpine({
      title: s.suggested_campaign_title,
      description: s.topic,
      origin: 'opportunity',
      source_id: s.id,
      refined_title: s.suggested_campaign_title,
      refined_description: s.topic,
    });
    const base = strat ?? DEFAULT_STRATEGY_BASE;
    const nextStrategyContext = { ...base, duration_weeks: s.suggested_duration };
    setStrategyContext(nextStrategyContext);
    setStrategicThemes(s.themes);
    setStrategicCard(
      buildPlannerStrategicCard({
        sourceMode: 'trend',
        ideaSpine: {
          title: s.suggested_campaign_title,
          description: s.topic,
          origin: 'opportunity',
          source_id: s.id,
          refined_title: s.suggested_campaign_title,
          refined_description: s.topic,
        },
        strategyContext: nextStrategyContext,
        themes: s.themes,
      })
    );
    setSourceIds({ source_opportunity_id: s.id, opportunity_score: s.opportunity_score ?? undefined });
    setPlannerEntryMode('opportunity');
    setAppliedSuggestion(s.id);
    onOpportunityApplied?.();
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Goal</label>
            <MultiSelectDropdown
              options={CAMPAIGN_GOAL_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={goalList}
              onChange={handleGoalChange}
              placeholder="Select goal(s)..."
              className="w-full"
              size="sm"
            />
            {goalError && <p className="text-xs text-red-600 mt-1">{goalError}</p>}
          </div>

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

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Audience</label>
            <MultiSelectDropdown
              options={TARGET_AUDIENCE_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={audienceList}
              onChange={applyAudience}
              placeholder="Select target audience..."
              className="w-full"
              size="sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Content Format
              <span className="ml-1 text-gray-400 font-normal">(pick up to 2)</span>
            </label>
            <MultiSelectDropdown
              options={CONTENT_FORMAT_OPTIONS.map((v) => ({ value: v, label: v }))}
              values={contentFormatList}
              onChange={applyContentFormats}
              placeholder="Select content formats..."
              className="w-full"
              size="sm"
              maxSelections={2}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Message / CTA</label>
            <input
              type="text"
              value={keyMessage}
              onChange={(e) => {
                const base = strat ?? DEFAULT_STRATEGY_BASE;
                setStrategyContext({ ...base, key_message: e.target.value });
              }}
              placeholder="Key message or call-to-action"
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
            />
          </div>

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
                  const base = strat ?? DEFAULT_STRATEGY_BASE;
                  setStrategyContext({ ...base, selected_aspects: vals } as never);
                }}
                placeholder="Select strategic aspects..."
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
                    const base = strat ?? DEFAULT_STRATEGY_BASE;
                    setStrategyContext({ ...base, selected_offerings: vals } as never);
                  }}
                  placeholder={offeringsForSelectedAspects.length === 0 ? 'No offerings for selected aspects' : 'Select offerings...'}
                  className="w-full"
                  size="sm"
                />
              )}
            </div>
          )}

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
                        <Loader2 className="h-4 w-4 animate-spin" />Loading...
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
                            <button
                              type="button"
                              onClick={() => handleApplySuggestion(s)}
                              className="shrink-0 px-2.5 py-1 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                            >
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

          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5">
            <p className="text-xs font-semibold text-indigo-800">Next step</p>
            <p className="mt-1 text-xs leading-relaxed text-indigo-700">
              Use the strategy card panel on the right to generate and choose the campaign-level strategy card.
              Once that card is finalized, confirm Strategy there to move forward.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
