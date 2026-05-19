/**
 * orchestrationEventTypes — Phase-2 Step-23.
 *
 * Canonical shape for server-push orchestration events. Additive: events
 * carry only what a card needs to hydrate without a refetch, but the client
 * still reconciles against the authoritative feed (event = hint, feed =
 * truth) so a lossy/stale event can never corrupt state.
 */

export type OrchestrationEventType =
  | 'AI_ASSET_GENERATED'
  | 'AI_ASSET_FAILED'
  | 'AI_ASSET_REPLACED'
  | 'AI_ASSET_RESTORED'
  | 'AI_ASSET_REMOVED'
  | 'ORCHESTRATION_REFRESH';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  campaign_id: string;
  /**
   * Step-25: durable stream entry id (Redis Stream `ms-seq`). Present once
   * the event has been appended to the durable stream; used as the SSE
   * `id:` line + client Last-Event-ID resume cursor. null when the durable
   * stream is unavailable (fire-and-forget fallback — Step-24 behavior).
   */
  event_id?: string | null;
  /** null for campaign-wide events (e.g. ORCHESTRATION_REFRESH). */
  execution_id: string | null;
  asset_state: string | null;
  preview_url: string | null;
  fallback_mode: boolean;
  orchestration_version: string;
  provenance_summary: Record<string, unknown> | null;
  emitted_at: string;
}

export function isOrchestrationEvent(v: unknown): v is OrchestrationEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.campaign_id === 'string';
}
