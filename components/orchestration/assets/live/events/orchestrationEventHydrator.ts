/**
 * orchestrationEventHydrator — Phase-2 Step-23.
 *
 * Maps a received server-push event onto the Step-22 scoped store
 * (event = hint, feed = truth): optimistic patch for an instant card
 * transition, then a scoped invalidate so the authoritative feed (with the
 * real preview_url) reconciles. Campaign-wide events → revalidate. Pure
 * glue, fail-soft (never throws into the EventSource callback).
 */

import { invalidate, patchProjection, revalidate } from '../aiAssetLiveRefresh';
import { orchestrationEventClientDiagnostics } from './orchestrationEventDiagnostics';
import type { ClientOrchestrationEvent } from './orchestrationEventClient';

const PATCH: Record<string, Record<string, unknown> | undefined> = {
  AI_ASSET_GENERATED: { asset_state: 'AI_GENERATED', fallback_mode: false },
  AI_ASSET_FAILED: { asset_state: 'GENERATION_FAILED', fallback_mode: true },
  AI_ASSET_REMOVED: { asset_state: 'USER_REMOVED', fallback_mode: true },
  AI_ASSET_RESTORED: { asset_state: 'AI_GENERATED', fallback_mode: false },
  AI_ASSET_REPLACED: { asset_state: 'USER_REPLACED', fallback_mode: false },
};

export function hydrateFromEvent(event: ClientOrchestrationEvent): void {
  try {
    const campaignId = event.campaign_id;
    if (!campaignId) return;

    if (!event.execution_id) {
      // ORCHESTRATION_REFRESH / campaign-wide → reconcile the whole feed.
      void revalidate(campaignId, `event:${event.type}`);
      orchestrationEventClientDiagnostics.hydrate({
        campaign_id: campaignId, execution_id: null, event_type: event.type,
        hydration_success: true, scope: 'campaign',
      });
      return;
    }

    const patch = PATCH[event.type];
    if (patch) {
      // Instant transition (no reload / no focus)…
      patchProjection(campaignId, event.execution_id, patch);
    }
    // …then reconcile against server truth (brings the real preview_url).
    void invalidate(campaignId, event.execution_id, `event:${event.type}`);

    orchestrationEventClientDiagnostics.hydrate({
      campaign_id: campaignId,
      execution_id: event.execution_id,
      event_type: event.type,
      asset_state: event.asset_state,
      hydration_success: true,
      scope: 'execution',
    });
  } catch {
    orchestrationEventClientDiagnostics.fail({
      campaign_id: event?.campaign_id ?? null,
      execution_id: event?.execution_id ?? null,
      reason: 'hydrate_exception',
    });
  }
}
