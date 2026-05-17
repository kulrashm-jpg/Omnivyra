/**
 * Idempotency Recovery Service — Phase C / E
 *
 * Stale-operation recovery + admin recovery actions. All recovery actions:
 *   - verify financial state consistency BEFORE transitioning the
 *     operational status (no recovery if it would create drift)
 *   - emit anomaly + financial-audit events
 *   - update metrics counters
 *   - are RBAC-gated at the endpoint layer (this service is called by
 *     admin endpoints + the expiry cron; it does not enforce auth itself)
 *
 * Critical invariant: this service NEVER touches `credit_transactions` or
 * `organization_credits`. It only flips operational tracking rows
 * (`billing_operations`, `job_execution_registry`, `credit_action_approvals`)
 * to terminal states.
 *
 * The reason it's safe to expire a stuck billing_operations row to 'error':
 *   - The financial ledger is the source of truth. If a HOLD exists with no
 *     CONFIRM/RELEASE sibling, the existing reaper handles it (releases the
 *     hold via `apply_credit_reservation(phase='release')`).
 *   - The billing_operations row is metadata-only; expiring it doesn't
 *     create or destroy any financial obligation.
 *   - The orchestrator's subsequent retry path opens a NEW billing_operations
 *     row (since UPSERT-on-key would return the same id — but if the id is
 *     terminal, the orchestrator should treat it as "already settled" and
 *     re-issue from scratch using a fresh idempotency suffix).
 *
 * For job_execution_registry: same logic — expire to `orphan_reaped` so
 * future retries get a fresh registry row.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { emitAnomaly, emitFinancialAudit } from '../billingAuditEmitter';
import { incrCounter } from '../billingMetrics';
import { recordAdminAudit } from '../../adminAuditService';
import {
  billingOperationStatusToState,
  jobRegistryStatusToState,
  approvalStatusToState,
  validateTransition,
  isTerminal,
  type IdempotencyState,
} from './idempotencyStateMachine';

// ── Configurable expiry windows (seconds) ─────────────────────────────────────

export const EXPIRY_WINDOWS = {
  billing_operations_default:  30 * 60,   // 30 min
  queue_job:                   15 * 60,   // 15 min
  ai_operation:                10 * 60,   // 10 min
  approval_pending:             7 * 24 * 60 * 60,  // 7 days (matches expires_at default)
  approval_approved_stale:      24 * 60 * 60,      // 24 hours past sign with no execute
  payment_event_recorded:      30 * 60,   // 30 min
} as const;

// ── Stuck operation discovery ─────────────────────────────────────────────────

export interface StuckOperation {
  surface:       'billing_operations' | 'job_execution_registry' | 'credit_action_approvals' | 'payment_provider_event_state';
  id:            string;
  organizationId: string | null;
  state:         IdempotencyState;
  rawStatus:     string;
  startedAt:     string;
  ageSec:        number;
  metadata:      Record<string, unknown>;
}

export async function findStuckOperations(opts?: {
  windowSec?: number;
  surfaces?:  StuckOperation['surface'][];
  limit?:     number;
}): Promise<StuckOperation[]> {
  const surfaces = opts?.surfaces ?? ['billing_operations', 'job_execution_registry', 'credit_action_approvals'];
  const limit    = opts?.limit ?? 500;
  const out: StuckOperation[] = [];

  if (surfaces.includes('billing_operations')) {
    const cutoff = new Date(Date.now() - (opts?.windowSec ?? EXPIRY_WINDOWS.billing_operations_default) * 1000).toISOString();
    const { data } = await supabase
      .from('billing_operations')
      .select('id, organization_id, status, started_at, metadata')
      .in('status', ['initiated', 'held', 'executed'])
      .lt('started_at', cutoff)
      .limit(limit);
    for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
      const startedAt = String(row.started_at);
      out.push({
        surface:        'billing_operations',
        id:             String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : null,
        state:          billingOperationStatusToState(String(row.status)),
        rawStatus:      String(row.status),
        startedAt,
        ageSec:         Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)),
        metadata:       (row.metadata as Record<string, unknown>) ?? {},
      });
    }
  }

  if (surfaces.includes('job_execution_registry')) {
    const cutoff = new Date(Date.now() - (opts?.windowSec ?? EXPIRY_WINDOWS.queue_job) * 1000).toISOString();
    const { data } = await supabase
      .from('job_execution_registry')
      .select('id, organization_id, status, first_seen_at, last_seen_at, retry_count, metadata')
      .in('status', ['reserved', 'in_progress'])
      .lt('last_seen_at', cutoff)
      .limit(limit);
    for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
      const startedAt = String(row.first_seen_at);
      out.push({
        surface:        'job_execution_registry',
        id:             String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : null,
        state:          jobRegistryStatusToState(String(row.status)),
        rawStatus:      String(row.status),
        startedAt,
        ageSec:         Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)),
        metadata:       { ...(row.metadata as Record<string, unknown> ?? {}), retry_count: row.retry_count },
      });
    }
  }

  if (surfaces.includes('credit_action_approvals')) {
    const { data: pending } = await supabase
      .from('credit_action_approvals')
      .select('id, organization_id, status, proposed_at, expires_at, action_type, payload')
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .limit(limit);
    const pendingRows = (pending ?? []) as Array<Record<string, unknown>>;
    for (const row of pendingRows) {
      const startedAt = String(row.proposed_at);
      out.push({
        surface:        'credit_action_approvals',
        id:             String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : null,
        state:          approvalStatusToState(String(row.status)),
        rawStatus:      String(row.status),
        startedAt,
        ageSec:         Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)),
        metadata:       { action_type: row.action_type, expires_at: row.expires_at, payload: row.payload },
      });
    }
  }

  return out;
}

// ── Recovery actions ─────────────────────────────────────────────────────────

export type RecoveryAction = 'expire' | 'cancel' | 'mark_failed';

export interface RecoveryArgs {
  surface:     StuckOperation['surface'];
  id:          string;
  action:      RecoveryAction;
  actorUserId: string;
  reason:      string;
}

export interface RecoveryResult {
  ok:           boolean;
  surface:      StuckOperation['surface'];
  id:           string;
  fromStatus?:  string;
  toStatus?:    string;
  error?:       string;
  driftCheck?:  'ok' | 'drift_detected' | 'skipped';
}

/**
 * Expire a single stuck operation. Pre-flight: verify financial consistency.
 *
 * For `billing_operations` rows:
 *   - Check that the related ledger HOLDs (idempotency_key) have either a
 *     CONFIRM or RELEASE sibling, OR no HOLD exists at all
 *   - If a HOLD exists with no terminal sibling, REFUSE to expire — the
 *     reaper must release the HOLD first
 *
 * For `job_execution_registry` rows:
 *   - Same check on `idempotency_key`
 *
 * For `credit_action_approvals` rows:
 *   - Only `pending` past `expires_at` is expirable
 *   - `approved` stale rows get `cancelled` via this same flow
 */
