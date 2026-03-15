/**
 * Campaign Context Bar
 * Column 1: Opportunity Campaign Suggestions, Opportunity Insights, Campaign Idea, Description.
 * Context Mode now lives in StrategySetupPanel (two-row layout).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Sparkles, Loader2, Target } from 'lucide-react';
import { usePlannerSession, type IdeaSpine } from './plannerSessionStore';
import { OpportunityInsightsTab } from './OpportunityInsightsTab';

type CampaignSuggestion = {
  id: string;
  topic: string;
  opportunity_score: number | null;
  suggested_campaign_title: string;
  suggested_duration: number;
  themes: { week: number; title: string }[];
};

export interface CampaignContextBarProps {
  /** Prefilled from recommendation/opportunity */
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
    setSourceIds,
    setPlannerEntryMode,
  } = usePlannerSession();
  const spine = state.campaign_design?.idea_spine;

  const [collapsed, setCollapsed] = useState(true);
  const [title, setTitle] = useState(spine?.refined_title ?? spine?.title ?? '');
  const [description, setDescription] = useState(spine?.refined_description ?? spine?.description ?? '');
  const [selectedAngle, setSelectedAngle] = useState<string | null>(spine?.selected_angle ?? null);
  const [normalizedAngles, setNormalizedAngles] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const [expandSuggestions, setExpandSuggestions] = useState(false);
  const [expandInsights, setExpandInsights] = useState(false);

  const strat = state.execution_plan?.strategy_context;

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
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    if (suggestions.length > 0) setExpandSuggestions(true);
  }, [suggestions.length]);

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

  useEffect(() => {
    if (spine) {
      setTitle(spine.refined_title ?? spine.title ?? '');
      setDescription(spine.refined_description ?? spine.description ?? '');
      setSelectedAngle(spine.selected_angle ?? null);
    }
  }, [spine?.refined_title, spine?.title, spine?.refined_description, spine?.description, spine?.selected_angle]);

  useEffect(() => {
    if (recommendation_context) {
      const t =
        (recommendation_context.polished_title as string) ??
        (recommendation_context.trend_topic as string) ??
        (recommendation_context.topic as string) ??
        '';
      const d = (recommendation_context.summary as string) ?? '';
      setTitle(t);
      setDescription(d);
    } else if (opportunity_context) {
      const t = (opportunity_context.title as string) ?? '';
      const d = (opportunity_context.summary as string) ?? '';
      setTitle(t);
      setDescription(d);
    } else if (initial_idea) {
      setDescription(initial_idea);
      setTitle(initial_idea.slice(0, 100));
    }
  }, [recommendation_context, opportunity_context, initial_idea]);

  const handleRefine = useCallback(async () => {
    const ideaText = description.trim() || title.trim();
    if (!ideaText) {
      setRefineError('Enter an idea first.');
      return;
    }
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch('/api/campaign-planner/refine-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          idea_text: ideaText,
          companyId: companyId || undefined,
          recommendation_context: recommendation_context || undefined,
          opportunity_context: opportunity_context || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Refinement failed');
      setTitle(data.refined_title ?? title);
      setDescription(data.refined_description ?? description);
      setNormalizedAngles(Array.isArray(data.normalized_angles) ? data.normalized_angles : []);
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : 'Failed to refine idea');
    } finally {
      setRefining(false);
    }
  }, [description, title, companyId, recommendation_context, opportunity_context]);

  const saveToStore = useCallback(() => {
    const validAngle =
      selectedAngle && normalizedAngles.includes(selectedAngle) ? selectedAngle : undefined;
    const spineOut: IdeaSpine = {
      title: title.trim() || 'New campaign idea',
      description: description.trim(),
      origin: recommendation_context ? 'recommendation' : opportunity_context ? 'opportunity' : 'direct',
      source_id: (recommendation_context?.id as string) ?? (opportunity_context?.id as string) ?? null,
      raw_input: description.trim() || undefined,
      refined_title: title.trim() || undefined,
      refined_description: description.trim() || undefined,
      selected_angle: validAngle ?? undefined,
    };
    setIdeaSpine(spineOut);
  }, [title, description, selectedAngle, normalizedAngles, recommendation_context, opportunity_context, setIdeaSpine]);

  useEffect(() => {
    const t = setTimeout(saveToStore, 400);
    return () => clearTimeout(t);
  }, [saveToStore]);

  return (
    <div className="border-b border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700">Campaign Context</span>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronUp className="h-4 w-4 text-gray-500" />
        )}
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 pt-0 space-y-4">
          {companyId && (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => setExpandSuggestions((e) => !e)}
                  className="w-full flex items-center justify-between text-left py-2 text-sm font-semibold text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {expandSuggestions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Target className="h-4 w-4 text-amber-600" />
                    Opportunity Campaign Suggestions
                  </span>
                </button>
                {expandSuggestions && (
                  <div className="pl-6 space-y-2">
                    {appliedSuggestion && <p className="text-xs text-green-600 font-medium">Campaign suggestion applied.</p>}
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
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setExpandInsights((e) => !e)}
                  className="w-full flex items-center justify-between text-left py-2 text-sm font-semibold text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {expandInsights ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Opportunity Insights
                  </span>
                </button>
                {expandInsights && (
                  <div className="pl-6">
                    <OpportunityInsightsTab
                      companyId={companyId}
                      campaignId={campaignId}
                      onApplied={onOpportunityApplied}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Idea / Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveToStore}
              placeholder="e.g. Q2 Thought Leadership on AI Productivity"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveToStore}
              placeholder="Describe your campaign idea, goals, or context..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>
          {normalizedAngles.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Direction</label>
              <div className="flex flex-wrap gap-2">
                {normalizedAngles.map((angle) => (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => {
                      setSelectedAngle(selectedAngle === angle ? null : angle);
                      saveToStore();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                      selectedAngle === angle
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    {angle.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefine}
              disabled={refining || (!description.trim() && !title.trim())}
              className="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-sm font-medium hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {refining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refining...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Refine with AI
                </>
              )}
            </button>
            {refineError && <span className="text-xs text-red-600">{refineError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
