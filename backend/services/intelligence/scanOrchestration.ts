// Scan orchestration.
//
// Operational layer for managed intelligence execution. Records scan-queue
// state, supports scheduled / manual / partial / provider-specific reruns,
// cancellation, and priority. The actual worker that drains the queue is
// outside the report engine — this service owns the durable state and the
// API the admin console + analyst tools call into.

import { randomUUID } from 'crypto';
import type { TenantContext, TenantId } from './tenantGovernance';
import { logAuditEvent } from './auditLog';
import type { ScanProfile } from './snapshotWriter';

export type ScanQueueStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'skipped_budget_exhausted'
  | 'skipped_provider_unavailable';

export type ScanQueueRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  scan_profile: ScanProfile;
  origin: 'manual' | 'scheduled' | 'partial_rerun' | 'provider_rerun' | 'delta_only';
  /** Higher = sooner. UI exposes 1-10 to operators; the worker uses this to order the queue. */
  priority: number;
  /** When provided, only these provider ids run. Empty means all configured providers. */
  scoped_providers: string[];
  status: ScanQueueStatus;
  /** Cancellation reason when status === 'cancelled'. */
  cancelled_reason: string | null;
  enqueued_at: string;
  enqueued_by: TenantContext['actor'];
  started_at: string | null;
  completed_at: string | null;
  /** When the scan completed, the snapshot it produced is referenced here for traceability. */
  resulting_snapshot_observed_at: string | null;
  /** Latest failure reason when status === 'failed'. */
  failure_reason: string | null;
};

export interface ScanQueueStore {
  enqueue(record: ScanQueueRecord): Promise<void>;
  update(record: ScanQueueRecord): Promise<void>;
  list(params: { tenantId: TenantId; companyId?: string; status?: ScanQueueStatus[]; limit?: number }): Promise<ScanQueueRecord[]>;
  byId(id: string): Promise<ScanQueueRecord | null>;
}

class InMemoryScanQueueStore implements ScanQueueStore {
  private rows: ScanQueueRecord[] = [];
  async enqueue(record: ScanQueueRecord): Promise<void> {
    this.rows.push(record);
  }
  async update(record: ScanQueueRecord): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.rows[idx] = record;
  }
  async list(params: {
    tenantId: TenantId;
    companyId?: string;
    status?: ScanQueueStatus[];
    limit?: number;
  }): Promise<ScanQueueRecord[]> {
    let rows = this.rows.filter((r) => r.tenant_id === params.tenantId);
    if (params.companyId) rows = rows.filter((r) => r.company_id === params.companyId);
    if (params.status && params.status.length > 0) rows = rows.filter((r) => params.status!.includes(r.status));
    return rows
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.enqueued_at < b.enqueued_at ? -1 : 1;
      })
      .slice(0, params.limit ?? 200);
  }
  async byId(id: string): Promise<ScanQueueRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  /** Test helper. */
  _reset(): void {
    this.rows = [];
  }
}

let activeScanQueueStore: ScanQueueStore = new InMemoryScanQueueStore();

export function registerScanQueueStore(store: ScanQueueStore): void {
  activeScanQueueStore = store;
}

export function getScanQueueStore(): ScanQueueStore {
  return activeScanQueueStore;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueueScan(params: {
  tenantContext: TenantContext;
  companyId: string;
  scanProfile: ScanProfile;
  origin: ScanQueueRecord['origin'];
  priority?: number;
  scopedProviders?: string[];
}): Promise<ScanQueueRecord> {
  const record: ScanQueueRecord = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.companyId,
    scan_profile: params.scanProfile,
    origin: params.origin,
    priority: params.priority ?? 5,
    scoped_providers: params.scopedProviders ?? [],
    status: 'queued',
    cancelled_reason: null,
    enqueued_at: new Date().toISOString(),
    enqueued_by: params.tenantContext.actor,
    started_at: null,
    completed_at: null,
    resulting_snapshot_observed_at: null,
    failure_reason: null,
  };
  await activeScanQueueStore.enqueue(record);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'scan_executed',
    payload: { kind: 'enqueued', scan_id: record.id, profile: record.scan_profile, origin: record.origin },
  });
  return record;
}

export async function transitionScan(params: {
  tenantContext: TenantContext;
  scanId: string;
  next: Partial<Pick<ScanQueueRecord, 'status' | 'started_at' | 'completed_at' | 'cancelled_reason' | 'failure_reason' | 'resulting_snapshot_observed_at'>>;
}): Promise<ScanQueueRecord | null> {
  const prior = await activeScanQueueStore.byId(params.scanId);
  if (!prior) return null;
  const next: ScanQueueRecord = { ...prior, ...params.next };
  await activeScanQueueStore.update(next);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: next.status === 'cancelled' ? 'scan_cancelled' : next.status === 'failed' ? 'scan_failed' : 'scan_executed',
    payload: { kind: 'transition', scan_id: next.id, status: next.status, reason: next.cancelled_reason ?? next.failure_reason },
  });
  return next;
}

export async function cancelScan(params: {
  tenantContext: TenantContext;
  scanId: string;
  reason: string;
}): Promise<ScanQueueRecord | null> {
  return transitionScan({
    tenantContext: params.tenantContext,
    scanId: params.scanId,
    next: { status: 'cancelled', cancelled_reason: params.reason, completed_at: new Date().toISOString() },
  });
}

/** Test helper. */
export function _resetScanQueue(): void {
  activeScanQueueStore = new InMemoryScanQueueStore();
}
