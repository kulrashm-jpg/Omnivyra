/**
 * Create Campaign & Build Content
 *
 * Campaign-level action shown after the theme + daily plan. Persists the
 * skeleton + strategy + daily-plan into a real campaign blueprint via the
 * existing /api/campaigns/planner-finalize pipeline (same one BOLT uses) so
 * each activity becomes a resolvable Activity Workspace row.
 *
 * Unlike FinalizeSection it does NOT redirect — it keeps the user in the
 * planner and stores the returned campaign_id so the per-slot "Activity
 * Workspace" buttons resolve the real BOLT/creator structure.
 */

import { useState } from 'react';
import { Loader2, Rocket, CheckCircle2 } from 'lucide-react';
import { usePlannerSession } from './plannerSessionStore';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { buildPlannerExecutionHandoff } from '../../lib/plannerExecutionHandoff';

export function CreateCampaignAndBuild({
  companyId,
  campaignId,
}: {
  companyId?: string | null;
  campaignId?: string | null;
}) {
  const { state, setSourceIds, confirmSkeleton, confirmStrategy } = usePlannerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistedId = state.source_ids?.campaign_id ?? campaignId ?? null;
  const alreadyBuilt = Boolean(persistedId);

  async function handleCreate() {
    if (busy) return;
    if (!companyId) { setError('Select a company first.'); return; }
    const spine = state.campaign_design?.idea_spine ?? state.idea_spine ?? null;
    const strat = state.execution_plan?.strategy_context ?? state.strategy_context ?? null;
    const calendarPlan = state.execution_plan?.calendar_plan ?? state.calendar_plan ?? null;
    if (!spine || !((spine.refined_title ?? spine.title ?? '').trim())) {
      setError('Complete the plan (idea/goal/audience) before building content.');
      return;
    }
    if (!calendarPlan?.activities?.length) {
      setError('Generate a skeleton so there are activities to build.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stratForApi = strat
        ? {
            ...strat,
            target_audience: Array.isArray(strat.target_audience)
              ? strat.target_audience.filter(Boolean).join(', ')
              : (strat.target_audience ?? ''),
          }
        : null;
      // The action itself is the explicit commit (soft-gating elsewhere), so
      // send a confirmed handoff — planner-finalize hard-requires both flags.
      const handoff = buildPlannerExecutionHandoff({
        skeleton_confirmed: true,
        strategy_confirmed: true,
        idea_spine: spine,
        strategy_context: strat,
        strategic_card: state.strategic_card ?? null,
        strategic_themes: state.strategic_themes ?? [],
        company_context_mode: state.campaign_design?.company_context_mode ?? 'full_company_context',
        focus_modules: state.campaign_design?.focus_modules ?? [],
        platform_content_requests: state.platform_content_requests ?? null,
        calendar_plan: calendarPlan,
      });
      const res = await fetchWithAuth('/api/campaigns/planner-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          idea_spine: spine,
          strategy_context: stratForApi,
          campaignId: persistedId || undefined,
          source: 'planner',
          account_context: state.account_context ?? null,
          execution_handoff: handoff,
          calendar_plan: calendarPlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not build the campaign');
      const cid = data?.campaign_id;
      if (!cid) throw new Error('No campaign id returned');
      confirmSkeleton();
      confirmStrategy();
      setSourceIds({ campaign_id: cid });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the campaign');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleCreate}
        disabled={busy}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
          alreadyBuilt
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
        }`}
        title={
          alreadyBuilt
            ? 'Campaign is built — Activity Workspace is live. Re-run to re-sync edits.'
            : 'Persist the plan so each slot opens the full Activity Workspace'
        }
      >
        {busy ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Building campaign…</>
        ) : alreadyBuilt ? (
          <><CheckCircle2 className="h-4 w-4" />Campaign built — re-sync</>
        ) : (
          <><Rocket className="h-4 w-4" />Create campaign &amp; build content</>
        )}
      </button>
      {alreadyBuilt && !busy && (
        <span className="text-[11px] text-emerald-700">
          Activity Workspace is live for every slot below.
        </span>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
