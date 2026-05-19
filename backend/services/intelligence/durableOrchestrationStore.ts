/**
 * Durable, multi-instance-safe orchestration state — WITHOUT new schema.
 *
 * Reuses the EXISTING append-only `audit_events` table (via recordAuditEvent)
 * as the durable substrate for self-heal / ops orchestration history and
 * cooldown. Rationale: introducing new tables here would require a migration,
 * and the prod migration ledger is intentionally hand-applied — a service that
 * hard-depends on an unapplied table would be fragile. `audit_events` is
 * already durable, tenant-scoped, and append-only.
 *
 * Capability is probed once; if `audit_events` is unreadable the caller falls
 * back to the existing in-memory behaviour (zero regression, no hard dep).
 *
 * Lineage model: every orchestration record is an audit_event with
 *   resource_type = 'orchestration'
 *   action        = `orchestration.<kind>`
 *   resource_id   = companyId
 *   metadata      = { correlationId, attempts/summary, ... }
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordAuditEvent } from '../auditEventService';

export interface DurableAttemptRecord {
  at: string;
  kind: 'self_heal_sweep' | 'self_heal_attempt' | 'ops_action';
  detail: Record<string, unknown>;
  correlationId: string;
}

let readable: boolean | null = null;

/** Probe (once) whether audit_events is queryable for this deployment. */
async function isReadable(): Promise<boolean> {
  if (readable !== null) return readable;
  try {
    const { error } = await ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('resource_type', 'orchestration')
      .limit(1);
    readable = !error;
  } catch {
    readable = false;
  }
  return readable;
}

