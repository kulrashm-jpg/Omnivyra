/**
 * WP3 / L7–L9 — one authenticated SES event → evidence, and for a permanent
 * bounce or a complaint, a standing restriction.
 *
 *   normalize → resolve (tenant, task, attempt) → load the task's person
 *     → ingestFeedback (delivery evidence; idempotent on the SNS MessageId)
 *     → recordContactGovernance, per decision A:
 *          permanent bounce → `bounce_hard`, the ADDRESS, `email`
 *          complaint        → `complaint`, the ADDRESS and the PERSON, `*`
 *
 * RETRY SEMANTICS (L9). SNS retries 5xx and 429 and treats every other status as
 * final, so the classification below IS the retry policy:
 *   processed / duplicate / dropped     → 200
 *   terminal (bad shape, unresolvable)  → 422 — a retry cannot change it
 *   retryable (a read/write failed)     → 503 — SNS should try again
 * Governance is written EVEN for a duplicate event: if the evidence write
 * succeeded and the restriction write did not, the retry repairs it, and an
 * already-present restriction is a no-op. A failed write is never a success.
 *
 * D7 — A RESTRICTION DOES NOT WAIT FOR THE EVIDENCE WRITE. A complaint and a
 * permanent bounce are deterministic governance events: once the event is
 * authenticated and resolved to a tenant, the restriction follows from the
 * event alone. It used to be written only AFTER the delivery evidence was
 * appended, so an evidence-table outage that outlasted SNS's bounded retry
 * policy lost the restriction for good while the tenant, the address and the
 * person were all known. Now the restriction is attempted whenever the tenant
 * resolved — on the ADDRESS even when the task could not be read (the person
 * anchor follows on the retry) — and the response still reports the failed
 * evidence write as a failure, so SNS retries and the evidence is repaired.
 * Status precedence when several writes fail: retryable if ANY failure is
 * retryable (a retry can still complete it), otherwise terminal.
 *
 * Nothing here logs or returns an address.
 */
import { normalizeSesEvent, type NormalizedSesEvent } from './sesEventNormalizer';
import { resolveProviderMessage } from './providerMessageResolver';
import { ingestFeedback } from '../leadOutreachExecution/feedbackIngestion';
import { getOutreachTaskById } from '../leadOutreachExecution/storage';
import { recordContactGovernance, GovernanceWriteError } from '../prospectIdentity/contactGovernanceWriter';
import { isTerminalGovernanceError } from '../leadOutreachExecution/unsubscribeService';

export const SES_WEBHOOK_GOVERNANCE_SOURCE = 'webhook:ses';

export type SesIngestionStatus = 'processed' | 'dropped' | 'terminal' | 'retryable';

export interface SesIngestionOutcome {
  status: SesIngestionStatus;
  /** A code — never an address. */
  reason: string | null;
  duplicate: boolean;
  eventType: string | null;
  governance: { created: number; alreadyPresent: number } | null;
}

const outcome = (status: SesIngestionStatus, reason: string | null, extra: Partial<SesIngestionOutcome> = {}): SesIngestionOutcome => ({
  status, reason, duplicate: false, eventType: null, governance: null, ...extra,
});

const RETRYABLE_RESOLUTION = new Set(['read_failed']);

