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
 *      called once per anchor (decision C), on channel `email`:
 *        • TARGET  — the exact address the email went to;
 *        • PERSON  — the task's person, when the task has one.
 *      Two rows by design (PI-CONTRACT-001 §3.2): the address survives an
 *      erasure of the person, and the person anchor follows them to new
 *      addresses. These keep EMAIL closed for good; only the person undoes them.
 *   4. G-11 (owner, 2026-11-07, REPLACES WP3 decision A for new unsubscribes):
 *      every channel is then put on hold — the person, the address and the
 *      person's known address and number — and the company admin's review is
 *      opened (optOutHold.ts). The admin may reopen phone or WhatsApp, never
 *      email. Tokens still carry scope `*`; that scope now means "email, plus a
 *      reviewable hold on the rest". Records written under decision A (`*`,
 *      this source) are untouched and stay in force.
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
import { holdAndOpenOptOutReview } from './optOutHold';
import { durableIntelligencePort } from '../orchestration/individualIntelligence';

export const UNSUBSCRIBE_GOVERNANCE_SOURCE = 'outreach_unsubscribe_link';
/** The channel an unsubscribe link closes for good (G-11). */
export const UNSUBSCRIBE_CHANNEL = 'email';

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
  /** G-11: the admin review this unsubscribe opened or joined, when it got that far. */
  reviewId?: string | null;
}

const outcome = (status: UnsubscribeOutcome['status'], reason: string | null, created = 0, alreadyPresent = 0, reviewId: string | null = null): UnsubscribeOutcome =>
  ({ status, reason, created, alreadyPresent, reviewId });

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
  let triggerRecordId: string | null = null;
  for (const anchor of anchors) {
    try {
      const written = await recordContactGovernance({
        organizationId: token.organizationId,
        governanceType: 'unsubscribe',
        channel: UNSUBSCRIBE_CHANNEL,
        personId: anchor.personId,
        target: token.recipient,
        source: UNSUBSCRIBE_GOVERNANCE_SOURCE,
        evidence,
      });
      if (written.outcome === 'created') created += 1;
      else alreadyPresent += 1;
      triggerRecordId = written.id;                 // the person's when there is one, else the address's
    } catch (e) {
      const code = e instanceof GovernanceWriteError ? e.code : 'governance_write_failed';
      return outcome(isTerminalGovernanceError(e) ? 'terminal_failure' : 'retryable_failure', code, created, alreadyPresent);
    }
  }

  // 4. G-11: hold every channel and open the admin review. The person's known address and
  //    number are part of the hold; when they cannot be read the hold would miss them, so the
  //    request fails retryably (email is already closed) and the person's retry completes it.
  let contacts: { email: string | null; phone: string | null } | null = { email: null, phone: null };
  if (task.personId) {
    contacts = await durableIntelligencePort.readPersonContacts(token.organizationId, task.personId).catch(() => null);
    if (contacts === null) return outcome('retryable_failure', 'person_contacts_unreadable', created, alreadyPresent);
  }
  const held = await holdAndOpenOptOutReview({
    organizationId: token.organizationId,
    trigger: 'email_unsubscribe',
    anchor: task.personId
      ? { kind: 'person', personId: task.personId }
      : { kind: 'target', channel: 'email', target: token.recipient },
    sourceRef: `attempt:${token.attemptId}`,
    triggerRecordId,
    personId: task.personId ?? null,
    emails: [token.recipient, contacts.email],
    phone: contacts.phone,
    evidence,
  });
  if (held.status === 'retryable_failure' || held.status === 'terminal_failure') {
    return outcome(held.status, held.reason, created, alreadyPresent);
  }
  return outcome('recorded', null, created, alreadyPresent, held.reviewId);
}