export function newCorrelationId(): string {
  // No uuid import dependency — timestamp + random is sufficient for lineage.
  return `orc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Durably record an orchestration event (append-only via audit_events). */
export async function recordOrchestrationEvent(args: {
  companyId: string;
  kind: DurableAttemptRecord['kind'];
  correlationId: string;
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'worker';
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordAuditEvent({
      companyId: args.companyId,
      actorUserId: args.actorUserId ?? null,
      actorType: args.actorType ?? 'worker',
      action: `orchestration.${args.kind}`,
      resourceType: 'orchestration',
      resourceId: args.companyId,
      severity: 'info',
      metadata: { correlationId: args.correlationId, ...args.detail },
    });
  } catch {
    // recordAuditEvent already soft-fails; never throw into orchestration.
  }
}

/** Durable history for a company (newest first). Empty if unavailable. */
export async function getDurableHistory(
  companyId: string,
  limit = 50,
): Promise<DurableAttemptRecord[]> {
  if (!(await isReadable())) return [];
  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('action, resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'orchestration')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      at: r.created_at,
      kind: String(r.action || '').replace(/^orchestration\./, '') as DurableAttemptRecord['kind'],
      detail: (r.metadata ?? {}) as Record<string, unknown>,
      correlationId: String((r.metadata ?? {}).correlationId ?? ''),
    }));
  } catch {
    return [];
  }
}

/**
 * Durable, multi-instance-safe cooldown: returns ms remaining before the next
 * sweep of `kind` is allowed for this company (0 = allowed). Reads the newest
 * durable record; falls back to "allowed" if the store is unavailable so the
 * caller's in-memory cooldown still governs.
 */
export async function durableCooldownRemainingMs(
  companyId: string,
  kind: DurableAttemptRecord['kind'],
  cooldownMs: number,
): Promise<number> {
  if (!(await isReadable())) return 0;
  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'orchestration')
      .eq('action', `orchestration.${kind}`)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return 0;
    const last = Date.parse((data[0] as any).created_at);
    if (Number.isNaN(last)) return 0;
    return Math.max(0, cooldownMs - (Date.now() - last));
  } catch {
    return 0;
  }
}

// ── Distributed lease / mutex ────────────────────────────────────────────────
//
// Crash-safe, cross-instance advisory lock over the SAME append-only
// audit_events substrate (no new schema dependency). Acquisition is:
//   1. read newest `orchestration.lease.<scope>` for (company)
//   2. if absent OR expired (now > expiresAt) → write our lease row
//   3. re-read newest → we hold it iff the newest leaseId is ours
// Last-writer-wins on the append store resolves the race; the TTL makes a
// dead holder self-recover. This is ADVISORY (no atomic CAS without the
// hardened orchestration_state PK from the NOT-APPLIED 20260690 artifact) —
// it is layered ON TOP of the existing cooldown, so a lost race still can't
// double-sweep within the cooldown window.

export interface LeaseHandle {
  scope: string;
  leaseId: string;
  owner: string;
  expiresAt: number;
}

const LEASE_ACTION_PREFIX = 'orchestration.lease.';

async function newestLease(
  companyId: string,
  scope: string,
): Promise<{ leaseId: string; owner: string; expiresAt: number; at: number } | null> {
  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'orchestration')
      .eq('action', `${LEASE_ACTION_PREFIX}${scope}`)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const m = ((data[0] as any).metadata ?? {}) as Record<string, unknown>;
    return {
      leaseId: String(m.leaseId ?? ''),
      owner: String(m.owner ?? ''),
      expiresAt: Number(m.expiresAt ?? 0),
      at: Date.parse((data[0] as any).created_at) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Try to acquire a distributed lease. Returns a handle if acquired, else null
 * (another live holder). If the durable store is unavailable, returns a
 * best-effort local handle so single-instance behaviour is unaffected.
 */
export async function acquireLease(args: {
  companyId: string;
  scope: string;
  owner: string;
  ttlMs: number;
}): Promise<LeaseHandle | null> {
  const { companyId, scope, owner, ttlMs } = args;
  if (!(await isReadable())) {
    return { scope, leaseId: newCorrelationId(), owner, expiresAt: Date.now() + ttlMs };
  }
  const current = await newestLease(companyId, scope);
  const now = Date.now();
  if (current && current.expiresAt > now && current.leaseId) {
    return null; // a live lease is held by someone
  }
  const leaseId = newCorrelationId();
  const expiresAt = now + ttlMs;
  await writeLeaseRow(companyId, scope, { leaseId, owner, expiresAt }).catch(() => undefined);
  // Re-read: we win only if the newest lease row is ours.
  const confirm = await newestLease(companyId, scope);
  if (confirm && confirm.leaseId === leaseId) {
    return { scope, leaseId, owner, expiresAt };
  }
  return null;
}

/** Release a lease (writes a tombstone so the slot frees immediately). */
export async function releaseLease(
  companyId: string,
  handle: LeaseHandle,
): Promise<void> {
  if (!(await isReadable())) return;
  await writeLeaseRow(companyId, handle.scope, {
    leaseId: handle.leaseId,
    owner: handle.owner,
    expiresAt: 0, // tombstone — frees the slot immediately
  }).catch(() => undefined);
}

async function writeLeaseRow(
  companyId: string,
  scope: string,
  m: { leaseId: string; owner: string; expiresAt: number },
): Promise<void> {
  await recordAuditEvent({
    companyId,
    actorType: 'worker',
    action: `${LEASE_ACTION_PREFIX}${scope}`,
    resourceType: 'orchestration',
    resourceId: companyId,
    severity: 'info',
    metadata: { correlationId: m.leaseId, ...m },
  });
}

/** Inspect the active lease for diagnostics (null if free/expired). */
export async function getActiveLease(
  companyId: string,
  scope: string,
): Promise<{ owner: string; expiresAt: number; expired: boolean } | null> {
  const l = await newestLease(companyId, scope);
  if (!l || !l.leaseId || l.expiresAt === 0) return null;
  return { owner: l.owner, expiresAt: l.expiresAt, expired: l.expiresAt <= Date.now() };
}

/** Test/ops: reset the capability probe (e.g. after a migration is applied). */
export function __resetDurableProbe(): void {
  readable = null;
}