export async function recoverOperation(args: RecoveryArgs): Promise<RecoveryResult> {
  if (!args.reason?.trim()) {
    return { ok: false, surface: args.surface, id: args.id, error: 'reason required' };
  }

  // ── Drift pre-check ────────────────────────────────────────────────────
  const driftCheck = await checkFinancialDrift(args.surface, args.id);
  if (driftCheck === 'drift_detected') {
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: 'critical',
      message: `Recovery REFUSED for ${args.surface}:${args.id} — financial drift would result.`,
      metadata: { actor: args.actorUserId, action: args.action, reason: args.reason },
    });
    return { ok: false, surface: args.surface, id: args.id, error: 'DRIFT_DETECTED', driftCheck };
  }

  // ── Transition target ────────────────────────────────────────────────
  let toStatus: string;
  if (args.surface === 'credit_action_approvals' && args.action === 'cancel') {
    toStatus = 'cancelled';
  } else if (args.surface === 'credit_action_approvals' && args.action === 'expire') {
    toStatus = 'expired';
  } else if (args.surface === 'job_execution_registry') {
    toStatus = 'orphan_reaped';
  } else if (args.action === 'mark_failed') {
    toStatus = args.surface === 'billing_operations' ? 'error' : 'failed';
  } else {
    toStatus = args.surface === 'billing_operations' ? 'error' : 'orphan_reaped';
  }

  // ── Read current row to validate transition ──────────────────────────
  const currentRow = await readCurrent(args.surface, args.id);
  if (!currentRow) {
    return { ok: false, surface: args.surface, id: args.id, error: 'NOT_FOUND', driftCheck };
  }

  const fromState = surfaceStatusToState(args.surface, currentRow.status);
  const toState   = surfaceStatusToState(args.surface, toStatus);
  const transition = validateTransition(fromState, toState);
  if (!transition.ok) {
    return {
      ok: false, surface: args.surface, id: args.id,
      fromStatus: currentRow.status, toStatus,
      error: `INVALID_TRANSITION: ${transition.reason}`,
      driftCheck,
    };
  }

  // ── Apply transition ─────────────────────────────────────────────────
  const updated = await applyStatusUpdate(args.surface, args.id, toStatus, args.reason);
  if (!updated.ok) {
    return { ok: false, surface: args.surface, id: args.id, error: 'error' in updated ? updated.error : 'update failed', driftCheck };
  }

  // ── Audit + metrics ─────────────────────────────────────────────────
  await recordAdminAudit({
    actorUserId:    args.actorUserId,
    action:         'IDEMPOTENCY_RECOVERY',
    targetType:     args.surface,
    targetId:       args.id,
    metadata:       {
      from_status: currentRow.status,
      to_status:   toStatus,
      reason:      args.reason,
      drift_check: driftCheck,
    },
    idempotencyKey: `recovery:${args.surface}:${args.id}:${toStatus}`,
  }).catch(() => { /* audit best-effort */ });

  if (currentRow.organization_id) {
    await emitFinancialAudit({
      actorUserId:    args.actorUserId,
      actionType:     'system_correction',
      organizationId: String(currentRow.organization_id),
      reason:         `idempotency recovery: ${args.reason}`,
      reasonType:     'correction',
      metadata:       { surface: args.surface, id: args.id, from: currentRow.status, to: toStatus },
    });
  }

  incrCounter('recovery_action_total');
  const isSystemActor = args.actorUserId.startsWith('system:');
  if (isSystemActor) {
    incrCounter('stale_operation_auto_recovered_total');
  } else {
    incrCounter('manual_recovery_actions_total');
  }
  if (toStatus === 'expired' || toStatus === 'orphan_reaped' || toStatus === 'cancelled') {
    incrCounter('idempotency_expired_total');
    incrCounter('stale_operation_recovered_total');
  } else if (toStatus === 'error' || toStatus === 'failed') {
    incrCounter('idempotency_failed_total');
  }

  // ── Phase F: automated reconciliation hook after a terminal recovery ────
  // Fire-and-forget; the verdict is logged + emitted. A drift verdict raises
  // a CRITICAL anomaly that the dashboard surfaces for manual review.
  void runReconciliationAfterRecovery({
    surface: args.surface,
    id: args.id,
    organizationId: currentRow.organization_id ? String(currentRow.organization_id) : null,
    actorUserId: args.actorUserId,
  }).catch((err) => {
    logger.warn('reconciliation_after_recovery_failed', {
      surface: args.surface, id: args.id,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  emitAnomaly({
    organizationId: currentRow.organization_id ? String(currentRow.organization_id) : undefined,
    kind: 'reservation_orphan_reaped',
    severity: 'warn',
    message: `Idempotency recovery: ${args.surface}:${args.id} ${currentRow.status} → ${toStatus}`,
    metadata: { actor: args.actorUserId, reason: args.reason },
  });

  logger.info('idempotency_recovery_applied', {
    surface: args.surface, id: args.id, from: currentRow.status, to: toStatus, actor: args.actorUserId,
  });

  return {
    ok: true,
    surface: args.surface,
    id: args.id,
    fromStatus: currentRow.status,
    toStatus,
    driftCheck,
  };
}

// ── Phase D: Safe Retry generation ───────────────────────────────────────────

export interface SafeRetryArgs {
  surface:     'billing_operations' | 'job_execution_registry';
  id:          string;
  actorUserId: string;
  reason:      string;
}

export type SafeRetryResult =
  | {
      ok: true;
      surface: SafeRetryArgs['surface'];
      originalId: string;
      newIdempotencyKey: string;
      retryLineageId: string;
      message: string;
    }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'COMPLETED_SETTLEMENT' | 'ACTIVE_RESERVATION' | 'NOT_RECOVERABLE' | 'REASON_REQUIRED' | 'FAILED';
      message: string;
    };

/**
 * Generate a recovery-safe retry for a stuck operation.
 *
 * SAFETY CONTRACT (all must hold or we REFUSE):
 *   1. No COMPLETED settlement exists for the bound idempotency key
 *      (a CONFIRM row in credit_transactions ⇒ money already moved).
 *   2. No COMPLETED ledger mutation exists (grant/confirm rows).
 *   3. No ACTIVE (un-sibling'd) HOLD reservation exists — that means the
 *      original execution may still finish; we must NOT race it. The reaper
 *      must release it first.
 *
 * Only then do we:
 *   - mint a NEW idempotency key (random suffix — cannot collide with the
 *     stuck original),
 *   - record a retry-lineage row in admin_financial_audit_events linking
 *     new→original,
 *   - emit a recovery audit + metric.
 *
 * This NEVER re-runs the financial mutation itself. It only unblocks the
 * caller to submit a fresh request under a clean key. The actual re-execution
 * is the operator's subsequent action (e.g. re-clicking Grant), which now
 * carries the fresh key.
 */
export async function safeRetryOperation(args: SafeRetryArgs): Promise<SafeRetryResult> {
  if (!args.reason?.trim()) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'reason required' };
  }

  const idemKey = await readIdempotencyKey(args.surface, args.id);
  if (!idemKey) {
    return { ok: false, code: 'NOT_FOUND', message: `no idempotency_key bound to ${args.surface}:${args.id}` };
  }

  // 1+2. COMPLETED settlement / ledger mutation check — any CONFIRM or GRANT
  //      row for this key means money already moved; retry is forbidden.
  const { data: settled } = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .in('idempotency_key', [idemKey, `${idemKey}:confirm`])
    .in('execution_phase', ['confirm', 'grant'])
    .limit(1);
  if (settled && settled.length > 0) {
    return {
      ok: false,
      code: 'COMPLETED_SETTLEMENT',
      message: `Refusing retry: a completed ${String((settled[0] as { execution_phase: string }).execution_phase)} settlement already exists for this operation. Replay protection enforced.`,
    };
  }

  // 3. Active HOLD with no terminal sibling ⇒ original may still finish.
  const drift = await checkFinancialDrift(args.surface, args.id);
  if (drift === 'drift_detected') {
    return {
      ok: false,
      code: 'ACTIVE_RESERVATION',
      message: 'Refusing retry: an active HOLD reservation exists with no CONFIRM/RELEASE. The reaper must release it before a safe retry is possible.',
    };
  }

  // Ensure the stuck row is itself in a recoverable (non-terminal) state.
  const currentRow = await readCurrent(args.surface, args.id);
  if (!currentRow) {
    return { ok: false, code: 'NOT_FOUND', message: 'operation row not found' };
  }
  const fromState = surfaceStatusToState(args.surface, currentRow.status);
  if (isTerminal(fromState)) {
    return { ok: false, code: 'NOT_RECOVERABLE', message: `operation is already terminal (${currentRow.status})` };
  }

  // Mint a fresh, collision-proof idempotency key + lineage id.
  const retryLineageId = randomUUID();
  const newIdempotencyKey = `retry:${idemKey}:${retryLineageId}`;

  // First, finalize the stuck row so it stops blocking retries.
  const updated = await applyStatusUpdate(
    args.surface,
    args.id,
    args.surface === 'billing_operations' ? 'error' : 'orphan_reaped',
    `safe-retry supersede: ${args.reason}`,
  );
  if (!updated.ok) {
    return { ok: false, code: 'FAILED', message: ('error' in updated ? updated.error : undefined) ?? 'failed to finalize stuck row' };
  }

  // Lineage + audit.
  await recordAdminAudit({
    actorUserId:    args.actorUserId,
    action:         'IDEMPOTENCY_SAFE_RETRY',
    targetType:     args.surface,
    targetId:       args.id,
    metadata:       {
      original_idempotency_key: idemKey,
      new_idempotency_key:      newIdempotencyKey,
      retry_lineage_id:         retryLineageId,
      reason:                   args.reason,
    },
    idempotencyKey: `safe-retry:${args.surface}:${args.id}:${retryLineageId}`,
  }).catch(() => { /* best-effort */ });

  if (currentRow.organization_id) {
    await emitFinancialAudit({
      actorUserId:    args.actorUserId,
      actionType:     'system_correction',
      organizationId: String(currentRow.organization_id),
      reason:         `safe-retry generated: ${args.reason}`,
      reasonType:     'correction',
      metadata: {
        surface: args.surface,
        original_id: args.id,
        original_key: idemKey,
        new_key: newIdempotencyKey,
        retry_lineage_id: retryLineageId,
      },
    });
  }

  incrCounter('recovery_retry_total');
  incrCounter(args.actorUserId.startsWith('system:') ? 'stale_operation_auto_recovered_total' : 'manual_recovery_actions_total');

  emitAnomaly({
    organizationId: currentRow.organization_id ? String(currentRow.organization_id) : undefined,
    kind: 'reservation_orphan_reaped',
    severity: 'warn',
    message: `Safe retry generated for ${args.surface}:${args.id} — new key issued, original superseded`,
    metadata: { actor: args.actorUserId, retry_lineage_id: retryLineageId },
  });

  logger.info('idempotency_safe_retry_generated', {
    surface: args.surface, id: args.id, retry_lineage_id: retryLineageId, actor: args.actorUserId,
  });

  // Reconcile after we finalized the original row.
  void runReconciliationAfterRecovery({
    surface: args.surface,
    id: args.id,
    organizationId: currentRow.organization_id ? String(currentRow.organization_id) : null,
    actorUserId: args.actorUserId,
  }).catch(() => { /* logged inside */ });

  return {
    ok: true,
    surface: args.surface,
    originalId: args.id,
    newIdempotencyKey,
    retryLineageId,
    message: 'Original operation superseded. Re-submit the action with the new idempotency key.',
  };
}

