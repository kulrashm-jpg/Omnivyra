/**
 * Strategic Mix P5/P6 — the shared execution-sync hook.
 *
 * One implementation for every surface that shows synchronized lifecycle
 * state (Alignment workspace, Campaign Board): on first load per campaign it
 * (1) RECOVERS assignments from the campaign's draft snapshot when the local
 * session is empty (campaign reload / another device), then (2) folds the
 * engine's execution events onto them via the pure reducer. `sync()` is also
 * returned for user-initiated refresh — there are no timers and no polling
 * anywhere; the reducer's idempotence makes repeated calls safe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { applyExecutionEvents, type ExecutionEvent } from '../../lib/campaign/assignmentExecutionSync';
import { normalizeAssignments, type CampaignAssignment } from '../../lib/campaign/campaignAssignments';

type SetAssignments = (
  next: CampaignAssignment[] | ((current: CampaignAssignment[]) => CampaignAssignment[]),
) => void;

export function useAssignmentExecutionSync(params: {
  campaignId: string | null | undefined;
  assignments: CampaignAssignment[];
  setAssignments: SetAssignments;
}): { sync: () => Promise<void>; lastSyncAt: string | null } {
  const { campaignId, assignments, setAssignments } = params;
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (!campaignId) return;
    try {
      const res = await fetchWithAuth(
        `/api/campaigns/${encodeURIComponent(campaignId)}/assignment-execution-events`,
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const events: ExecutionEvent[] = Array.isArray(data?.events) ? data.events : [];
      if (events.length > 0) {
        setAssignments((current) => applyExecutionEvents(current, events).assignments);
      }
      setLastSyncAt(new Date().toISOString());
    } catch { /* offline — the next open or manual refresh re-derives */ }
  }, [campaignId, setAssignments]);

  const bootstrappedForRef = useRef<string | null>(null);
  const hasLocalAssignments = assignments.length > 0;
  useEffect(() => {
    if (!campaignId || bootstrappedForRef.current === campaignId) return;
    bootstrappedForRef.current = campaignId;
    let cancelled = false;
    (async () => {
      try {
        if (!hasLocalAssignments) {
          const res = await fetchWithAuth(
            `/api/campaigns/${encodeURIComponent(campaignId)}/planner-draft-state`,
          );
          if (res.ok) {
            const data = await res.json().catch(() => null);
            const recovered = normalizeAssignments(
              (data?.planner_state as { assignments?: unknown } | null)?.assignments,
            );
            if (!cancelled && recovered.length > 0) {
              setAssignments((current) => (current.length > 0 ? current : recovered));
            }
          }
        }
      } catch { /* recovery is best-effort */ }
      if (!cancelled) await sync();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  return { sync, lastSyncAt };
}
