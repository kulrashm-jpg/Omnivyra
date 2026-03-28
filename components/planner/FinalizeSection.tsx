/**
 * Finalize Section
 * Generate Preview + Finalize buttons for one-page planner.
 */

import React, { useRef, useState } from 'react';
import { hashMany } from '../../lib/utils/planHash';
import { usePlannerSession } from './plannerSessionStore';
import { weeksToCalendarPlan } from './calendarPlanConverter';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../../config/featureFlags';
import { createCampaignWizardStore } from '../../store/campaignWizardStore';
import { CampaignValidationCard } from './CampaignValidationCard';
import { GrowthStrategyCard } from './GrowthStrategyCard';
import { WhatIfPanel } from './WhatIfPanel';
import type { CampaignValidation } from '../../backend/lib/validation/campaignValidator';
import type { PaidRecommendation } from '../../backend/lib/ads/paidAmplificationEngine';
import type { SimulatorBasePlan } from '../../backend/lib/simulation/scenarioSimulator';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { buildPlannerExecutionHandoff, buildPlannerPrefilledPlanning } from '../../lib/plannerExecutionHandoff';

export interface FinalizeSectionProps {
  companyId?: string | null;
  campaignId?: string | null;
  onFinalize?: (campaignId: string) => void;
  onGeneratePreview?: () => void;
}

