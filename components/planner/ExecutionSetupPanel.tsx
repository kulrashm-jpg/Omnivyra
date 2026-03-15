/**
 * Execution Setup Panel
 * Start Date + Duration, Campaign Goal, Opportunity sections, Platform Content Matrix, Generate Skeleton.
 * Campaign Type moved to CampaignContextBar.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Target } from 'lucide-react';
import { usePlannerSession, type StrategyContext } from './plannerSessionStore';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { PlatformContentMatrix } from './PlatformContentMatrix';
import { MultiSelectDropdown } from '../ui/dropdown';
import { OpportunityInsightsTab } from './OpportunityInsightsTab';
import styles from '../../styles/planner-layout.module.css';

function toGoalArray(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim());
  const s = String(val).trim();
  if (!s) return [];
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

const DURATION_OPTIONS = [1, 2, 4, 6, 8, 10, 12] as const;

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

const GOAL_INCOMPATIBLE_PAIRS: [string, string][] = [
  ['Brand Awareness', 'Thought Leadership'],
  ['Lead Generation', 'Product Launch'],
  ['Customer Retention', 'Community Growth'],
];

function validateGoalCombination(selectedGoals: string[]): { valid: boolean; message?: string } {
  if (selectedGoals.length <= 1) return { valid: true };
  for (const [a, b] of GOAL_INCOMPATIBLE_PAIRS) {
    const hasA = selectedGoals.includes(a);
    const hasB = selectedGoals.includes(b);
    if (hasA && hasB) {
      return { valid: false, message: 'Selected goals cannot be combined.' };
    }
  }
  return { valid: true };
}
const DEFAULT_DURATION_WEEKS = 6;

function deriveStrategyFromMatrix(
  platform_content_requests: Record<string, Record<string, number>> | null,
  duration_weeks: number,
  startDate: string,
  prev: StrategyContext | null | undefined
): StrategyContext | null {
  if (!platform_content_requests || Object.keys(platform_content_requests).length === 0) return null;
  const platforms = Object.keys(platform_content_requests);
  const posting_frequency: Record<string, number> = {};
  const contentSet = new Set<string>();
  for (const [p, ctMap] of Object.entries(platform_content_requests)) {
    let sum = 0;
    for (const [ct, count] of Object.entries(ctMap)) {
      if (count > 0) {
        sum += count;
        contentSet.add(ct);
      }
    }
    posting_frequency[p] = sum;
  }
  return {
    duration_weeks,
    platforms,
    posting_frequency,
    content_mix: Array.from(contentSet),
    campaign_goal: prev?.campaign_goal ?? '',
    target_audience: prev?.target_audience ?? '',
    planned_start_date: startDate,
  };
}

type CampaignSuggestion = {
  id: string;
  topic: string;
  opportunity_score: number | null;
  suggested_campaign_title: string;
  suggested_duration: number;
  themes: { week: number; title: string }[];
};

export interface ExecutionSetupPanelProps {
  companyId?: string | null;
  campaignId?: string | null;
  onGenerate?: () => void;
  onOpportunityApplied?: () => void;
}

export function ExecutionSetupPanel({ companyId, campaignId, onGenerate, onOpportunityApplied }: ExecutionSetupPanelProps) {
  const {
    state,
    setStrategyContext,
    setPlatformContentRequests,
    setCampaignStructure,
    setCalendarPlan,
    setIdeaSpine,
    setStrategicThemes,
    setSourceIds,
    setPlannerEntryMode,
  } = usePlannerSession();
  const prev = state.execution_plan?.strategy_context;

  const [startDate, setStartDate] = useState(() => {
    const fromPrev = prev?.planned_start_date && /^\d{4}-\d{2}-\d{2}$/.test(prev.planned_start_date) ? prev.planned_start_date : null;
    if (fromPrev) return fromPrev;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [durationWeeks, setDurationWeeks] = useState(prev?.duration_weeks ?? DEFAULT_DURATION_WEEKS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const [expandSuggestions, setExpandSuggestions] = useState(false);
  const [expandInsights, setExpandInsights] = useState(false);

  const campaignGoalList = toGoalArray(prev?.campaign_goal);
  const [goalError, setGoalError] = useState<string | null>(null);

  const applyGoals = (selected: string[]) => {
    const result = validateGoalCombination(selected);
    if (!result.valid) {
      setGoalError(result.message ?? 'Selected goals cannot be combined.');
      setStrategyContext({ ...(prev ?? {}), campaign_goal: '' } as Partial<StrategyContext>);
      return;
    }
    setGoalError(null);
    const goalStr = selected.filter(Boolean).join(', ');
    setStrategyContext({ ...(prev ?? {}), campaign_goal: goalStr } as Partial<StrategyContext>);
  };

  React.useEffect(() => {
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
        if (!cancelled) {
          const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
          setSuggestions(raw as CampaignSuggestion[]);
        }
      })
      .catch((err) => {
        if (!cancelled) setSuggestionsError(err instanceof Error ? err.message : 'Failed to load suggestions.');
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  React.useEffect(() => {
    if (suggestions.length > 0) setExpandSuggestions(true);
  }, [suggestions.length]);

  const handleApplySuggestion = (s: CampaignSuggestion) => {
    const base = prev ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setIdeaSpine({
      title: s.topic,
      description: s.suggested_campaign_title,
      origin: 'opportunity',
      source_id: s.id,
      refined_title: s.suggested_campaign_title,
      refined_description: s.topic,
    });
    setStrategyContext({ ...base, duration_weeks: s.suggested_duration });
    setStrategicThemes(s.themes);
    setSourceIds({ source_opportunity_id: s.id, opportunity_score: s.opportunity_score ?? undefined });
    setPlannerEntryMode('opportunity');
    setAppliedSuggestion(s.id);
    onOpportunityApplied?.();
  };

  const platform_content_requests = state.platform_content_requests ?? null;
  const hasMatrix = platform_content_requests && Object.keys(platform_content_requests).length > 0;
  const strategyFromMatrix = deriveStrategyFromMatrix(platform_content_requests, durationWeeks, startDate, prev);
  const isValid = durationWeeks > 0 && !!strategyFromMatrix && strategyFromMatrix.platforms.length > 0;

  const handleSubmit = async () => {
    if (!isValid || !strategyFromMatrix) return;

    setStrategyContext(strategyFromMatrix);

    if (!companyId) {
      setError('Select a company first.');
      return;
    }

    const spine = state.campaign_design?.idea_spine;
    const hasIdea = Boolean((spine?.refined_title ?? spine?.title ?? '').trim()) || Boolean((spine?.refined_description ?? spine?.description ?? '').trim());
    if (!hasIdea) {
      setError('Complete Campaign Context (idea/title and description) first.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const stratForApi = strategyFromMatrix
        ? {
            ...strategyFromMatrix,
            target_audience: Array.isArray(strategyFromMatrix.target_audience)
              ? strategyFromMatrix.target_audience.filter(Boolean).join(', ')
              : (strategyFromMatrix.target_audience ?? ''),
          }
        : null;
      const body: Record<string, unknown> = {
        preview_mode: true,
        mode: 'generate_plan',
        message:
          [spine?.refined_title ?? spine?.title, spine?.refined_description ?? spine?.description].filter(Boolean).join('\n\n') ||
          'Generate campaign plan.',
        companyId,
        idea_spine: spine,
        strategy_context: stratForApi,
        campaign_direction: spine?.selected_angle ?? 'EDUCATION',
        company_context_mode: state.campaign_design?.company_context_mode ?? 'full_company_context',
        focus_modules: state.campaign_design?.focus_modules,
        campaign_type: state.campaign_type ?? 'TEXT',
      };
      if (platform_content_requests && Object.keys(platform_content_requests).length > 0) {
        body.platform_content_requests = platform_content_requests;
      }
      if (state.strategic_themes && state.strategic_themes.length > 0) {
        body.prefilledPlanning = { strategic_themes: state.strategic_themes.map((t) => t.title) };
      }

      const res = await fetch('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Preview failed');
      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
      onGenerate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-sm font-semibold text-gray-900">Execution Setup</h3>

      <div className={styles.rowTwoFields}>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Start date</label>
          <input
            type="date"
            value={startDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Duration (weeks)</label>
          <select
            value={durationWeeks}
            onChange={(e) => {
              const v = Number(e.target.value) || DEFAULT_DURATION_WEEKS;
              setDurationWeeks(v);
              setStrategyContext({ ...(prev ?? {}), duration_weeks: v } as Partial<StrategyContext>);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
          >
            {DURATION_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} week{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Campaign Goal</label>
        <MultiSelectDropdown
          options={CAMPAIGN_GOAL_OPTIONS.map((v) => ({ value: v, label: v }))}
          values={campaignGoalList}
          onChange={(vals) => {
            const result = validateGoalCombination(vals);
            const base = prev ?? { duration_weeks: 6, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
            if (!result.valid) {
              setGoalError(result.message ?? 'Selected goals cannot be combined.');
              setStrategyContext({ ...(prev ?? {}), campaign_goal: '' } as Partial<StrategyContext>);
              return;
            }
            setGoalError(null);
            setStrategyContext({ ...(prev ?? {}), campaign_goal: vals.filter(Boolean).join(', ') } as Partial<StrategyContext>);
          }}
          placeholder="Select goal(s)…"
          className="w-full border border-gray-300 rounded-lg"
        />
        {goalError && <p className="text-xs text-red-600 mt-1">{goalError}</p>}
      </div>

      <PlatformContentMatrix companyId={companyId} durationWeeks={durationWeeks} />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || loading}
        className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Skeleton'}
      </button>
    </div>
  );
}