// ── Phase F: Reconciliation-after-recovery ────────────────────────────────────

export interface ReconAfterRecoveryResult {
  verdict:   'consistent' | 'drift' | 'skipped';
  surface:   string;
  id:        string;
  details:   Record<string, unknown>;
}

/**
 * After any stuck operation is finalized, verify that the financial state is
 * still consistent. A `drift` verdict raises a CRITICAL anomaly + locks
 * retries (by leaving the operation in a state that safeRetry refuses) and
 * requires manual review.
 */
export async function runReconciliationAfterRecovery(args: {
  surface:        StuckOperation['surface'];
  id:             string;
  organizationId: string | null;
  actorUserId:    string;
}): Promise<ReconAfterRecoveryResult> {
  incrCounter('reconciliation_after_recovery_total');

  if (args.surface === 'credit_action_approvals' || args.surface === 'payment_provider_event_state') {
    return { verdict: 'skipped', surface: args.surface, id: args.id, details: { reason: 'no_financial_state' } };
  }

  const drift = await checkFinancialDrift(args.surface, args.id);
  if (drift === 'drift_detected') {
    emitAnomaly({
      organizationId: args.organizationId ?? undefined,
      kind: 'reservation_orphan_reaped',
      severity: 'critical',
      message: `RECONCILIATION-AFTER-RECOVERY DRIFT: ${args.surface}:${args.id} has an unreaped HOLD. Manual review required.`,
      metadata: { actor: args.actorUserId, requires_manual_review: true },
    });
    logger.error('reconciliation_after_recovery_drift', { surface: args.surface, id: args.id });
    return { verdict: 'drift', surface: args.surface, id: args.id, details: { drift } };
  }

  logger.info('reconciliation_after_recovery_consistent', { surface: args.surface, id: args.id });
  return { verdict: 'consistent', surface: args.surface, id: args.id, details: { drift } };
}

