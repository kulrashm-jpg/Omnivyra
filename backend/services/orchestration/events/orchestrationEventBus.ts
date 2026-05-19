/**
 * orchestrationEventBus — Phase-2 Step-23.
 *
 * Pluggable transport (mirrors the proven intelligence/realtimeChannel
 * pattern): an in-process EventEmitter by default, with a registration
 * seam so a cross-process transport (Upstash Redis pub/sub / Supabase
 * Realtime) can be wired LATER without touching emitters or the SSE route.
 *
 * Scope: subscriptions are campaign-scoped — a subscriber for campaign A
 * never receives campaign B's events. Never throws (publish/subscribe are
 * fail-soft so generation/mutation flows are never blocked by the bus).
 *
 * HONEST LIMITATION: the default in-process transport only bridges an
 * emitter and an SSE connection handled by the SAME Node instance
 * (single-instance worker / dev:full / Railway worker = true server push).
 * On multi-instance serverless, register a shared transport via
 * registerOrchestrationEventTransport(); until then the client's Step-22
 * focus/revalidate path is the disclosed fallback.
 */

import { EventEmitter } from 'events';
import type { OrchestrationEvent } from './orchestrationEventTypes';
import { orchestrationEventDiagnostics } from './orchestrationEventDiagnostics';

export interface OrchestrationEventTransport {
  publish(event: OrchestrationEvent): Promise<void> | void;
  subscribe(
    campaignId: string,
    listener: (event: OrchestrationEvent) => void,
  ): { unsubscribe: () => void };
}

class InProcessTransport implements OrchestrationEventTransport {
  private emitter = new EventEmitter();

  constructor() {
    // Many concurrent SSE connections for the same campaign are expected.
    this.emitter.setMaxListeners(0);
  }

  publish(event: OrchestrationEvent): void {
    this.emitter.emit(`campaign:${event.campaign_id}`, event);
  }

  subscribe(campaignId: string, listener: (event: OrchestrationEvent) => void) {
    const topic = `campaign:${campaignId}`;
    this.emitter.on(topic, listener);
    return { unsubscribe: () => { this.emitter.off(topic, listener); } };
  }

  subscriberCount(campaignId: string): number {
    return this.emitter.listenerCount(`campaign:${campaignId}`);
  }
}

const inProcess = new InProcessTransport();
let active: OrchestrationEventTransport = inProcess;

/** Seam for a future cross-process transport. Idempotent, never throws. */
export function registerOrchestrationEventTransport(t: OrchestrationEventTransport): void {
  try {
    active = t;
  } catch {
    /* keep prior transport on any failure */
  }
}

export function getOrchestrationEventTransport(): OrchestrationEventTransport {
  return active;
}

/**
 * The always-present in-process transport. A distributed transport uses
 * this as its same-instance fan-out + fail-soft delegate (fallback
 * hierarchy: distributed → in-process → Step-22 invalidate/revalidate).
 */
export function getInProcessOrchestrationTransport(): OrchestrationEventTransport {
  return inProcess;
}

export function subscriberCount(campaignId: string): number {
  return active === inProcess ? inProcess.subscriberCount(campaignId) : -1;
}

/** Publish fail-soft — a bus failure must never break generation/mutation. */
export async function publishOrchestrationEvent(event: OrchestrationEvent): Promise<void> {
  try {
    await active.publish(event);
    orchestrationEventDiagnostics.push({
      campaign_id: event.campaign_id,
      execution_id: event.execution_id,
      event_type: event.type,
      asset_state: event.asset_state,
      subscriber_count: subscriberCount(event.campaign_id),
    });
  } catch (e) {
    orchestrationEventDiagnostics.fail({
      campaign_id: event.campaign_id,
      execution_id: event.execution_id,
      event_type: event.type,
      reason: (e as Error)?.message ?? 'publish_failed',
    });
  }
}

export function subscribeOrchestrationEvents(
  campaignId: string,
  listener: (event: OrchestrationEvent) => void,
): { unsubscribe: () => void } {
  try {
    return active.subscribe(campaignId, listener);
  } catch {
    return { unsubscribe: () => {} };
  }
}

/** Test helper. */
export function __resetOrchestrationEventBus(): void {
  active = inProcess;
}
