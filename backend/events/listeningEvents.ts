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

export const LISTENING_EVENT_TYPES = [
  'capability.changed',
  'listening_source.status_changed',
  'consent.recorded',
  'consent.revoked',
  'lead_signal.created',
] as const;
export type ListeningEventType = (typeof LISTENING_EVENT_TYPES)[number];

export type CapabilityChangedEvent = {
  type: 'capability.changed';
  organization_id: string;
  platform: string;
  capability: IntegrationCapability;
  previous_state: 'enabled' | 'disabled';
  new_state: 'enabled' | 'disabled';
  actor_user_id: string | null;
  occurred_at: string;
};

export type ListeningSourceStatusChangedEvent = {
  type: 'listening_source.status_changed';
  organization_id: string;
  listening_source_id: string;
  source_type: ListeningSourceType;
  previous_status: ListeningSourceStatus;
  new_status: ListeningSourceStatus;
  actor_user_id: string | null;
  occurred_at: string;
};

export type ConsentRecordedEvent = {
  type: 'consent.recorded';
  organization_id: string;
  consent_record_id: string;
  platform: string;
  capability: IntegrationCapability;
  granted_by: string | null;
  occurred_at: string;
};

export type ConsentRevokedEvent = {
  type: 'consent.revoked';
  organization_id: string;
  consent_record_id: string;
  platform: string;
  capability: IntegrationCapability;
  revoked_by: string | null;
  occurred_at: string;
};

export type LeadSignalCreatedEvent = {
  type: 'lead_signal.created';
  organization_id: string;
  lead_signal_id: string;
  platform: string;
  source_type: 'engagement' | 'listening';
  occurred_at: string;
};

export type ListeningEventPayload =
  | CapabilityChangedEvent
  | ListeningSourceStatusChangedEvent
  | ConsentRecordedEvent
  | ConsentRevokedEvent
  | LeadSignalCreatedEvent;

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

async function publish(event: ListeningEventPayload): Promise<void> {
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

export async function publishCapabilityChangedEvent(
  payload: Omit<CapabilityChangedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'capability.changed', ...payload });
}

export async function publishListeningSourceStatusChangedEvent(
  payload: Omit<ListeningSourceStatusChangedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'listening_source.status_changed', ...payload });
}

export async function publishConsentRecordedEvent(
  payload: Omit<ConsentRecordedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'consent.recorded', ...payload });
}

export async function publishConsentRevokedEvent(
  payload: Omit<ConsentRevokedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'consent.revoked', ...payload });
}

export async function publishLeadSignalCreatedEvent(
  payload: Omit<LeadSignalCreatedEvent, 'type'>,
): Promise<void> {
  await publish({ type: 'lead_signal.created', ...payload });
}