// ── Drift detection ─────────────────────────────────────────────────────────

export async function checkFinancialDrift(surface: StuckOperation['surface'], id: string): Promise<'ok' | 'drift_detected' | 'skipped'> {
  if (surface === 'credit_action_approvals') return 'skipped';  // approvals have no financial state themselves
  if (surface === 'payment_provider_event_state') return 'skipped';

  // For billing_operations + job_execution_registry: check whether the
  // bound idempotency_key has an unreaped HOLD in credit_transactions.
  const idemKey = await readIdempotencyKey(surface, id);
  if (!idemKey) return 'ok';

  // Check for HOLD with no sibling CONFIRM/RELEASE
  const { data: holdRows } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('idempotency_key', `${idemKey}:hold`)
    .eq('execution_phase', 'hold')
    .limit(1);
  if (!holdRows || holdRows.length === 0) return 'ok';  // no HOLD → no drift risk

  const holdId = String((holdRows[0] as { id: string }).id);
  const { data: siblings } = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .eq('parent_transaction_id', holdId)
    .in('execution_phase', ['confirm', 'release'])
    .limit(1);

  if (!siblings || siblings.length === 0) {
    // HOLD with no terminal sibling → reaper must run first
    return 'drift_detected';
  }
  return 'ok';
}

async function readIdempotencyKey(surface: StuckOperation['surface'], id: string): Promise<string | null> {
  if (surface === 'billing_operations') {
    const { data } = await supabase.from('billing_operations').select('idempotency_key').eq('id', id).maybeSingle();
    return (data as { idempotency_key?: string } | null)?.idempotency_key ?? null;
  }
  if (surface === 'job_execution_registry') {
    const { data } = await supabase.from('job_execution_registry').select('idempotency_key').eq('id', id).maybeSingle();
    return (data as { idempotency_key?: string } | null)?.idempotency_key ?? null;
  }
  return null;
}