export async function ingestSesEvent(payload: unknown, snsMessageId: string): Promise<SesIngestionOutcome> {
  const normalized = normalizeSesEvent(payload, snsMessageId);
  if (!normalized.ok) {
    return normalized.failure === 'unsupported_event_type'
      ? outcome('dropped', 'unsupported_event_type', { eventType: normalized.eventType })
      : outcome('terminal', normalized.failure, { eventType: normalized.eventType });
  }
  const event = normalized.event as NormalizedSesEvent;

  const resolved = await resolveProviderMessage(event.provider, event.providerMessageId);
  if (!resolved.ok) {
    return outcome(RETRYABLE_RESOLUTION.has(String(resolved.failure)) ? 'retryable' : 'terminal', resolved.failure, { eventType: event.eventType });
  }
  const companyId = resolved.companyId as string;
  const taskId = resolved.taskId as string;
  const attemptId = resolved.attemptId as string;

  // The evidence row references the task (ON DELETE RESTRICT), so a task that
  // does not come back is a failed read, not an absent task.
  const task = await getOutreachTaskById(companyId, taskId);

  const failures: Array<{ status: 'terminal' | 'retryable'; reason: string }> = [];
  let duplicate = false;
  if (!task) {
    failures.push({ status: 'retryable', reason: 'task_read_failed' });
  } else {
    const feedback = await ingestFeedback({
      companyId,
      taskId,
      signal: event.signal,
      occurredAt: event.occurredAt,
      source: 'provider_webhook',
      provider: event.provider,
      providerEventId: event.providerEventId,
      attemptId,
      evidence: event.evidence,
    });
    if (feedback.ok) {
      duplicate = feedback.duplicate;
    } else {
      const retryable = feedback.rejection === 'write_failed' || feedback.rejection === 'task_not_found';
      failures.push({ status: retryable ? 'retryable' : 'terminal', reason: String(feedback.rejection) });
    }
  }

  let governance: SesIngestionOutcome['governance'] = null;
  if (event.governance) {
    const written = await writeGovernance(event, companyId, taskId, attemptId, task?.personId ?? null);
    governance = { created: written.created, alreadyPresent: written.alreadyPresent };
    if (written.failure) failures.push(written.failure);
  }

  if (failures.length > 0) {
    const status = failures.some((f) => f.status === 'retryable') ? 'retryable' : 'terminal';
    return outcome(status, failures[0].reason, { eventType: event.eventType, duplicate, governance });
  }
  return outcome('processed', null, { duplicate, eventType: event.eventType, governance });
}

/**
 * The standing restriction for a permanent bounce or a complaint, per decision
 * A: the ADDRESS always, plus the PERSON when the task names one. Stops at the
 * first failed write and reports it; earlier writes stand (a retry re-runs them
 * as no-ops).
 */
async function writeGovernance(
  event: NormalizedSesEvent,
  companyId: string,
  taskId: string,
  attemptId: string,
  personId: string | null,
): Promise<{ created: number; alreadyPresent: number; failure: { status: 'terminal' | 'retryable'; reason: string } | null }> {
  const action = event.governance as NonNullable<NormalizedSesEvent['governance']>;
  const evidence = {
    snsMessageId: event.providerEventId,
    providerMessageId: event.providerMessageId,
    taskId,
    attemptId,
    ...event.evidence,
  };
  const anchors: Array<string | null> = [null];
  if (action.anchors === 'target_and_person' && personId) anchors.push(personId);

  // In force from the provider's event time — but never LATER than now: if the
  // provider's clock runs ahead of ours, a future start would leave the
  // restriction dormant for the gap, and a dormant restriction is a contact.
  const nowIso = new Date().toISOString();
  const effectiveFrom = Date.parse(event.occurredAt) <= Date.parse(nowIso) ? event.occurredAt : nowIso;

  let created = 0;
  let alreadyPresent = 0;
  for (const anchor of anchors) {
    try {
      const written = await recordContactGovernance({
        organizationId: companyId,
        governanceType: action.type,
        channel: action.channel,
        personId: anchor,
        target: event.recipient,
        source: SES_WEBHOOK_GOVERNANCE_SOURCE,
        evidence,
        effectiveFrom,
      });
      if (written.outcome === 'created') created += 1;
      else alreadyPresent += 1;
    } catch (e) {
      const code = e instanceof GovernanceWriteError ? e.code : 'governance_write_failed';
      return { created, alreadyPresent, failure: { status: isTerminalGovernanceError(e) ? 'terminal' : 'retryable', reason: code } };
    }
  }
  return { created, alreadyPresent, failure: null };
}
