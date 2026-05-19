/**
 * aiAssetLiveRefresh — Phase-2 Step-22.
 *
 * Replaces the Step-21 session-static module cache with a SCOPED,
 * INVALIDATABLE, SUBSCRIBABLE per-campaign feed store. Event-driven (no
 * polling loop): a refresh happens ONLY on explicit invalidate/revalidate
 * (post-mutation, post-autogen one-shot, window focus). Cards subscribe and
 * re-render when their campaign's projection map changes.
 *
 * Fail-soft: a broken feed clears the cache entry (so a later revalidate
 * can retry) and notifies subscribers with the last-good map (or {}).
 */

import { fetchWithAuth } from '../../../community-ai/fetchWithAuth';
import { aiAssetMutationDiagnostics } from './aiAssetMutationDiagnostics';
import type { AIAssetProjectionLike } from '../AIAssetPreview';

export type FeedMap = Record<string, AIAssetProjectionLike | null>;
type Entry = {
  data: FeedMap;
  loaded: boolean;
  inflight: Promise<FeedMap> | null;
  subs: Set<() => void>;
};

const store = new Map<string, Entry>();

function entry(campaignId: string): Entry {
  let e = store.get(campaignId);
  if (!e) {
    e = { data: {}, loaded: false, inflight: null, subs: new Set() };
    store.set(campaignId, e);
  }
  return e;
}

function notify(e: Entry): void {
  e.subs.forEach((cb) => {
    try { cb(); } catch { /* never let one subscriber break the rest */ }
  });
}

async function doFetch(campaignId: string, source: string): Promise<FeedMap> {
  const e = entry(campaignId);
  try {
    const r = await fetchWithAuth(
      `/api/campaigns/${encodeURIComponent(campaignId)}/orchestration-calendar-view`,
    );
    const data = r.ok ? await r.json() : null;
    const items: Array<{ execution_id?: string; ai_asset?: AIAssetProjectionLike | null }> =
      Array.isArray(data?.items) ? data.items : [];
    const map: FeedMap = {};
    for (const it of items) if (it?.execution_id) map[String(it.execution_id)] = it.ai_asset ?? null;
    e.data = map;
    e.loaded = true;
    aiAssetMutationDiagnostics.refresh({
      campaign_id: campaignId, refresh_source: source,
      hydration_success: true, executions: Object.keys(map).length,
    });
    return map;
  } catch {
    e.loaded = false; // allow retry on next revalidate
    aiAssetMutationDiagnostics.refreshFail({ campaign_id: campaignId, refresh_source: source, hydration_success: false });
    return e.data; // last-good (or {})
  } finally {
    e.inflight = null;
    notify(e);
  }
}

/** Get the feed map, fetching once if not yet loaded. Shared per campaign. */
export function getFeed(campaignId: string): Promise<FeedMap> {
  const e = entry(campaignId);
  if (e.loaded) return Promise.resolve(e.data);
  if (e.inflight) return e.inflight;
  e.inflight = doFetch(campaignId, 'initial');
  return e.inflight;
}

/** Synchronous peek (may be empty before first load). */
export function peekProjection(campaignId: string, executionId: string): AIAssetProjectionLike | null | undefined {
  const e = store.get(campaignId);
  if (!e || !e.loaded) return undefined;
  return e.data[executionId] ?? null;
}

/** Force a refetch + notify (scoped, no polling). */
export function revalidate(campaignId: string, source = 'manual'): Promise<FeedMap> {
  const e = entry(campaignId);
  if (e.inflight) return e.inflight;
  e.inflight = doFetch(campaignId, source);
  return e.inflight;
}

/** Invalidate (campaign- or execution-scoped) then revalidate. */
export function invalidate(campaignId: string, executionId?: string, source = 'invalidate'): Promise<FeedMap> {
  const e = entry(campaignId);
  if (executionId) delete e.data[executionId];
  e.loaded = false;
  return revalidate(campaignId, source);
}

/** Optimistic local patch (immediate UI) before the server confirms. */
export function patchProjection(
  campaignId: string,
  executionId: string,
  patch: Partial<AIAssetProjectionLike>,
): void {
  const e = entry(campaignId);
  const cur = e.data[executionId] ?? null;
  e.data[executionId] = { ...(cur ?? {}), ...patch } as AIAssetProjectionLike;
  notify(e);
}

export function subscribe(campaignId: string, cb: () => void): () => void {
  const e = entry(campaignId);
  e.subs.add(cb);
  return () => { e.subs.delete(cb); };
}
