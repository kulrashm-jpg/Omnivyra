// Realtime collaboration / scan-progress infrastructure.
//
// Defines the canonical channel shape every realtime feature broadcasts on.
// The transport is pluggable: production wires Supabase Realtime
// (postgres_changes + broadcast); dev/test uses an in-process EventEmitter
// fallback so unit tests don't need a backend.
//
// Channels are tenant-scoped — a subscriber from tenant A never receives
// events for tenant B. Permission gating happens at the publisher.

import { EventEmitter } from 'events';
import type { TenantContext, TenantId } from './tenantGovernance';

export type RealtimeChannelKind =
  | 'collaboration'    // annotations / assignments / pinned findings / status updates
  | 'scan_progress'    // scan_queue state transitions
  | 'recommendation'   // recommendation lifecycle changes
  | 'evidence_update'  // new evidence rows persisted
  | 'governance';      // tenant policy changes

export type RealtimeEvent<P = unknown> = {
  channel: RealtimeChannelKind;
  tenant_id: TenantId;
  /** Optional company scope — when set, only company-subscribers receive it. */
  company_id: string | null;
  occurred_at: string;
  actor: TenantContext['actor'];
  correlation_id: string | null;
  kind: string; // event-kind discriminator within the channel
  payload: P;
};

export interface RealtimeTransport {
  publish(event: RealtimeEvent): Promise<void>;
  subscribe(params: {
    channel: RealtimeChannelKind;
    tenant_id: TenantId;
    company_id?: string;
    listener: (event: RealtimeEvent) => void;
  }): Promise<{ unsubscribe: () => Promise<void> }>;
}

class InMemoryRealtimeTransport implements RealtimeTransport {
  private emitter = new EventEmitter();

  async publish(event: RealtimeEvent): Promise<void> {
    this.emitter.emit(this.topicFor(event.channel, event.tenant_id, event.company_id), event);
    // Also emit on the tenant-only topic so subscribers without a company filter receive it.
    if (event.company_id) {
      this.emitter.emit(this.topicFor(event.channel, event.tenant_id, null), event);
    }
  }

  async subscribe(params: {
    channel: RealtimeChannelKind;
    tenant_id: TenantId;
    company_id?: string;
    listener: (event: RealtimeEvent) => void;
  }): Promise<{ unsubscribe: () => Promise<void> }> {
    const topic = this.topicFor(params.channel, params.tenant_id, params.company_id ?? null);
    this.emitter.on(topic, params.listener);
    return {
      unsubscribe: async () => {
        this.emitter.off(topic, params.listener);
      },
    };
  }

  private topicFor(channel: RealtimeChannelKind, tenant: TenantId, company: string | null): string {
    return `${channel}:${tenant}:${company ?? '*'}`;
  }

  /** Test helper. */
  _reset(): void {
    this.emitter.removeAllListeners();
  }
}

let activeTransport: RealtimeTransport = new InMemoryRealtimeTransport();

export function registerRealtimeTransport(transport: RealtimeTransport): void {
  activeTransport = transport;
}

export function getRealtimeTransport(): RealtimeTransport {
  return activeTransport;
}

// ── Public publishers ─────────────────────────────────────────────────────────

export async function publishCollaborationEvent<P>(params: {
  tenantContext: TenantContext;
  company_id: string | null;
  kind: 'annotation_added' | 'annotation_resolved' | 'action_assigned' | 'finding_pinned' | 'recommendation_status_changed';
  payload: P;
}): Promise<void> {
  await activeTransport.publish({
    channel: 'collaboration',
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.company_id,
    occurred_at: new Date().toISOString(),
    actor: params.tenantContext.actor,
    correlation_id: params.tenantContext.correlation_id ?? null,
    kind: params.kind,
    payload: params.payload,
  });
}

export async function publishScanProgress<P>(params: {
  tenantContext: TenantContext;
  company_id: string;
  kind: 'enqueued' | 'started' | 'progress' | 'completed' | 'cancelled' | 'failed';
  payload: P;
}): Promise<void> {
  await activeTransport.publish({
    channel: 'scan_progress',
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.company_id,
    occurred_at: new Date().toISOString(),
    actor: params.tenantContext.actor,
    correlation_id: params.tenantContext.correlation_id ?? null,
    kind: params.kind,
    payload: params.payload,
  });
}

/** Test helper. */
export function _resetRealtimeTransport(): void {
  activeTransport = new InMemoryRealtimeTransport();
}