export function FinalizeSection({
  companyId,
  campaignId,
  onFinalize,
  onGeneratePreview,
}: FinalizeSectionProps) {
  const { state, setCampaignStructure, setCalendarPlan } = usePlannerSession();
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [campaignValidation, setCampaignValidation] = useState<CampaignValidation | null>(null);
  const [paidRecommendation, setPaidRecommendation] = useState<PaidRecommendation | null>(null);
  const [simBasePlan, setSimBasePlan] = useState<SimulatorBasePlan | null>(null);

  /**
   * Preview result cache — keyed by a stable hash of (stratForApi + spine + companyId).
   * When the user clicks "Generate Preview" with identical inputs, skip the AI call
   * and replay the last result instantly instead of waiting 5–10 s for the AI.
   * Stored in a ref (not state) so it survives re-renders without causing them.
   */
  const previewCacheRef = useRef<{
    key: string;
    weeks: unknown[];
    campaignValidation: CampaignValidation | null;
    paidRecommendation: PaidRecommendation | null;
  } | null>(null);

  const strat = state.execution_plan?.strategy_context;

  /** Normalize strategy_context for API: target_audience string[] → comma-separated string */
  const stratForApi = strat
    ? {
        ...strat,
        target_audience: Array.isArray(strat.target_audience)
          ? strat.target_audience.filter(Boolean).join(', ')
          : (strat.target_audience ?? ''),
      }
    : null;
  const handoff = buildPlannerExecutionHandoff({
    skeleton_confirmed: state.skeleton_confirmed,
    strategy_confirmed: state.strategy_confirmed,
    idea_spine: state.idea_spine ?? null,
    strategy_context: strat ?? null,
    strategic_card: state.strategic_card ?? null,
    strategic_themes: state.strategic_themes ?? [],
    company_context_mode: state.campaign_design?.company_context_mode ?? 'full_company_context',
    focus_modules: state.campaign_design?.focus_modules ?? [],
    platform_content_requests: state.platform_content_requests ?? null,
    calendar_plan: state.execution_plan?.calendar_plan ?? state.calendar_plan ?? null,
  });
  const spine = state.campaign_design?.idea_spine;
  const hasRefinedTitle = Boolean((spine?.refined_title ?? spine?.title ?? '').trim());
  const hasRefinedDescription = Boolean((spine?.refined_description ?? spine?.description ?? '').trim());
  const hasSelectedAngle = Boolean((spine?.selected_angle ?? '').trim());
  const hasStrategy = strat != null;
  const hasDurationWeeks = typeof strat?.duration_weeks === 'number' && strat.duration_weeks > 0;
  const hasPlatforms = Array.isArray(strat?.platforms) && strat.platforms.length > 0;
  const hasPostingFrequency =
    strat?.posting_frequency != null && typeof strat.posting_frequency === 'object' && !Array.isArray(strat.posting_frequency);
  const calendarPlan = state.execution_plan?.calendar_plan ?? state.calendar_plan;
  const hasSkeleton = Array.isArray(calendarPlan?.activities) && calendarPlan.activities.length > 0;
  const hasConfirmedFlow = handoff.skeleton_confirmed && handoff.strategy_confirmed;
  const canFinalize =
    hasConfirmedFlow &&
    hasStrategy &&
    hasRefinedTitle &&
    hasRefinedDescription &&
    hasSelectedAngle &&
    (campaignId || hasSkeleton);
  const canGeneratePreview = canFinalize && hasDurationWeeks && hasPlatforms && hasPostingFrequency;

  const handleGeneratePreview = async () => {
    if (!companyId || !canGeneratePreview) return;

    // ── Cache check ────────────────────────────────────────────────────────
    // Hash the inputs that determine the AI output. If unchanged, replay the
    // last result instantly rather than spending 5–10 s on a redundant AI call.
    const previewKey = hashMany(stratForApi, spine, companyId);
    if (previewKey && previewCacheRef.current?.key === previewKey) {
      const cached = previewCacheRef.current;
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(cached.weeks as Parameters<typeof weeksToCalendarPlan>[0]);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
      setCampaignValidation(cached.campaignValidation);
      setPaidRecommendation(cached.paidRecommendation);
      setSimBasePlan(cached.weeks.length > 0 ? { weeks: cached.weeks as SimulatorBasePlan['weeks'] } : null);
      onGeneratePreview?.();
      return; // skip fetch entirely
    }

    setGenerating(true);
    setFinalizeError(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview_mode: true,
          mode: 'generate_plan',
          message:
            [spine?.refined_title ?? spine?.title, spine?.refined_description ?? spine?.description]
              .filter(Boolean)
              .join('\n\n') || 'Generate campaign plan.',
          companyId,
          idea_spine: spine,
          strategy_context: stratForApi,
          campaign_direction: spine?.selected_angle ?? undefined,
          company_context_mode: handoff.company_context_mode,
          focus_modules: handoff.focus_modules,
          prefilledPlanning: buildPlannerPrefilledPlanning(handoff),
          execution_handoff: handoff,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Preview failed');
      const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
      setCampaignStructure(campaign_structure);
      setCalendarPlan(calendar_plan);
      setCampaignValidation(data?.campaign_validation ?? null);
      setPaidRecommendation(data?.paid_recommendation ?? null);
      setSimBasePlan(weeks.length > 0 ? { weeks } : null);

      // ── Store in cache ───────────────────────────────────────────────────
      if (previewKey) {
        previewCacheRef.current = {
          key: previewKey,
          weeks,
          campaignValidation: data?.campaign_validation ?? null,
          paidRecommendation: data?.paid_recommendation ?? null,
        };
      }

      onGeneratePreview?.();
    } catch {
      setFinalizeError('Could not generate preview.');
    } finally {
      setGenerating(false);
    }
  };

  const handleFinalize = async () => {
    if (!companyId || !canFinalize) {
      if (!companyId) setFinalizeError('Select a company first.');
      else if (!hasConfirmedFlow) setFinalizeError('Confirm both Skeleton and Strategy before finalizing.');
      else if (!hasStrategy) setFinalizeError('Set duration, platforms, and posting frequency in Parameters.');
      else if (!hasRefinedTitle || !hasRefinedDescription) setFinalizeError('Complete Campaign Context with title and description.');
      else if (!hasSelectedAngle) setFinalizeError('Click Refine with AI and select a campaign direction.');
      else setFinalizeError('Complete all required fields before finalizing.');
      return;
    }
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/planner-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          idea_spine: spine,
          strategy_context: stratForApi,
          campaignId: campaignId || undefined,
          source: 'planner',
          // Context snapshot — persisted to campaign_context table at finalize time
          account_context: state.account_context ?? null,
          campaign_validation: campaignValidation ?? null,
          paid_recommendation: paidRecommendation ?? null,
          execution_handoff: handoff,
          ...(calendarPlan ? { calendar_plan: calendarPlan } : {}),
          ...(ENABLE_UNIFIED_CAMPAIGN_WIZARD
            ? {
                cross_platform_sharing: {
                  enabled: createCampaignWizardStore(campaignId ?? undefined).getState().crossPlatformSharingEnabled,
                  mode: 'shared' as const,
                },
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Finalize failed');
      const cid = data?.campaign_id;
      if (cid) {
        onFinalize?.(cid);
        window.location.href = `/campaign-calendar/${cid}`;
      }
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Failed to finalize');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div className="pt-4 border-t border-gray-200 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Create Campaign</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Set Campaign Context, then Parameters (duration, platforms, frequency). Generate a preview, then finalize.
          </p>
        </div>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={finalizing || !companyId || !canFinalize}
          className="flex-shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {finalizing ? 'Finalizing...' : 'Finalize Campaign Plan'}
        </button>
      </div>
      {canGeneratePreview && companyId && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGeneratePreview}
            disabled={generating}
            className="px-4 py-2 rounded-lg border border-indigo-300 text-indigo-700 text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Preview'}
          </button>
        </div>
      )}
      {finalizeError && <p className="text-xs text-red-600">{finalizeError}</p>}
      {campaignValidation && (
        <CampaignValidationCard validation={campaignValidation} />
      )}
      {paidRecommendation && (
        <GrowthStrategyCard recommendation={paidRecommendation} />
      )}
      {campaignValidation && paidRecommendation && simBasePlan && strat && (
        <WhatIfPanel
          basePlan={simBasePlan}
          baseValidation={campaignValidation}
          basePaidRecommendation={paidRecommendation}
          accountContext={state.account_context ?? null}
          strategyContext={{
            duration_weeks: strat.duration_weeks,
            platforms: strat.platforms ?? [],
            posting_frequency: strat.posting_frequency ?? {},
            content_mix: Array.isArray(strat.content_mix)
              ? Object.fromEntries(strat.content_mix.map((ct: string) => [ct, 1]))
              : (strat.content_mix as Record<string, number> | null | undefined) ?? null,
            campaign_goal: strat.campaign_goal ?? null,
          }}
        />
      )}
    </div>
  );
}
