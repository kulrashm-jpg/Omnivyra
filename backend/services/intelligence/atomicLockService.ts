/**
 * Hardened distributed lock — atomic CAS + fencing, with SAFE FALLBACK.
 *
 * If the `orchestration_leases` table exists (controlled migration 20260691
 * applied) this uses true row-level CAS:
 *   - acquire = INSERT (PK conflict ⇒ lost race) OR conditional UPDATE of an
 *     EXPIRED lease guarded by the observed fencing token (optimistic CAS).
 *   - every acquisition returns a monotonically increasing `fencing` token so
 *     a resurrected dead worker holding a stale token is rejected by callers.
 *   - heartbeat extends `expires_at`; expiry → another instance may take over.
 *
 * If the table is ABSENT, it transparently falls back to the existing
 * advisory lease (durableOrchestrationStore) — ZERO regression to current
 * coordination, pure upgrade once the migration is applied.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { acquireLease as advisoryAcquire, releaseLease as advisoryRelease, type LeaseHandle } from './durableOrchestrationStore';

export interface AtomicLockHandle {
  scope: string;
  companyId: string;
  owner: string;
  fencing: number;
  expiresAt: number;
  mode: 'atomic' | 'advisory';
  advisory?: LeaseHandle;
}

let tablePresent: boolean | null = null;

async function hasLeaseTable(): Promise<boolean> {
  if (tablePresent !== null) return tablePresent;
  try {
    const { error } = await ownedDbTable('orchestration_leases')
      .select('company_id', { count: 'exact', head: true })
      .limit(1);
    tablePresent = !error;
  } catch {
    tablePresent = false;
  }
  return tablePresent;
}

interface LeaseRow {
  company_id: string;
  scope: string;
  lease_owner: string;
  fencing: number;
  expires_at: string;
}

/**
 * Acquire (or take over an expired) lock atomically. Returns a handle with a
 * fencing token, or null if a live lease is held by someone else.
 */
export async function acquireAtomicLock(args: {
  companyId: string;
  scope: string;
  owner: string;
  ttlMs: number;
}): Promise<AtomicLockHandle | null> {
  const { companyId, scope, owner, ttlMs } = args;

  if (!(await hasLeaseTable())) {
    const adv = await advisoryAcquire({ companyId, scope, owner, ttlMs }).catch(() => null);
    if (!adv) return null;
    return { scope, companyId, owner, fencing: 0, expiresAt: adv.expiresAt, mode: 'advisory', advisory: adv };
  }

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // 1) Try a clean INSERT — PK conflict means a row already exists.
  const ins = await ownedDbTable('orchestration_leases')
    .insert({ company_id: companyId, scope, lease_owner: owner, fencing: 1, acquired_at: nowIso, heartbeat_at: nowIso, expires_at: expiresAt })
    .select('fencing, expires_at')
    .maybeSingle();
  if (!ins.error && ins.data) {
    return { scope, companyId, owner, fencing: Number((ins.data as any).fencing) || 1, expiresAt: Date.parse(expiresAt), mode: 'atomic' };
  }

  // 2) Row exists — read it; only take over if EXPIRED, via fencing-guarded CAS.
  const cur = await ownedDbTable('orchestration_leases')
    .select('company_id, scope, lease_owner, fencing, expires_at')
    .eq('company_id', companyId)
    .eq('scope', scope)
    .maybeSingle();
  const row = cur.data as LeaseRow | null;
  if (!row) return null;
  if (Date.parse(row.expires_at) > Date.now()) return null; // live lease held

  const nextFencing = Number(row.fencing) + 1;
  const cas = await ownedDbTable('orchestration_leases')
    .update({ lease_owner: owner, fencing: nextFencing, acquired_at: nowIso, heartbeat_at: nowIso, expires_at: expiresAt })
    .eq('company_id', companyId)
    .eq('scope', scope)
    .eq('fencing', row.fencing) // optimistic CAS: lose if another instance took over
    .lte('expires_at', nowIso)
    .select('fencing')
    .maybeSingle();
  if (cas.error || !cas.data) return null; // lost the takeover race
  return { scope, companyId, owner, fencing: nextFencing, expiresAt: Date.parse(expiresAt), mode: 'atomic' };
}

/** Extend a held lease (dead-worker recovery relies on expiry, not heartbeat). */
export async function heartbeatAtomicLock(handle: AtomicLockHandle, ttlMs: number): Promise<boolean> {
  if (handle.mode === 'advisory') return true;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const r = await ownedDbTable('orchestration_leases')
    .update({ heartbeat_at: new Date().toISOString(), expires_at: expiresAt })
    .eq('company_id', handle.companyId)
    .eq('scope', handle.scope)
    .eq('lease_owner', handle.owner)
    .eq('fencing', handle.fencing) // fencing guard: stale holder cannot extend
    .select('fencing')
    .maybeSingle();
  return !r.error && Boolean(r.data);
}

export async function releaseAtomicLock(handle: AtomicLockHandle): Promise<void> {
  if (handle.mode === 'advisory' && handle.advisory) {
    await advisoryRelease(handle.companyId, handle.advisory).catch(() => undefined);
    return;
  }
  // Free the slot by expiring it (fencing-guarded so we only release our own).
  await ownedDbTable('orchestration_leases')
    .update({ expires_at: new Date(0).toISOString() })
    .eq('company_id', handle.companyId)
    .eq('scope', handle.scope)
    .eq('lease_owner', handle.owner)
    .eq('fencing', handle.fencing)
    .then(() => undefined, () => undefined);
}

/** Reset the table-presence probe (e.g. after the migration is applied). */
export function __resetLeaseTableProbe(): void {
  tablePresent = null;
}
