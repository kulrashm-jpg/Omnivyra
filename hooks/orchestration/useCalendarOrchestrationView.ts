/**
 * useCalendarOrchestrationView — Phase-2 Step-15.
 * READ-ONLY fetch of the canonical calendar orchestration view. Fail-soft.
 */

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { orchestrationUiDiagnostics } from './useOrchestrationDiagnostics';
import type { AIAssetProjectionLike } from '../../components/orchestration/assets';

export interface CalendarOrchestrationItem {
  execution_id: string;
  activity_type: string;
  workflow_type: string;
  readiness_state: string;
  creator_state: string;
  scheduling_state: string;
  owned_content_state: string;
  platform: string;
  day_projection?: { week_id: string; day: string };
  orchestration_flags?: {
    blocked: boolean; pending_asset: boolean;
    approval_required: boolean; authoritative_generated: boolean;
  };
  /** Phase-2 Step-20: real AI-asset projection (null = video/manual). */
  ai_asset?: AIAssetProjectionLike | null;
}

export function useCalendarOrchestrationView(campaignId?: string | null) {
  const [items, setItems] = useState<CalendarOrchestrationItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaignId) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/orchestration-calendar-view`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list: CalendarOrchestrationItem[] = Array.isArray(data?.items) ? data.items : [];
        setItems(list);
        orchestrationUiDiagnostics.calendar({
          campaign_id: campaignId,
          hydration_success: true,
          execution_count: list.length,
          blocked_count: list.filter((i) => i.orchestration_flags?.blocked).length,
          creator_count: list.filter((i) => i.creator_state && i.creator_state !== 'NONE').length,
          owned_content_count: list.filter((i) => i.owned_content_state && i.owned_content_state !== 'NONE').length,
        });
      })
      .catch(() => {
        if (!cancelled) orchestrationUiDiagnostics.fallback({ campaign_id: campaignId, hydration_success: false, surface: 'calendar' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaignId]);

  return { items, loading };
}