// ── Update helpers ──────────────────────────────────────────────────────────

interface RowSummary { status: string; organization_id?: string | null }

async function readCurrent(surface: StuckOperation['surface'], id: string): Promise<RowSummary | null> {
  let table: string;
  switch (surface) {
    case 'billing_operations':      table = 'billing_operations'; break;
    case 'job_execution_registry':  table = 'job_execution_registry'; break;
    case 'credit_action_approvals': table = 'credit_action_approvals'; break;
    case 'payment_provider_event_state': table = 'payment_provider_event_state'; break;
  }
  const { data } = await supabase.from(table).select('status, organization_id').eq('id', id).maybeSingle();
  if (!data) return null;
  return data as RowSummary;
}

async function applyStatusUpdate(
  surface: StuckOperation['surface'],
  id: string,
  toStatus: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (surface === 'billing_operations') {
    const { error } = await supabase
      .from('billing_operations')
      .update({
        status:         toStatus,
        failure_reason: `recovery: ${reason}`,
        completed_at:   new Date().toISOString(),
      })
      .eq('id', id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (surface === 'job_execution_registry') {
    // Use the existing RPC so the monotonic-status guard is respected
    const { error } = await supabase.rpc('advance_job_execution', {
      p_execution_hash: undefined,  // we'll use the id-based path; if execution_hash needed, look it up first
      p_status:         toStatus,
      p_billing_operation_id: null,
      p_error:          `recovery: ${reason}`,
    });
    // Fallback: if the RPC needs execution_hash, do a direct UPDATE (safe
    // because the monotonic-status trigger validates the transition anyway).
    if (error) {
      const { error: directErr } = await supabase
        .from('job_execution_registry')
        .update({
          status:        toStatus,
          error_message: `recovery: ${reason}`,
          completed_at:  new Date().toISOString(),
          last_seen_at:  new Date().toISOString(),
        })
        .eq('id', id);
      if (directErr) return { ok: false, error: directErr.message };
    }
    return { ok: true };
  }
  if (surface === 'credit_action_approvals') {
    const { error } = await supabase
      .from('credit_action_approvals')
      .update({
        status:           toStatus,
        rejected_at:      new Date().toISOString(),
        rejection_reason: `recovery: ${reason}`,
      })
      .eq('id', id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  return { ok: false, error: 'unsupported surface' };
}

function surfaceStatusToState(surface: StuckOperation['surface'], status: string): IdempotencyState {
  switch (surface) {
    case 'billing_operations':      return billingOperationStatusToState(status);
    case 'job_execution_registry':  return jobRegistryStatusToState(status);
    case 'credit_action_approvals': return approvalStatusToState(status);
    default: return 'PENDING';
  }
}

// ── Bulk reconciliation scan ─────────────────────────────────────────────────

export interface RecoverySummary {
  scanned:            number;
  recovered:          number;
  refusedDueToDrift:  number;
  errors:             number;
  details:            Array<{ surface: string; id: string; from: string; to: string; status: 'recovered' | 'drift_refused' | 'error'; error?: string }>;
}

export async function reconcileStuckOperations(actorUserId: string, opts?: {
  windowSecOverride?: Partial<Record<StuckOperation['surface'], number>>;
  limitPerSurface?:   number;
  dryRun?:            boolean;
}): Promise<RecoverySummary> {
  const summary: RecoverySummary = {
    scanned: 0, recovered: 0, refusedDueToDrift: 0, errors: 0, details: [],
  };

  const surfaces: Array<StuckOperation['surface']> = [
    'billing_operations',
    'job_execution_registry',
    'credit_action_approvals',
  ];

  for (const surface of surfaces) {
    const windowSec = opts?.windowSecOverride?.[surface];
    const stuck = await findStuckOperations({
      surfaces: [surface],
      windowSec,
      limit: opts?.limitPerSurface ?? 200,
    });
    summary.scanned += stuck.length;
    if (opts?.dryRun) {
      for (const s of stuck) {
        summary.details.push({ surface: s.surface, id: s.id, from: s.rawStatus, to: '(dry-run)', status: 'recovered' });
      }
      continue;
    }
    for (const s of stuck) {
      const action: RecoveryAction = surface === 'credit_action_approvals' ? 'expire' : 'expire';
      const r = await recoverOperation({
        surface: s.surface, id: s.id, action,
        actorUserId, reason: `auto-expire: age=${s.ageSec}s`,
      });
      if (r.ok) {
        summary.recovered += 1;
        summary.details.push({ surface: s.surface, id: s.id, from: r.fromStatus ?? s.rawStatus, to: r.toStatus ?? '', status: 'recovered' });
      } else if (r.driftCheck === 'drift_detected') {
        summary.refusedDueToDrift += 1;
        summary.details.push({ surface: s.surface, id: s.id, from: s.rawStatus, to: '', status: 'drift_refused', error: r.error });
      } else {
        summary.errors += 1;
        summary.details.push({ surface: s.surface, id: s.id, from: s.rawStatus, to: '', status: 'error', error: r.error });
      }
    }
  }

  logger.info('idempotency_reconcile_summary', {
    scanned: summary.scanned,
    recovered: summary.recovered,
    drift_refused: summary.refusedDueToDrift,
    errors: summary.errors,
  });

  return summary;
}
