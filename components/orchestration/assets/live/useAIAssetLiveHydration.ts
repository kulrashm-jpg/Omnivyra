/**
 * useAIAssetLiveHydration — Phase-2 Step-22.
 *
 * Live, fail-soft replacement for the Step-21 static resolver. Subscribes
 * to the scoped feed store so a card re-renders the moment its execution's
 * projection changes (post-mutation / post-autogen / focus revalidation) —
 * WITHOUT a planner/calendar reload and WITHOUT a polling loop.
 *
 * Resolution: inline blob `ai_asset` is the initial value while the store
 * loads; once the store is loaded it is authoritative (it reflects real
 * mutations). Returns undefined while first-loading, null when none /
 * video / manual (fail-soft → legacy card unchanged).
 */

import { useEffect, useRef, useState } from 'react';
import {
  getFeed,
  peekProjection,
  revalidate,
  subscribe,
} from './aiAssetLiveRefresh';
import { useOrchestrationEvents } from './events';
import type { AIAssetProjectionLike } from '../AIAssetPreview';

function readInline(blob: Record<string, unknown> | null | undefined): AIAssetProjectionLike | null {
  if (!blob || typeof blob !== 'object') return null;
  const ai = (blob as { ai_asset?: unknown }).ai_asset;
  return ai && typeof ai === 'object' ? (ai as AIAssetProjectionLike) : null;
}

export function useAIAssetLiveHydration(
  campaignId?: string | null,
  executionId?: string | null,
  inlineBlob?: Record<string, unknown> | null,
): AIAssetProjectionLike | null | undefined {
  const inline = readInline(inlineBlob);
  const [value, setValue] = useState<AIAssetProjectionLike | null | undefined>(
    inline ?? undefined,
  );
  // Step-23: open the shared server-push channel for this campaign. The
  // hydrator invalidates the Step-22 store on push → the store subscription
  // below re-renders. When push is OPEN, focus/visibility becomes a
  // fail-soft fallback only (no longer the primary sync).
  const { pushActive } = useOrchestrationEvents(campaignId);
  const pushActiveRef = useRef(pushActive);
  pushActiveRef.current = pushActive;

  useEffect(() => {
    if (!campaignId || !executionId) {
      setValue(inline ?? null);
      return;
    }
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      const v = peekProjection(campaignId, executionId);
      // store loaded → authoritative; else keep inline as best-effort.
      setValue(v === undefined ? (inline ?? undefined) : v);
    };

    const unsub = subscribe(campaignId, sync);
    getFeed(campaignId).then(sync).catch(() => { if (!cancelled) setValue(inline ?? null); });

    // FALLBACK ONLY (Step-23): when the server-push channel is open the
    // hydrator already reconciles in real time, so focus/visibility skips
    // the redundant refetch. It re-activates automatically if push drops.
    const onFocus = () => { if (!pushActiveRef.current) void revalidate(campaignId, 'focus_fallback'); };
    const onVis = () => {
      if (!pushActiveRef.current && document.visibilityState === 'visible') {
        void revalidate(campaignId, 'visibility_fallback');
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [campaignId, executionId, inline]);

  return value;
}
