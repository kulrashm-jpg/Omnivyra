/**
 * Calendar Planner Step
 * Displays weekly/daily structure preview from ai/plan or retrieve-plan API.
 * Finalize action: commit planner session, generate plan, run weekly structure, redirect to campaign calendar.
 */

import React, { useEffect, useState } from 'react';
import { usePlannerSession } from './plannerSessionStore';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../../config/featureFlags';
import { createCampaignWizardStore } from '../../store/campaignWizardStore';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

export interface CalendarPlannerStepProps {
  /** Plan from retrieve-plan API (when campaignId exists) */
  retrievePlanUrl?: string | null;
  /** Company ID for API calls and finalize */
  companyId?: string | null;
  /** Campaign ID for retrieve-plan (when editing existing) */
  campaignId?: string | null;
  /** Called after successful finalize with campaign_id for redirect */
  onFinalize?: (campaignId: string) => void;
  /** Increment to trigger plan refetch (e.g. after applying opportunity) */
  refreshTrigger?: number;
}

export function CalendarPlannerStep({
  retrievePlanUrl,
  companyId,
  campaignId,
  onFinalize,
  refreshTrigger = 0,
}: CalendarPlannerStepProps) {
  const { state, setCampaignStructure, setCalendarPlan } = usePlannerSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const calendarPlan = state.execution_plan?.calendar_plan;
  const planPreview = calendarPlan ? { weeks: calendarPlan.weeks } : null;

  useEffect(() => {
    if (campaignId && companyId) {
      setLoading(true);
      setError(null);
      fetch(
        `/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`,
        { credentials: 'include' }
      )
        .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to load plan')))
        .then((data) => {
          const weeks =
            data?.committedPlan?.weeks ??
            data?.draftPlan?.weeks ??
            data?.weeks ??
            [];
          (() => {
            const result = weeksToCalendarPlan(weeks);
            setCampaignStructure(result.campaign_structure);
            setCalendarPlan(result.calendar_plan);
          })();
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : 'Could not load plan preview');
          setCampaignStructure(null);
          setCalendarPlan(null);
        })
        .finally(() => setLoading(false));
      return;
    }
    setCalendarPlan(null);
  }, [campaignId, companyId, refreshTrigger, setCampaignStructure, setCalendarPlan]);

  const handleGeneratePreview = async () => {
    if (!companyId || !canGeneratePreview) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview_mode: true,
          mode: 'generate_plan',
          message:
            [state.campaign_design?.idea_spine?.refined_title, state.campaign_design?.idea_spine?.refined_description]
              .filter(Boolean)
              .join('\n\n') || 'Generate campaign plan.',
          companyId,
          idea_spine: state.campaign_design?.idea_spine,
          strategy_context: state.execution_plan?.strategy_context,
          campaign_direction: state.campaign_design?.idea_spine?.selected_angle ?? undefined,
          company_context_mode: state.campaign_design?.company_context_mode ?? 'full_company_context',
          focus_modules: state.campaign_design?.focus_modules,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Preview failed');
      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate preview');
      setCampaignStructure(null);
      setCalendarPlan(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-gray-500">
        Loading plan preview...
      </div>
    );
  }

  if (error && !planPreview?.weeks?.length) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
        <p className="text-sm font-medium">No plan preview available</p>
        <p className="text-xs mt-1">{error}</p>
        <p className="text-xs mt-2 text-amber-600">
          Generate a plan in campaign details to see a preview here.
        </p>
      </div>
    );
  }

  const weeks = planPreview?.weeks ?? [];
  const hasStrategy = state.execution_plan?.strategy_context != null;
  const strat = state.execution_plan?.strategy_context;
  const hasDurationWeeks = typeof strat?.duration_weeks === 'number' && strat.duration_weeks > 0;
  const hasPlatforms = Array.isArray(strat?.platforms) && strat.platforms.length > 0;
  const hasPostingFrequency =
    strat?.posting_frequency != null && typeof strat.posting_frequency === 'object' && !Array.isArray(strat.posting_frequency);
  const spine = state.campaign_design?.idea_spine;
  const hasRefinedTitle = Boolean((spine?.refined_title ?? '').trim());
  const hasRefinedDescription = Boolean((spine?.refined_description ?? '').trim());
  const hasSelectedAngle = Boolean((spine?.selected_angle ?? '').trim());
  const canFinalize = hasStrategy && hasRefinedTitle && hasRefinedDescription && hasSelectedAngle;
  const canGeneratePreview =
    canFinalize && hasDurationWeeks && hasPlatforms && hasPostingFrequency;

  const handleFinalize = async () => {
    if (!companyId || !canFinalize) {
      if (!companyId) {
        setFinalizeError('Select a company first.');
      } else if (!hasStrategy) {
        setFinalizeError('Complete the strategy step first.');
      } else if (!hasRefinedTitle || !hasRefinedDescription) {
        setFinalizeError('Complete the idea spine step with title and description.');
      } else if (!hasSelectedAngle) {
        setFinalizeError('Select a campaign direction angle in the idea spine step.');
      } else {
        setFinalizeError('Complete all required steps before finalizing.');
      }
      return;
    }
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const res = await fetch('/api/campaigns/planner-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          companyId,
          idea_spine: state.campaign_design?.idea_spine,
          strategy_context: state.execution_plan?.strategy_context,
          campaignId: campaignId || undefined,
          ...(ENABLE_UNIFIED_CAMPAIGN_WIZARD
            ? (() => {
                const wizard = createCampaignWizardStore(campaignId ?? undefined).getState();
                return {
                  cross_platform_sharing: {
                    enabled: wizard.crossPlatformSharingEnabled,
                    mode: wizard.crossPlatformSharingEnabled ? 'shared' : 'unique',
                  },
                };
              })()
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Finalize failed');
      }
      const cid = data?.campaign_id;
      if (cid && onFinalize) {
        onFinalize(cid);
      } else if (cid) {
        window.location.href = `/campaign-calendar/${cid}`;
      }
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Failed to finalize');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Plan Preview</h2>
        <p className="text-sm text-gray-500 mt-1">
          {weeks.length > 0 ? 'Preview of weekly structure.' : 'Complete the strategy step to finalize.'}
        </p>
      </div>

      {weeks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
          <p className="text-sm">No plan data yet.</p>
          <p className="text-xs mt-2">
            {canGeneratePreview && companyId
              ? 'Generate a preview or click Finalize to create your campaign.'
              : 'Complete the idea spine and strategy steps (platforms, posting frequency), then generate a preview or finalize.'}
          </p>
          {canGeneratePreview && companyId && (
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={loading}
              className="mt-4 px-4 py-2 rounded-lg border border-indigo-300 text-indigo-700 font-medium hover:bg-indigo-50 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Preview'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {weeks.slice(0, 12).map((week: {
            week?: number; theme?: string; phase_label?: string;
            primary_objective?: string; summary?: string;
            objectives?: string[]; cta_type?: string;
          }, i: number) => {
            const weekNum = week?.week ?? i + 1;
            const themeLabel = week?.theme ?? '';
            const phaseLabel = week?.phase_label ?? '';
            // Find matching strategic theme entry for rich metadata
            const matchingTheme = (state.strategic_themes ?? []).find((t) => t.week === weekNum);
            const objective = week?.primary_objective ?? matchingTheme?.objective ?? (week?.objectives?.[0] ?? '');
            const contentFocus = matchingTheme?.content_focus ?? '';
            const ctaFocus = week?.cta_type ?? matchingTheme?.cta_focus ?? '';
            const WEEK_COLORS = [
              'bg-indigo-50 border-indigo-200',
              'bg-violet-50 border-violet-200',
              'bg-sky-50 border-sky-200',
              'bg-emerald-50 border-emerald-200',
              'bg-amber-50 border-amber-200',
              'bg-rose-50 border-rose-200',
            ];
            const colorClass = WEEK_COLORS[i % WEEK_COLORS.length];
            return (
              <div
                key={weekNum}
                className={`rounded-xl border p-4 shadow-sm ${colorClass}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Week {weekNum}</span>
                  {phaseLabel && (
                    <span className="text-[10px] font-semibold text-gray-500 bg-white/70 border border-gray-200 px-2 py-0.5 rounded-full">
                      {phaseLabel}
                    </span>
                  )}
                </div>
                {themeLabel && (
                  <p className="text-sm font-semibold text-gray-900 leading-snug mb-2">{themeLabel}</p>
                )}
                {objective && (
                  <p className="text-xs text-gray-600 leading-relaxed mb-1.5">{objective}</p>
                )}
                {(contentFocus || ctaFocus) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {contentFocus && (
                      <span className="text-[10px] text-gray-500 bg-white/60 border border-gray-200 rounded px-2 py-0.5">
                        {contentFocus}
                      </span>
                    )}
                    {ctaFocus && (
                      <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5">
                        CTA: {ctaFocus}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-6 border-t border-gray-200">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Finalize Campaign Plan</h3>
        <p className="text-sm text-gray-500 mb-4">
          Create campaign, generate weekly structure, and open the campaign calendar.
        </p>
        {finalizeError && (
          <p className="text-sm text-red-600 mb-4">{finalizeError}</p>
        )}
        <button
          type="button"
          onClick={handleFinalize}
          disabled={finalizing || !companyId || !canFinalize}
          className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {finalizing ? (
            <>
              <span className="animate-spin">⟳</span>
              Finalizing...
            </>
          ) : (
            'Finalize Campaign Plan'
          )}
        </button>
      </div>
    </div>
  );
}
