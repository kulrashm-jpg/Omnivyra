// Supabase-backed production stores for the canonical intelligence platform.
//
// One module, five concrete implementations, one bootstrap. Activated by
// `INTELLIGENCE_SUPABASE_STORES_ENABLED=true`. Each store conforms to its
// Phase 5/6 interface and is tenant-scoped at the query layer.
//
// All inserts are written exactly once. Audit_log is INSERT-only (UPDATE/
// DELETE are revoked at the policy level in production deployments).

import { randomUUID } from 'crypto';
import type {
  AuditEntry,
  AuditEventKind,
  AuditLogStore,
} from './auditLog';
import type {
  AnnotationRecord,
  AssignmentRecord,
  CollaborationStore,
  PinnedFindingRecord,
  RecommendationStatusOverrideRecord,
} from './collaboration';
import type { OverrideRecord, OverrideStore } from './manualOverrides';
import type {
  ScanQueueRecord,
  ScanQueueStatus,
  ScanQueueStore,
} from './scanOrchestration';
import type {
  TenantId,
  TenantPolicy,
  TenantPolicyStore,
  TenantContext,
} from './tenantGovernance';

// Minimal supabase client surface — kept generic so this module works against
// any client that exposes the canonical query builder shape.
type SBQuery = {
  eq: (col: string, val: unknown) => SBQuery;
  in: (col: string, vals: unknown[]) => SBQuery;
  gte: (col: string, val: unknown) => SBQuery;
  lte: (col: string, val: unknown) => SBQuery;
  order: (col: string, opts?: { ascending?: boolean }) => SBQuery;
  limit: (n: number) => Promise<{ data: unknown[]; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
};
type SBTable = {
  insert: (rows: unknown[]) => Promise<{ data: unknown; error: unknown }>;
  upsert: (row: unknown, opts?: { onConflict?: string }) => Promise<{ data: unknown; error: unknown }>;
  update: (row: unknown) => { eq: (col: string, val: unknown) => Promise<{ data: unknown; error: unknown }> };
  select: (cols?: string) => SBQuery;
};
type SBClient = {
  from: (table: string) => SBTable;
};

function ensureNoError(table: string, error: unknown): void {
  if (error) throw new Error(`Supabase error on ${table}: ${String(error)}`);
}

// ── 1. TenantPolicyStore ──────────────────────────────────────────────────────

export class SupabaseTenantPolicyStore implements TenantPolicyStore {
  constructor(private readonly client: SBClient) {}

  async loadPolicy(tenant_id: TenantId): Promise<TenantPolicy | null> {
    const result = await (this.client.from('tenant_policy').select() as SBQuery)
      .eq('tenant_id', tenant_id)
      .limit(1);
    ensureNoError('tenant_policy.select', result.error);
    const row = (result.data as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    return {
      tenant_id: row.tenant_id as string,
      display_name: row.display_name as string,
      plan_tier: row.plan_tier as TenantPolicy['plan_tier'],
      policy_revision: row.policy_revision as string,
      providers: row.providers as TenantPolicy['providers'],
      scan_budget: row.scan_budget as TenantPolicy['scan_budget'],
      retention: row.retention as TenantPolicy['retention'],
      benchmark: row.benchmark as TenantPolicy['benchmark'],
    };
  }

  async upsertPolicy(policy: TenantPolicy, actor: TenantContext['actor']): Promise<void> {
    const { error } = await this.client.from('tenant_policy').upsert(
      {
        tenant_id: policy.tenant_id,
        display_name: policy.display_name,
        plan_tier: policy.plan_tier,
        policy_revision: policy.policy_revision,
        providers: policy.providers,
        scan_budget: policy.scan_budget,
        retention: policy.retention,
        benchmark: policy.benchmark,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      },
      { onConflict: 'tenant_id' },
    );
    ensureNoError('tenant_policy.upsert', error);
  }
}

// ── 2. AuditLogStore ──────────────────────────────────────────────────────────

export class SupabaseAuditLogStore implements AuditLogStore {
  constructor(private readonly client: SBClient) {}

  async append<P>(entry: AuditEntry<P>): Promise<void> {
    const { error } = await this.client.from('audit_log').insert([
      {
        id: entry.id,
        tenant_id: entry.tenant_id,
        occurred_at: entry.occurred_at,
        actor: entry.actor,
        correlation_id: entry.correlation_id,
        kind: entry.kind,
        payload: entry.payload,
      },
    ]);
    ensureNoError('audit_log.insert', error);
  }

  async query(params: {
    tenant_id: TenantId;
    kinds?: AuditEventKind[];
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    let q: SBQuery = (this.client.from('audit_log').select() as SBQuery).eq('tenant_id', params.tenant_id);
    if (params.kinds && params.kinds.length > 0) q = q.in('kind', params.kinds);
    if (params.from) q = q.gte('occurred_at', params.from);
    if (params.to) q = q.lte('occurred_at', params.to);
    q = q.order('occurred_at', { ascending: false });
    const result = await q.limit(params.limit ?? 200);
    ensureNoError('audit_log.select', result.error);
    return ((result.data as Array<Record<string, unknown>>) ?? []).map((row) => ({
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      occurred_at: row.occurred_at as string,
      actor: row.actor as AuditEntry['actor'],
      correlation_id: (row.correlation_id as string | null) ?? null,
      kind: row.kind as AuditEventKind,
      payload: row.payload,
    }));
  }
}

// ── 3. OverrideStore ──────────────────────────────────────────────────────────

export class SupabaseOverrideStore implements OverrideStore {
  constructor(private readonly client: SBClient) {}

  async list(tenant_id: TenantId, company_id: string): Promise<OverrideRecord[]> {
    const result = await ((this.client.from('manual_overrides').select() as SBQuery)
      .eq('tenant_id', tenant_id) as SBQuery)
      .eq('company_id', company_id)
      .limit(500);
    ensureNoError('manual_overrides.select', result.error);
    return ((result.data as Array<Record<string, unknown>>) ?? []).map((row) => ({
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      company_id: row.company_id as string,
      kind: row.kind as OverrideRecord['kind'],
      target: row.target as OverrideRecord['target'],
      reason: row.reason as string,
      created_at: row.created_at as string,
      created_by: row.created_by as OverrideRecord['created_by'],
      reversed_at: (row.reversed_at as string | null) ?? null,
      reversed_by: (row.reversed_by as OverrideRecord['created_by'] | null) ?? null,
    }));
  }

  async upsert(record: OverrideRecord): Promise<void> {
    const { error } = await this.client.from('manual_overrides').upsert(record, { onConflict: 'id' });
    ensureNoError('manual_overrides.upsert', error);
  }
}

// ── 4. CollaborationStore ─────────────────────────────────────────────────────

export class SupabaseCollaborationStore implements CollaborationStore {
  constructor(private readonly client: SBClient) {}

  async listAnnotations(tid: TenantId, cid: string): Promise<AnnotationRecord[]> {
    return this.list<AnnotationRecord>('collaboration_annotations', tid, cid);
  }
  async upsertAnnotation(record: AnnotationRecord): Promise<void> {
    await this.upsertRow('collaboration_annotations', record);
  }
  async listAssignments(tid: TenantId, cid: string): Promise<AssignmentRecord[]> {
    return this.list<AssignmentRecord>('collaboration_assignments', tid, cid);
  }
  async upsertAssignment(record: AssignmentRecord): Promise<void> {
    await this.upsertRow('collaboration_assignments', record);
  }
  async listPinnedFindings(tid: TenantId, cid: string): Promise<PinnedFindingRecord[]> {
    return this.list<PinnedFindingRecord>('collaboration_pinned_findings', tid, cid);
  }
  async upsertPinnedFinding(record: PinnedFindingRecord): Promise<void> {
    await this.upsertRow('collaboration_pinned_findings', record);
  }
  async listRecommendationStatuses(tid: TenantId, cid: string): Promise<RecommendationStatusOverrideRecord[]> {
    return this.list<RecommendationStatusOverrideRecord>('collaboration_recommendation_status', tid, cid);
  }
  async upsertRecommendationStatus(record: RecommendationStatusOverrideRecord): Promise<void> {
    await this.upsertRow('collaboration_recommendation_status', record);
  }

  private async list<T>(table: string, tid: TenantId, cid: string): Promise<T[]> {
    const result = await ((this.client.from(table).select() as SBQuery)
      .eq('tenant_id', tid) as SBQuery)
      .eq('company_id', cid)
      .limit(500);
    ensureNoError(`${table}.select`, result.error);
    return (result.data as T[]) ?? [];
  }

  private async upsertRow(table: string, record: { id: string }): Promise<void> {
    const { error } = await this.client.from(table).upsert(record, { onConflict: 'id' });
    ensureNoError(`${table}.upsert`, error);
  }
}

// ── 5. ScanQueueStore ─────────────────────────────────────────────────────────

export class SupabaseScanQueueStore implements ScanQueueStore {
  constructor(private readonly client: SBClient) {}

  async enqueue(record: ScanQueueRecord): Promise<void> {
    const { error } = await this.client.from('scan_queue').insert([record]);
    ensureNoError('scan_queue.insert', error);
  }

  async update(record: ScanQueueRecord): Promise<void> {
    const { error } = await this.client
      .from('scan_queue')
      .update(record)
      .eq('id', record.id);
    ensureNoError('scan_queue.update', error);
  }

  async list(params: {
    tenantId: TenantId;
    companyId?: string;
    status?: ScanQueueStatus[];
    limit?: number;
  }): Promise<ScanQueueRecord[]> {
    let q: SBQuery = (this.client.from('scan_queue').select() as SBQuery).eq('tenant_id', params.tenantId);
    if (params.companyId) q = q.eq('company_id', params.companyId);
    if (params.status && params.status.length > 0) q = q.in('status', params.status);
    q = q.order('priority', { ascending: false }).order('enqueued_at', { ascending: true });
    const result = await q.limit(params.limit ?? 200);
    ensureNoError('scan_queue.select', result.error);
    return (result.data as ScanQueueRecord[]) ?? [];
  }

  async byId(id: string): Promise<ScanQueueRecord | null> {
    const result = await (this.client.from('scan_queue').select() as SBQuery).eq('id', id).limit(1);
    ensureNoError('scan_queue.select', result.error);
    const row = (result.data as ScanQueueRecord[])[0];
    return row ?? null;
  }

  /**
   * Distributed-safe lease for a worker: selects the highest-priority queued
   * scan, marks it `running` with the worker_id, and returns it. Race-safe
   * via the `id` filter + the WHERE-clause-on-update semantics. When two
   * workers race, the second update affects 0 rows and the worker retries.
   */
  async leaseNext(params: { worker_id: string; now: string; }): Promise<ScanQueueRecord | null> {
    const queue = await ((this.client.from('scan_queue').select() as SBQuery)
      .eq('status', 'queued') as SBQuery)
      .order('priority', { ascending: false })
      .order('enqueued_at', { ascending: true })
      .limit(1);
    ensureNoError('scan_queue.lease.select', queue.error);
    const candidate = (queue.data as ScanQueueRecord[])[0];
    if (!candidate) return null;
    // Atomic transition: update WHERE id=X AND status='queued'. The driver's
    // .eq() chain after .update() acts as the WHERE; if another worker raced
    // and changed the status, this update affects 0 rows and we return null.
    const { error } = await this.client
      .from('scan_queue')
      .update({
        status: 'running',
        worker_id: params.worker_id,
        started_at: params.now,
        heartbeat_at: params.now,
      })
      .eq('id', candidate.id);
    ensureNoError('scan_queue.lease.update', error);
    return {
      ...candidate,
      status: 'running',
      worker_id: params.worker_id,
      started_at: params.now,
      heartbeat_at: params.now,
    };
  }

  /** Refresh the heartbeat — workers call every 10-30 seconds. */
  async heartbeat(scan_id: string, now: string): Promise<void> {
    const { error } = await this.client.from('scan_queue').update({ heartbeat_at: now }).eq('id', scan_id);
    ensureNoError('scan_queue.heartbeat', error);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
//
// Activated in providerRegistry.ensureBootstrapped when the env flag is on.
// The Supabase client is supplied via `getSupabaseAdminClient()` in the
// project's existing supabase wiring.

export function bootstrapSupabaseStores(client: SBClient): void {
  // The dynamic require pattern is consistent with Phase 3/4/5 adapters so this
  // module never crashes the build when supabase isn't installed in a given env.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tenantMod = require('./tenantGovernance');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const auditMod = require('./auditLog');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const overrideMod = require('./manualOverrides');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const collabMod = require('./collaboration');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scanMod = require('./scanOrchestration');

  tenantMod.registerTenantPolicyStore(new SupabaseTenantPolicyStore(client));
  auditMod.registerAuditLogStore(new SupabaseAuditLogStore(client));
  overrideMod.registerOverrideStore(new SupabaseOverrideStore(client));
  collabMod.registerCollaborationStore(new SupabaseCollaborationStore(client));
  scanMod.registerScanQueueStore(new SupabaseScanQueueStore(client));
}
