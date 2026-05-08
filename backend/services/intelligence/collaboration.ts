// Collaboration infrastructure.
//
// Tenant-scoped, audit-logged records that enable analyst + executive workflows
// inside the report. Phase 6 ships the data shapes and the store contract;
// real-time presence / live cursors are deferred to Phase 7.

import { randomUUID } from 'crypto';
import type { TenantContext, TenantId } from './tenantGovernance';
import { logAuditEvent } from './auditLog';
import type { PillarKey } from '../canonicalReport/canonicalReportTypes';

export type AnnotationRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  /** Anchor: where in the report the annotation is pinned. */
  anchor:
    | { kind: 'overall' }
    | { kind: 'pillar'; pillar: PillarKey }
    | { kind: 'dimension'; dimension_key: string }
    | { kind: 'recommendation'; action_id: string }
    | { kind: 'finding'; section: string };
  body: string;
  created_at: string;
  created_by: TenantContext['actor'];
  resolved_at: string | null;
  resolved_by: TenantContext['actor'] | null;
};

export type AssignmentRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  action_id: string;
  assigned_to: { id: string; label: string };
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  due_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: TenantContext['actor'];
  updated_at: string;
};

export type PinnedFindingRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  finding_kind: 'risk' | 'opportunity' | 'win' | 'note';
  title: string;
  body: string;
  pinned_at: string;
  pinned_by: TenantContext['actor'];
};

export type RecommendationStatusOverrideRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  action_id: string;
  status: 'accepted' | 'in_progress' | 'completed' | 'rejected' | 'deferred';
  notes: string | null;
  changed_at: string;
  changed_by: TenantContext['actor'];
};

export interface CollaborationStore {
  listAnnotations(tenantId: TenantId, companyId: string): Promise<AnnotationRecord[]>;
  upsertAnnotation(record: AnnotationRecord): Promise<void>;
  listAssignments(tenantId: TenantId, companyId: string): Promise<AssignmentRecord[]>;
  upsertAssignment(record: AssignmentRecord): Promise<void>;
  listPinnedFindings(tenantId: TenantId, companyId: string): Promise<PinnedFindingRecord[]>;
  upsertPinnedFinding(record: PinnedFindingRecord): Promise<void>;
  listRecommendationStatuses(tenantId: TenantId, companyId: string): Promise<RecommendationStatusOverrideRecord[]>;
  upsertRecommendationStatus(record: RecommendationStatusOverrideRecord): Promise<void>;
}

class InMemoryCollaborationStore implements CollaborationStore {
  private annotations: AnnotationRecord[] = [];
  private assignments: AssignmentRecord[] = [];
  private findings: PinnedFindingRecord[] = [];
  private statuses: RecommendationStatusOverrideRecord[] = [];

  async listAnnotations(tid: TenantId, cid: string): Promise<AnnotationRecord[]> {
    return this.annotations.filter((r) => r.tenant_id === tid && r.company_id === cid);
  }
  async upsertAnnotation(record: AnnotationRecord): Promise<void> {
    upsertById(this.annotations, record);
  }
  async listAssignments(tid: TenantId, cid: string): Promise<AssignmentRecord[]> {
    return this.assignments.filter((r) => r.tenant_id === tid && r.company_id === cid);
  }
  async upsertAssignment(record: AssignmentRecord): Promise<void> {
    upsertById(this.assignments, record);
  }
  async listPinnedFindings(tid: TenantId, cid: string): Promise<PinnedFindingRecord[]> {
    return this.findings.filter((r) => r.tenant_id === tid && r.company_id === cid);
  }
  async upsertPinnedFinding(record: PinnedFindingRecord): Promise<void> {
    upsertById(this.findings, record);
  }
  async listRecommendationStatuses(tid: TenantId, cid: string): Promise<RecommendationStatusOverrideRecord[]> {
    return this.statuses.filter((r) => r.tenant_id === tid && r.company_id === cid);
  }
  async upsertRecommendationStatus(record: RecommendationStatusOverrideRecord): Promise<void> {
    upsertById(this.statuses, record);
  }
  /** Test helper. */
  _reset(): void {
    this.annotations = [];
    this.assignments = [];
    this.findings = [];
    this.statuses = [];
  }
}

function upsertById<T extends { id: string }>(rows: T[], record: T): void {
  const idx = rows.findIndex((r) => r.id === record.id);
  if (idx >= 0) rows[idx] = record;
  else rows.push(record);
}

let activeCollaborationStore: CollaborationStore = new InMemoryCollaborationStore();

export function registerCollaborationStore(store: CollaborationStore): void {
  activeCollaborationStore = store;
}

export function getCollaborationStore(): CollaborationStore {
  return activeCollaborationStore;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function addAnnotation(params: {
  tenantContext: TenantContext;
  companyId: string;
  anchor: AnnotationRecord['anchor'];
  body: string;
}): Promise<AnnotationRecord> {
  const record: AnnotationRecord = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.companyId,
    anchor: params.anchor,
    body: params.body,
    created_at: new Date().toISOString(),
    created_by: params.tenantContext.actor,
    resolved_at: null,
    resolved_by: null,
  };
  await activeCollaborationStore.upsertAnnotation(record);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'collaboration_event',
    payload: { kind: 'annotation_added', annotation_id: record.id, anchor: record.anchor },
  });
  return record;
}

export async function resolveAnnotation(params: {
  tenantContext: TenantContext;
  annotation: AnnotationRecord;
}): Promise<AnnotationRecord> {
  const resolved: AnnotationRecord = {
    ...params.annotation,
    resolved_at: new Date().toISOString(),
    resolved_by: params.tenantContext.actor,
  };
  await activeCollaborationStore.upsertAnnotation(resolved);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'collaboration_event',
    payload: { kind: 'annotation_resolved', annotation_id: resolved.id },
  });
  return resolved;
}

export async function assignAction(params: {
  tenantContext: TenantContext;
  companyId: string;
  actionId: string;
  assignee: AssignmentRecord['assigned_to'];
  dueAt: string | null;
  notes: string | null;
}): Promise<AssignmentRecord> {
  const now = new Date().toISOString();
  const record: AssignmentRecord = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.companyId,
    action_id: params.actionId,
    assigned_to: params.assignee,
    status: 'open',
    due_at: params.dueAt,
    notes: params.notes,
    created_at: now,
    created_by: params.tenantContext.actor,
    updated_at: now,
  };
  await activeCollaborationStore.upsertAssignment(record);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'collaboration_event',
    payload: { kind: 'action_assigned', assignment_id: record.id, action_id: record.action_id, assignee: record.assigned_to },
  });
  return record;
}

export async function pinFinding(params: {
  tenantContext: TenantContext;
  companyId: string;
  finding: Omit<PinnedFindingRecord, 'id' | 'tenant_id' | 'company_id' | 'pinned_at' | 'pinned_by'>;
}): Promise<PinnedFindingRecord> {
  const record: PinnedFindingRecord = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.companyId,
    pinned_at: new Date().toISOString(),
    pinned_by: params.tenantContext.actor,
    ...params.finding,
  };
  await activeCollaborationStore.upsertPinnedFinding(record);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'collaboration_event',
    payload: { kind: 'finding_pinned', finding_id: record.id, finding_kind: record.finding_kind, title: record.title },
  });
  return record;
}

/** Test helper. */
export function _resetCollaborationStore(): void {
  activeCollaborationStore = new InMemoryCollaborationStore();
}
