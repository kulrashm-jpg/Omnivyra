/**
 * D2 — owner ruling 2026-11-04 (Checkpoint 1, item 7): provider evidence debt.
 *
 * A complaint or a permanent bounce restricts the recipient whether or not its
 * delivery evidence could be saved (sesProviderEventIngestion, D7). A failed
 * write answers 503 so SNS retries, but SNS retries are bounded, so the failure
 * is ALSO recorded here, once per provider event, with enough context to
 * recover and audit it: tenant, event and message ids, event type, signal,
 * channel, task, attempt, the governance records in force (which identify the
 * recipient without copying the address), and the operations that failed.
 *
 * This is not a suppression or consent store. Nothing here decides whether a
 * recipient may be contacted, and reconciliation never revokes, narrows or
 * delays a restriction. It only:
 *   - replays the idempotent evidence write (keyed on the provider event id);
 *   - for a complaint, ADDS the person-anchored restriction when the task names
 *     a person (the webhook could not write it: the task read or the
 *     restriction write failed). A person-anchored record is keyed on the
 *     person, so this converges on the record the webhook would have written.
 * An ADDRESS anchor that was never written cannot be rebuilt here (the address
 * is deliberately not stored). The row stays open with reason
 * `address_anchor_awaiting_redelivery` until the provider's own retry writes it,
 * and stays visible to operators until then.
 *
 * Nothing here logs or returns an address.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { ingestFeedback } from '../leadOutreachExecution/feedbackIngestion';
import { getOutreachTaskById } from '../leadOutreachExecution/storage';
import { recordContactGovernance, GovernanceWriteError } from '../prospectIdentity/contactGovernanceWriter';

export const EVIDENCE_RECONCILIATION_TABLE = 'outreach_provider_evidence_reconciliation';

export type EvidenceDebtOperation = 'task_read' | 'delivery_evidence' | 'restriction';

export interface EvidenceDebtInput {
  companyId: string;
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  signal: string;
  occurredAt: string;
  channel: string;
  taskId: string | null;
  attemptId: string | null;
  governanceType: 'bounce_hard' | 'complaint' | null;
  /** Records in force for this event, ADDRESS anchor first (writeGovernance order). */
  governanceRecordIds: string[];
  failedOperations: EvidenceDebtOperation[];
  failureReason: string;
  /** The address-free normalized evidence summary (replayed as-is). */
  evidence: Record<string, unknown>;
}

/** 'recorded': the debt is durable. 'unrecorded': it could not be saved either. */
export type EvidenceDebtWrite = 'recorded' | 'unrecorded';

const CODE = /^[a-z0-9_]{1,64}$/;
const code = (reason: unknown): string => {
  const s = String(reason ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64);
  return CODE.test(s) ? s : 'unknown_failure';
};

const errCode = (e: unknown): string | null => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : null;
};

/**
 * Record (or refresh) the debt for one provider event. A resolved row is never
 * reopened or changed. Never throws: a failure to record is reported as
 * 'unrecorded' and logged with ids only, and the caller still answers non-2xx.
 */
export async function recordEvidenceDebt(input: EvidenceDebtInput): Promise<EvidenceDebtWrite> {
  const nowIso = new Date().toISOString();
  const row = {
    company_id: input.companyId,
    provider: input.provider,
    provider_event_id: input.providerEventId,
    provider_message_id: input.providerMessageId,
    event_type: input.eventType,
    signal: input.signal,
    occurred_at: input.occurredAt,
    channel: input.channel,
    task_id: input.taskId,
    attempt_id: input.attemptId,
    governance_type: input.governanceType,
    governance_record_ids: [...new Set(input.governanceRecordIds)],
    failed_operations: [...new Set(input.failedOperations)],
    failure_reason: code(input.failureReason),
    evidence: input.evidence,
    status: 'open',
    first_failed_at: nowIso,
    last_failed_at: nowIso,
  };
  try {
    const ins = await ownedDbTable(EVIDENCE_RECONCILIATION_TABLE).insert(row);
    if (!ins.error) return 'recorded';
    if (errCode(ins.error) !== '23505') return unrecorded(input, errCode(ins.error) ?? 'insert_failed');

    // The event already has a row (an SNS retry). Refresh it only while open,
    // keeping the earliest failure time and widening what is known to be in force.
    const existing = await ownedDbTable(EVIDENCE_RECONCILIATION_TABLE)
      .select('status, governance_record_ids')
      .eq('provider', input.provider)
      .eq('provider_event_id', input.providerEventId)
      .maybeSingle();
    if (existing.error || !existing.data) return unrecorded(input, errCode(existing.error) ?? 'reread_failed');
    const current = existing.data as { status: string; governance_record_ids: string[] | null };
    if (current.status !== 'open') return 'recorded';
    const upd = await ownedDbTable(EVIDENCE_RECONCILIATION_TABLE)
      .update({
        failed_operations: row.failed_operations,
        failure_reason: row.failure_reason,
        last_failed_at: nowIso,
        governance_record_ids: [...new Set([...(current.governance_record_ids ?? []), ...row.governance_record_ids])],
        task_id: input.taskId,
        attempt_id: input.attemptId,
      })
      .eq('provider', input.provider)
      .eq('provider_event_id', input.providerEventId)
      .eq('status', 'open');
    return upd.error ? unrecorded(input, errCode(upd.error) ?? 'update_failed') : 'recorded';
  } catch (e) {
    return unrecorded(input, errCode(e) ?? 'threw');
  }
}

