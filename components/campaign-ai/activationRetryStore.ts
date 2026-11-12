/**
 * Pending "Retry status update" actions, per campaign (e9, 2026-11-12).
 *
 * After schedule-structured-plan scheduled the posts but could not activate the campaign
 * (`activation.ok: false`), useStructuredPlanScheduling registers a retry here. The retry calls ONLY
 * /api/campaigns/[id]/retry-activation, never the schedule route: re-scheduling would duplicate every
 * post. ActivationRetryNotice renders the button for the campaign being viewed.
 */
import { useSyncExternalStore } from 'react';

type Retry = () => Promise<void>;
const pending = new Map<string, Retry>();
const listeners = new Set<() => void>();

export function setActivationRetry(campaignId: string, retry: Retry | null): void {
  if (retry) pending.set(campaignId, retry);
  else pending.delete(campaignId);
  for (const l of listeners) l();
}

export function getActivationRetry(campaignId: string | undefined): Retry | null {
  return campaignId ? pending.get(campaignId) ?? null : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useActivationRetry(campaignId: string | undefined): Retry | null {
  return useSyncExternalStore(subscribe, () => getActivationRetry(campaignId), () => null);
}
