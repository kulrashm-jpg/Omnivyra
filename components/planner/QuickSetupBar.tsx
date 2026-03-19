/**
 * Quick Setup Bar
 * Compact bar rendered above the three setup panels in the Strategy tab.
 * Row 1: Campaign Idea / Title + Description
 * Row 2: Start date | Duration (weeks) | Campaign Goal
 * Writes directly to planner session (idea_spine + strategy_context).
 */

import { useCallback, useEffect, useState } from 'react';
import { usePlannerSession, type IdeaSpine, type StrategyContext } from './plannerSessionStore';
import { MultiSelectDropdown } from '../ui/dropdown';

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
    if (selectedGoals.includes(a) && selectedGoals.includes(b)) {
      return { valid: false, message: 'Selected goals cannot be combined.' };
    }
  }
  return { valid: true };
}

const DEFAULT_DURATION_WEEKS = 6;

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function QuickSetupBar() {
  const { state, setIdeaSpine, setStrategyContext } = usePlannerSession();
  const spine = state.campaign_design?.idea_spine;
  const prev = state.execution_plan?.strategy_context;

  // ── Idea / title / description ──────────────────────────────────────────
  const [title, setTitle] = useState(spine?.refined_title ?? spine?.title ?? '');
  const [description, setDescription] = useState(spine?.refined_description ?? spine?.description ?? '');

  // Sync local fields when spine is updated externally (e.g., AI refine, opportunity prefill)
  useEffect(() => {
    setTitle(spine?.refined_title ?? spine?.title ?? '');
    setDescription(spine?.refined_description ?? spine?.description ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spine?.refined_title, spine?.title, spine?.refined_description, spine?.description]);

  const buildSpine = useCallback(
    (t: string, d: string): IdeaSpine => ({
      title: t.trim() || 'New campaign idea',
      description: d.trim(),
      origin: spine?.origin ?? 'direct',
      source_id: spine?.source_id ?? null,
      raw_input: d.trim() || undefined,
      refined_title: t.trim() || undefined,
      refined_description: d.trim() || undefined,
      selected_angle: spine?.selected_angle ?? undefined,
    }),
    [spine]
  );

  // Debounced save: spine
  useEffect(() => {
    const timer = setTimeout(() => {
      setIdeaSpine(buildSpine(title, description));
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description]);

  // ── Strategy fields ─────────────────────────────────────────────────────
  const durationWeeks = prev?.duration_weeks ?? DEFAULT_DURATION_WEEKS;
  const startDate = (prev?.planned_start_date && /^\d{4}-\d{2}-\d{2}$/.test(prev.planned_start_date))
    ? prev.planned_start_date
    : defaultStartDate();
  const goalList = toGoalArray(prev?.campaign_goal);
  const [goalError, setGoalError] = useState<string | null>(null);

  const handleDurationChange = (v: number) => {
    setStrategyContext({ ...(prev ?? {}), duration_weeks: v } as Partial<StrategyContext>);
  };

  const handleStartDateChange = (v: string) => {
    setStrategyContext({ ...(prev ?? {}), planned_start_date: v } as Partial<StrategyContext>);
  };

  const handleGoalChange = (vals: string[]) => {
    const result = validateGoalCombination(vals);
    if (!result.valid) {
      setGoalError(result.message ?? 'Selected goals cannot be combined.');
      setStrategyContext({ ...(prev ?? {}), campaign_goal: '' } as Partial<StrategyContext>);
      return;
    }
    setGoalError(null);
    setStrategyContext({ ...(prev ?? {}), campaign_goal: vals.filter(Boolean).join(', ') } as Partial<StrategyContext>);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex flex-col gap-3">
      {/* Row 1: Campaign Idea / Title + Description */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-col gap-1 sm:w-1/3">
          <label className="text-xs font-medium text-gray-500">Campaign Idea / Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setIdeaSpine(buildSpine(title, description))}
            placeholder="e.g. Q2 Thought Leadership on AI Productivity"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-gray-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => setIdeaSpine(buildSpine(title, description))}
            placeholder="Describe your campaign idea, goals, or context..."
            rows={2}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>
      </div>

      {/* Row 2: Start date | Duration | Campaign Goal */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-gray-500">Start date</label>
          <input
            type="date"
            value={startDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
          />
        </div>

        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-gray-500">Duration (weeks)</label>
          <select
            value={durationWeeks}
            onChange={(e) => handleDurationChange(Number(e.target.value) || DEFAULT_DURATION_WEEKS)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
          >
            {DURATION_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} week{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-gray-500">Campaign Goal</label>
          <MultiSelectDropdown
            options={CAMPAIGN_GOAL_OPTIONS.map((v) => ({ value: v, label: v }))}
            values={goalList}
            onChange={handleGoalChange}
            placeholder="Select goal(s)…"
            className="w-full"
            size="sm"
          />
          {goalError && <p className="text-xs text-red-600">{goalError}</p>}
        </div>
      </div>
    </div>
  );
}