function unrecorded(input: EvidenceDebtInput, reason: string): EvidenceDebtWrite {
  // Ids and codes only: the event can be found in the provider's own records.
  console.error('[ses-evidence] EVIDENCE_DEBT_UNRECORDED', {
    companyId: input.companyId,
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    failedOperations: input.failedOperations,
    failureReason: code(input.failureReason),
    ledgerError: code(reason),
  });
  return 'unrecorded';
}

/**
 * Close an open debt after a later delivery of the same event fully succeeded.
 * Best effort: a row left open is closed by the next reconciliation run, which
 * finds the evidence already present.
 */
export async function resolveEvidenceDebtIfOpen(provider: string, providerEventId: string): Promise<void> {
  try {
    await ownedDbTable(EVIDENCE_RECONCILIATION_TABLE)
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution: 'provider_retry' })
      .eq('provider', provider)
      .eq('provider_event_id', providerEventId)
      .eq('status', 'open');
  } catch {
    /* left open for reconciliation */
  }
}

interface DebtRow {
  id: string;
  company_id: string;
  provider: string;
  provider_event_id: string;
  provider_message_id: string;
  event_type: string;
  signal: string;
  occurred_at: string;
  channel: string;
  task_id: string | null;
  attempt_id: string | null;
  governance_type: string | null;
  governance_record_ids: string[] | null;
  failed_operations: EvidenceDebtOperation[];
  evidence: Record<string, unknown> | null;
  reconcile_attempts: number | null;
}

export interface ReconcileSummary {
  examined: number;
  resolved: number;
  stillOpen: number;
  /** Debts this run could not even read or update (the run is safe to repeat). */
  errors: number;
}

/**
 * Replay open evidence debts. Idempotent: the evidence write is keyed on the
 * provider event id (a duplicate is success), the governance write is a no-op
 * when present, and a resolved row is never touched again. Restrictions are
 * only ever added. Every run is recorded on the row (attempts, time, reason).
 */
export async function reconcileSesEvidenceDebt(opts: {
  governanceSource: string;
  companyId?: string;
  limit?: number;
}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { examined: 0, resolved: 0, stillOpen: 0, errors: 0 };
  let q = ownedDbTable(EVIDENCE_RECONCILIATION_TABLE).select('*').eq('status', 'open');
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  const res = await q.order('first_failed_at', { ascending: true }).limit(Math.max(1, Math.min(opts.limit ?? 100, 500)));
  if (res.error) {
    summary.errors += 1;
    return summary;
  }

  for (const debt of (res.data ?? []) as DebtRow[]) {
    summary.examined += 1;
    const step = await replayOne(debt, opts.governanceSource);
    const nowIso = new Date().toISOString();
    const attempts = (debt.reconcile_attempts ?? 0) + 1;
    const patch = step.done
      ? { status: 'resolved', resolved_at: nowIso, resolution: 'replayed', last_reconcile_at: nowIso, last_reconcile_reason: null,
          reconcile_attempts: attempts, governance_record_ids: step.governanceRecordIds }
      : { last_reconcile_at: nowIso, last_reconcile_reason: code(step.reason), reconcile_attempts: attempts,
          governance_record_ids: step.governanceRecordIds };
    try {
      const upd = await ownedDbTable(EVIDENCE_RECONCILIATION_TABLE).update(patch).eq('id', debt.id).eq('status', 'open');
      if (upd.error) summary.errors += 1;
      else if (step.done) summary.resolved += 1;
      else summary.stillOpen += 1;
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}

async function replayOne(
  debt: DebtRow,
  governanceSource: string,
): Promise<{ done: boolean; reason: string | null; governanceRecordIds: string[] }> {
  const ids = new Set(debt.governance_record_ids ?? []);
  const ops = new Set(debt.failed_operations ?? []);
  const keep = (reason: string) => ({ done: false, reason, governanceRecordIds: [...ids] });

  if (!debt.task_id || !debt.attempt_id) return keep('task_unresolved');
  const task = await getOutreachTaskById(debt.company_id, debt.task_id);
  if (!task) return keep('task_read_failed');

  const feedback = await ingestFeedback({
    companyId: debt.company_id,
    taskId: debt.task_id,
    signal: debt.signal as never,
    occurredAt: debt.occurred_at,
    source: 'provider_webhook',
    provider: debt.provider,
    providerEventId: debt.provider_event_id,
    attemptId: debt.attempt_id,
    evidence: debt.evidence ?? {},
  });
  if (!feedback.ok) return keep(String(feedback.rejection));

  // A complaint's PERSON anchor is missing when the task could not be read or
  // the restriction write failed. Add it (never removes anything).
  if (debt.governance_type === 'complaint' && task.personId && (ops.has('task_read') || ops.has('restriction'))) {
    try {
      const written = await recordContactGovernance({
        organizationId: debt.company_id,
        governanceType: 'complaint',
        channel: '*',
        personId: task.personId,
        target: null,
        source: governanceSource,
        evidence: {
          snsMessageId: debt.provider_event_id,
          providerMessageId: debt.provider_message_id,
          taskId: debt.task_id,
          attemptId: debt.attempt_id,
          reconciledFrom: 'evidence_debt',
        },
        effectiveFrom: Date.parse(debt.occurred_at) <= Date.now() ? debt.occurred_at : new Date().toISOString(),
      });
      ids.add(written.id);
    } catch (e) {
      return keep(e instanceof GovernanceWriteError ? e.code : 'governance_write_failed');
    }
  }

  // The ADDRESS anchor is written first by the webhook, so a restriction
  // failure with no record in force means the address was never restricted.
  // It cannot be rebuilt without the address: wait for the provider's retry.
  if (ops.has('restriction') && (debt.governance_record_ids ?? []).length === 0) {
    return keep('address_anchor_awaiting_redelivery');
  }
  return { done: true, reason: null, governanceRecordIds: [...ids] };
}
