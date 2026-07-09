/** Part of listeningEventsOps (Agent-B split — the original path is a curated barrel). */
/** Listening event types + emitters — trends, compliance, ops — split from listeningEvents.ts (barrel preserved; importers unchanged). */
/**
 * Phase 0 — typed event contracts for the listening / capability surface.
 *
 * No transport is wired here. Subscribers are in-process for now; Phase 4
 * will bind these payloads to Supabase Realtime / WebSocket so the UI can
 * push-update. Publishing services should call the publish* helpers; if no
 * subscribers are registered the events are silently dropped (safe no-op).
 */

import type { IntegrationCapability } from '../types/integrationCapabilities';
import type {
  ListeningSourceStatus,
  ListeningSourceType,
} from '../types/listeningSource';

import { type ListeningEventType, type CapabilityChangedEvent, type ListeningSourceStatusChangedEvent, type ConsentRecordedEvent, type ConsentRevokedEvent, type LeadSignalCreatedEvent, type ExecutionPlannedEvent, type ExecutionStartedEvent, type ExecutionCompletedEvent, type ExecutionFailedEvent, type ExecutionBlockedEvent, type SignalsDetectedEvent, type ModerationBlockedEvent, type SourceRateLimitedEvent, type RecommendationLifecycleEvent, type OpportunityDetectedEvent, type ClusterCreatedEvent, type FeedUpdatedEvent, type ListeningEventPayload } from './listeningEventsCore';

export type TrendMaterializedEvent = {
  type: 'trend.materialized';
  organization_id: string;
  trend_kind: string;
  window_kind: string;
  window_start: string;
  window_end: string;
  series_points: number;
  occurred_at: string;
};

export type DisasterRecoveryExecutedEvent = {
  type: 'disaster_recovery.executed';
  organization_id: string;
  execution_id: string;
  plan_kind: string;
  status: string;
  approved_by: string | null;
  occurred_at: string;
};

export type ComplianceExportGeneratedEvent = {
  type: 'compliance.export_generated';
  organization_id: string;
  evidence_kind: string;
  certification_target: string;
  status: string;
  row_count: number;
  byte_size: number;
  occurred_at: string;
};

export type AnalystTemplateExecutedEvent = {
  type: 'analyst.template_executed';
  organization_id: string;
  macro_id: string;
  macro_kind: string;
  status: string;
  executed_by: string | null;
  occurred_at: string;
};

export type SafeguardTriggeredEvent = {
  type: 'safeguard.triggered';
  organization_id: string;
  safeguard_kind: string;
  observed_value: number;
  threshold_value: number;
  acted_by: string | null;
  occurred_at: string;
};

export type SafeguardRecoveredEvent = {
  type: 'safeguard.recovered';
  organization_id: string;
  safeguard_kind: string;
  acted_by: string | null;
  occurred_at: string;
};

type Subscriber = (event: ListeningEventPayload) => void | Promise<void>;

const subscribers = new Map<ListeningEventType, Set<Subscriber>>();

export function subscribeToListeningEvents<T extends ListeningEventType>(
  type: T,
  handler: Subscriber,
): () => void {
  const existing = subscribers.get(type) ?? new Set<Subscriber>();
  existing.add(handler);
  subscribers.set(type, existing);
  return () => existing.delete(handler);
}

export async function publish(event: ListeningEventPayload): Promise<void> {
  const handlers = subscribers.get(event.type);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (err: any) {
      console.warn('[listeningEvents] subscriber threw:', {
        type: event.type,
        error: err?.message,
      });
    }
  }
}


export function nowIso(): string { return new Date().toISOString(); }
