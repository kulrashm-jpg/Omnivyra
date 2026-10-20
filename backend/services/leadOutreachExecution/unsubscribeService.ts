/**
 * WP3 / L4 — record an outreach unsubscribe from a verified token.
 *
 * The token has already been authenticated by the route. This module turns it
 * into standing governance, and nothing else:
 *
 *   1. the attempt is read WITH the token's tenant as a predicate, so a token
 *      naming another tenant's attempt (or a deleted one) resolves to nothing;
 *   2. the task supplies the person anchor, when it has one;
 *   3. `recordContactGovernance` — the only writer of canonical governance — is
 *      called once per anchor (WP3 decision A/C):
 *        • TARGET  — the exact address the email went to, channel `*`;
 *        • PERSON  — the task's person, channel `*`, when the task has one.
 *      Two rows by design (PI-CONTRACT-001 §3.2): the address survives an
 *      erasure of the person, and the person anchor follows them to new
 *      addresses. Revoking one does not revoke the other; revocation is an
 *      operator act (decision D) and is not implemented here.
 *
 * The legacy `suppressionService.unsubscribe` writer is never used.
 *
 * Idempotency is the writer's: a repeat collides on the canonical key and
 * returns `already_present`, which is a success.
 *
 * Failures are never reported as success. A failed write after a successful
 * one is still a failure — the caller retries, and the earlier write is then a
 * no-op.
 */
import { ownedDbTable } from '../../db/writeOwner';
import type { UnsubscribeTokenPayload } from '../../security/outreachUnsubscribeToken';
import { GovernanceWriteError, recordContactGovernance } from '../prospectIdentity/contactGovernanceWriter';
import { OUTREACH_ATTEMPTS_TABLE, getOutreachTaskById } from './storage';

export const UNSUBSCRIBE_GOVERNANCE_SOURCE = 'outreach_unsubscribe_link';

/** Writer error codes a retry cannot change. Everything else is treated as transient. */
export const TERMINAL_GOVERNANCE_ERRORS: ReadonlySet<string> = new Set([
  'tenant_required', 'unknown_governance_type', 'channel_required', 'source_required',
  'anchor_required', 'evidence_not_summary', 'evidence_too_large',
  'cross_tenant_reference', 'invariant_violation',
]);

export const isTerminalGovernanceError = (e: unknown): boolean =>
  e instanceof GovernanceWriteError && TERMINAL_GOVERNANCE_ERRORS.has(e.code);

export type UnsubscribeMethod = 'one_click' | 'confirmation';

export interface UnsubscribeOutcome {
  status: 'recorded' | 'invalid_link' | 'retryable_failure' | 'terminal_failure';
  /** Records newly created, and records that already existed. */
  created: number;
  alreadyPresent: number;
  /** A code, never an address. */
  reason: string | null;
}

const outcome = (status: UnsubscribeOutcome['status'], reason: string | null, created = 0, alreadyPresent = 0): UnsubscribeOutcome =>
  ({ status, reason, created, alreadyPresent });

export async function recordOutreachUnsubscribe(
  token: UnsubscribeTokenPayload,
  method: UnsubscribeMethod,
): Promise<UnsubscribeOutcome> {
  // 1. The attempt, tenant-bound.
  let attempt: { data?: unknown; error?: unknown };
  try {
    attempt = await ownedDbTable(OUTREACH_ATTEMPTS_TABLE)
      .select('id, task_id, company_id')
      .eq('company_id', token.organizationId)    // TENANT FIRST, always
      .eq('id', token.attemptId)
      .maybeSingle();
  } catch {
    return outcome('retryable_failure', 'attempt_read_failed');
  }
  if (attempt?.error) return outcome('retryable_failure', 'attempt_read_failed');
  const row = attempt?.data as { task_id?: unknown; company_id?: unknown } | null;
  if (!row || typeof row.task_id !== 'string' || row.company_id !== token.organizationId) {
    return outcome('invalid_link', 'attempt_not_found');
  }

  // 2. The task — for its person anchor. `outreach_attempts.task_id` references
  //    `outreach_tasks` with ON DELETE RESTRICT, so a task that does not come back
  //    is a failed read, not an absent task.
  const task = await getOutreachTaskById(token.organizationId, row.task_id);
  if (!task) return outcome('retryable_failure', 'task_read_failed');

  const evidence = { attemptId: token.attemptId, taskId: row.task_id, method, tokenKeyId: token.keyId };
  const anchors: Array<{ personId: string | null }> = [{ personId: null }];
  if (task.personId) anchors.push({ personId: task.personId });

  let created = 0;
  let alreadyPresent = 0;
  for (const anchor of anchors) {
    try {
      const written = await recordContactGovernance({
        organizationId: token.organizationId,
        governanceType: 'unsubscribe',
        channel: token.scope,
        personId: anchor.personId,
        target: token.recipient,
        source: UNSUBSCRIBE_GOVERNANCE_SOURCE,
        evidence,
      });
      if (written.outcome === 'created') created += 1;
      else alreadyPresent += 1;
    } catch (e) {
      const code = e instanceof GovernanceWriteError ? e.code : 'governance_write_failed';
      return outcome(isTerminalGovernanceError(e) ? 'terminal_failure' : 'retryable_failure', code, created, alreadyPresent);
    }
  }
  return outcome('recorded', null, created, alreadyPresent);
}
