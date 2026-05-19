/**
 * useAIAssetMutation — Phase-2 Step-22.
 *
 * Wires Remove / Restore / (mark) Upload / (mark) Replace to the REAL
 * orchestration mutation endpoint (/api/campaigns/[id]/ai-asset-mutation →
 * canonical write → state synchronization → readiness recalculation).
 *
 * Flow: optimistic local patch (instant card transition) → POST → on
 * success invalidate+revalidate the scoped feed (server truth) → on
 * failure revalidate to roll the optimistic patch back. Never throws.
 *
 * Upload/Replace REQUIRE an asset payload (url/files) supplied by the host
 * (the existing workspace upload pipeline) — this hook records the override
 * state + lineage; it does NOT add a file picker to the legacy card (that
 * would be a forbidden redesign).
 */

import { useCallback, useState } from 'react';
import { fetchWithAuth } from '../../../community-ai/fetchWithAuth';
import { invalidate, patchProjection, revalidate } from './aiAssetLiveRefresh';
import { aiAssetMutationDiagnostics } from './aiAssetMutationDiagnostics';

type Action = 'remove' | 'restore' | 'mark_uploaded' | 'mark_replaced';
export interface AssetOverridePayload {
  url?: string;
  files?: string[];
  thumbnail?: string;
  asset_id?: string;
}

const OPTIMISTIC: Record<Action, Record<string, unknown>> = {
  remove: { asset_state: 'USER_REMOVED', fallback_mode: true },
  restore: { asset_state: 'AI_GENERATED', fallback_mode: false },
  mark_uploaded: { asset_state: 'USER_UPLOADED', fallback_mode: false },
  mark_replaced: { asset_state: 'USER_REPLACED', fallback_mode: false },
};

export function useAIAssetMutation(
  campaignId?: string | null,
  executionId?: string | null,
) {
  const [pending, setPending] = useState<Action | null>(null);

  const run = useCallback(
    async (action: Action, asset?: AssetOverridePayload): Promise<boolean> => {
      if (!campaignId || !executionId) return false;
      setPending(action);
      const before = action;
      // 1. Optimistic transition (instant, no reload).
      patchProjection(campaignId, executionId, OPTIMISTIC[action]);
      const ev =
        action === 'remove' ? aiAssetMutationDiagnostics.remove
        : action === 'restore' ? aiAssetMutationDiagnostics.restore
        : aiAssetMutationDiagnostics.upload;
      ev({
        campaign_id: campaignId, execution_id: executionId,
        mutation_type: action, asset_state_before: before, optimistic: true,
      });
      try {
        const r = await fetchWithAuth(
          `/api/campaigns/${encodeURIComponent(campaignId)}/ai-asset-mutation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ execution_id: executionId, action, asset: asset ?? {} }),
          },
        );
        const ok = r.ok;
        aiAssetMutationDiagnostics.mutation({
          campaign_id: campaignId, execution_id: executionId,
          mutation_type: action, hydration_success: ok,
        });
        // 2. Server truth — invalidate+revalidate on success; on failure a
        //    plain revalidate rolls the optimistic patch back.
        if (ok) await invalidate(campaignId, executionId, `mutation:${action}`);
        else await revalidate(campaignId, `rollback:${action}`);
        return ok;
      } catch {
        aiAssetMutationDiagnostics.refreshFail({
          campaign_id: campaignId, execution_id: executionId,
          mutation_type: action, hydration_success: false,
        });
        await revalidate(campaignId, `rollback:${action}`).catch(() => {});
        return false;
      } finally {
        setPending(null);
      }
    },
    [campaignId, executionId],
  );

  return {
    pending,
    removeAi: useCallback(() => run('remove'), [run]),
    restoreAi: useCallback(() => run('restore'), [run]),
    markUploaded: useCallback((a: AssetOverridePayload) => run('mark_uploaded', a), [run]),
    markReplaced: useCallback((a: AssetOverridePayload) => run('mark_replaced', a), [run]),
  };
}
