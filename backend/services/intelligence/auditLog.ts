// Intelligence audit log.
//
// Immutable append-only ledger of every operationally-meaningful event. Each
// entry carries actor attribution, tenant scope, timestamp, and a typed
// payload. Used for forensics, compliance, and the admin console's tenant-
// activity view.

import { randomUUID } from 'crypto';
import type { TenantContext, TenantId } from './tenantGovernance';

export type AuditEventKind =
  | 'provider_call'
  | 'report_generated'
  | 'recommendation_state_change'
  | 'benchmark_dataset_change'
  | 'manual_override'
  | 'tenant_policy_change'
  | 'scan_executed'
  | 'scan_cancelled'
  | 'scan_failed'
  | 'collaboration_event';

export type AuditEntry<P = unknown> = {
  id: string;
  tenant_id: TenantId;
  occurred_at: string;
  actor: TenantContext['actor'];
  correlation_id: string | null;
  kind: AuditEventKind;
  payload: P;
};

export interface AuditLogStore {
  append<P>(entry: AuditEntry<P>): Promise<void>;
  /** Read-only query — returns rows ordered by occurred_at desc. */
  query(params: {
    tenant_id: TenantId;
    kinds?: AuditEventKind[];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditEntry[]>;
}

class InMemoryAuditLogStore implements AuditLogStore {
  private rows: AuditEntry[] = [];
  async append<P>(entry: AuditEntry<P>): Promise<void> {
    this.rows.push(entry);
  }
  async query(params: {
    tenant_id: TenantId;
    kinds?: AuditEventKind[];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    return this.rows
      .filter((r) => r.tenant_id === params.tenant_id)
      .filter((r) => !params.kinds || params.kinds.includes(r.kind))
      .filter((r) => !params.from || r.occurred_at >= params.from)
      .filter((r) => !params.to || r.occurred_at <= params.to)
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0))
      .slice(0, params.limit ?? 200);
  }
  /** Test helper. */
  _reset(): void {
    this.rows = [];
  }
}

let activeAuditStore: AuditLogStore = new InMemoryAuditLogStore();

export function registerAuditLogStore(store: AuditLogStore): void {
  activeAuditStore = store;
}

export function getAuditLogStore(): AuditLogStore {
  return activeAuditStore;
}

/** Compose + append a single entry. Returns the entry id. */
export async function logAuditEvent<P>(params: {
  tenantContext: TenantContext;
  kind: AuditEventKind;
  payload: P;
}): Promise<string> {
  const entry: AuditEntry<P> = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    occurred_at: new Date().toISOString(),
    actor: params.tenantContext.actor,
    correlation_id: params.tenantContext.correlation_id ?? null,
    kind: params.kind,
    payload: params.payload,
  };
  await activeAuditStore.append(entry);
  return entry.id;
}

/** Test helper. */
export function _resetAuditLog(): void {
  activeAuditStore = new InMemoryAuditLogStore();
}
