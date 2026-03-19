/**
 * Structure Tab
 * Campaign type, platform content matrix, start date, duration, Generate Skeleton.
 * Calls POST /api/campaigns/ai/plan (generate_plan).
 */

import React, { useState } from 'react';
import { usePlannerSession, type StrategyContext } from '../plannerSessionStore';
import { weeksToCalendarPlan } from '../calendarPlanConverter';
import { CampaignTypeSelector } from '../CampaignTypeSelector';
import { PlatformContentMatrix } from '../PlatformContentMatrix';
import { CAMPAIGN_PRESETS } from '../platformContentPresets';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';

const DURATION_OPTIONS = [1, 2, 4, 6, 8, 10, 12] as const;
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

export interface StructureTabProps {
  companyId?: string | null;
  onGenerate?: () => void;
}

export function StructureTab({ companyId, onGenerate }: StructureTabProps) {
  const { state, setStrategyContext, setPlatformContentRequests, setCampaignStructure, setCalendarPlan } = usePlannerSession();
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

      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
        <input
          type="date"
          value={startDate}
          min={new Date().toISOString().split('T')[0]}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Duration (weeks)</label>
        <select
          value={durationWeeks}
          onChange={(e) => {
            const v = Number(e.target.value) || DEFAULT_DURATION_WEEKS;
            setDurationWeeks(v);
            setStrategyContext({ ...(prev ?? {}), duration_weeks: v });
          }}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        >
          {DURATION_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} week{n === 1 ? '' : 's'}</option>
          ))}
        </select>
      </div>
      <CampaignTypeSelector />
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Campaign Presets</label>
        <div className="flex flex-wrap gap-2">
          {CAMPAIGN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPlatformContentRequests({ ...preset.platform_content_requests })}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <PlatformContentMatrix companyId={companyId} durationWeeks={durationWeeks} />
      {error && <p className="text-sm text-red-600">{error}</p>}
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
