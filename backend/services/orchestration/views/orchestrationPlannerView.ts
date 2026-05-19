/**
 * orchestrationPlannerView — Phase-2 Step-14. READ-ONLY planner feed.
 */

import { buildPlannerExecutionView, type PlannerExecutionView } from './orchestrationViewMapper';
import { viewDiagnostics } from './orchestrationViewDiagnostics';

export async function getPlannerExecutionView(
  campaignId: string,
): Promise<PlannerExecutionView | null> {
  if (!campaignId) return null;
  try {
    const view = await buildPlannerExecutionView(campaignId);
    viewDiagnostics.planner({
      campaign_id: campaignId,
      readiness_score: (view.readiness_summary as { readiness_score?: number } | null)?.readiness_score ?? null,
      blocked_count: view.execution_summary.blocked,
      creator_count: view.execution_summary.creator_flows,
      owned_content_count: view.execution_summary.owned_content_flows,
      fallback_active: view.orchestration_visibility.fallback_active,
      rollback_active: view.orchestration_visibility.rollback_active,
    });
    if (view.blockers.length > 0) {
      viewDiagnostics.blocker({ campaign_id: campaignId, blocked_count: view.execution_summary.blocked, blockers: view.blockers });
    }
    if (view.orchestration_visibility.fallback_active || view.orchestration_visibility.rollback_active) {
      viewDiagnostics.fallbackVisibility({
        campaign_id: campaignId,
        fallback_active: view.orchestration_visibility.fallback_active,
        rollback_active: view.orchestration_visibility.rollback_active,
        authoritative_available: view.orchestration_visibility.authoritative_available,
      });
    }
    return view;
  } catch {
    return null;
  }
}
