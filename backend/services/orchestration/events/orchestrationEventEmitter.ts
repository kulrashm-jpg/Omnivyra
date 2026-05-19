/**
 * orchestrationEventEmitter — Phase-2 Step-23.
 *
 * Typed, fire-and-forget emit helpers called at the REAL completion sites
 * (Step-19 generation runtime, Step-22 mutation endpoint, readiness sync).
 * Provenance/version are stamped from the canonical orchestration source so
 * the event carries the same lineage the feed would. Never throws.
 */

import { ORCHESTRATION_VERSION } from '../provenance';
import { publishOrchestrationEvent } from './orchestrationEventBus';
import { orchestrationEventDiagnostics } from './orchestrationEventDiagnostics';
import type { OrchestrationEvent, OrchestrationEventType } from './orchestrationEventTypes';

function emit(
  type: OrchestrationEventType,
  campaignId: string,
  opts?: {
    executionId?: string | null;
    assetState?: string | null;
    previewUrl?: string | null;
    fallbackMode?: boolean;
    provenanceSummary?: Record<string, unknown> | null;
  },
): void {
  if (!campaignId) return;
  const event: OrchestrationEvent = {
    type,
    campaign_id: campaignId,
    execution_id: opts?.executionId ?? null,
    asset_state: opts?.assetState ?? null,
    preview_url: opts?.previewUrl ?? null,
    fallback_mode: opts?.fallbackMode ?? false,
    orchestration_version: ORCHESTRATION_VERSION,
    provenance_summary: opts?.provenanceSummary ?? null,
    emitted_at: new Date().toISOString(),
  };
  orchestrationEventDiagnostics.event({
    campaign_id: campaignId,
    execution_id: event.execution_id,
    event_type: type,
    asset_state: event.asset_state,
  });
  // Step-24: lazily promote to the distributed transport (idempotent,
  // fail-soft, dynamic import so ioredis is never pulled into callers
  // that don't emit). Then publish via whatever transport is active.
  void import('./distributedOrchestrationEventTransport')
    .then((m) => m.ensureDistributedOrchestrationTransport())
    .catch(() => {})
    .finally(() => { void Promise.resolve(publishOrchestrationEvent(event)).catch(() => {}); });
}

export const orchestrationEvents = {
  aiAssetGenerated: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('AI_ASSET_GENERATED', campaignId, o),
  aiAssetFailed: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('AI_ASSET_FAILED', campaignId, { ...o, fallbackMode: true }),
  aiAssetReplaced: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('AI_ASSET_REPLACED', campaignId, o),
  aiAssetRestored: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('AI_ASSET_RESTORED', campaignId, o),
  aiAssetRemoved: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('AI_ASSET_REMOVED', campaignId, { ...o, fallbackMode: true }),
  orchestrationRefresh: (campaignId: string, o?: Parameters<typeof emit>[2]) =>
    emit('ORCHESTRATION_REFRESH', campaignId, o),
};
