/**
 * usePlannerOrchestrationView — Phase-2 Step-15.
 * READ-ONLY fetch of the canonical planner orchestration view. Fail-soft:
 * never throws, never blocks rendering, no mutation.
 */

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { orchestrationUiDiagnostics } from './useOrchestrationDiagnostics';

export interface PlannerOrchestrationView {
  campaign_id: string;
  readiness_summary?: { readiness_score?: number; ready?: boolean } | null;
  execution_summary?: {
    total: number; ready: number; blocked: number;
    pending_assets: number; creator_flows: number; owned_content_flows: number;
  };
  strategy_visibility?: { strategy_present: boolean; skeleton_present: boolean; generation_mode: string };
  orchestration_visibility?: { authoritative_available: boolean; fallback_active: boolean; rollback_active: boolean };
  blockers?: string[];
  metadata?: Record<string, unknown>;
  available?: boolean;
}

export function usePlannerOrchestrationView(campaignId?: string | null) {
  const [view, setView] = useState<PlannerOrchestrationView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaignId) { setView(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/orchestration-planner-view`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setView(data as PlannerOrchestrationView);
        orchestrationUiDiagnostics.planner({
          campaign_id: campaignId,
          hydration_success: true,
          fallback_active: data?.orchestration_visibility?.fallback_active ?? null,
          blocked_count: data?.execution_summary?.blocked ?? null,
          creator_count: data?.execution_summary?.creator_flows ?? null,
          owned_content_count: data?.execution_summary?.owned_content_flows ?? null,
          generation_mode: data?.strategy_visibility?.generation_mode ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) orchestrationUiDiagnostics.fallback({ campaign_id: campaignId, hydration_success: false, surface: 'planner' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaignId]);

  return { view, loading };
}
