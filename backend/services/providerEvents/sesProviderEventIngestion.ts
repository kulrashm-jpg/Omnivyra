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
  if (!task) return outcome('retryable', 'task_read_failed', { eventType: event.eventType });

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
  if (!feedback.ok) {
    const retryable = feedback.rejection === 'write_failed' || feedback.rejection === 'task_not_found';
    return outcome(retryable ? 'retryable' : 'terminal', feedback.rejection, { eventType: event.eventType });
  }

  if (!event.governance) {
    return outcome('processed', null, { duplicate: feedback.duplicate, eventType: event.eventType });
  }

  const evidence = {
    snsMessageId: event.providerEventId,
    providerMessageId: event.providerMessageId,
    taskId,
    attemptId,
    ...event.evidence,
  };
  const anchors: Array<string | null> = [null];
  if (event.governance.anchors === 'target_and_person' && task.personId) anchors.push(task.personId);

  // In force from the provider's event time — but never LATER than now: if the
  // provider's clock runs ahead of ours, a future start would leave the
  // restriction dormant for the gap, and a dormant restriction is a contact.
  const nowIso = new Date().toISOString();
  const effectiveFrom = Date.parse(event.occurredAt) <= Date.parse(nowIso) ? event.occurredAt : nowIso;

  let created = 0;
  let alreadyPresent = 0;
  for (const personId of anchors) {
    try {
      const written = await recordContactGovernance({
        organizationId: companyId,
        governanceType: event.governance.type,
        channel: event.governance.channel,
        personId,
        target: event.recipient,
        source: SES_WEBHOOK_GOVERNANCE_SOURCE,
        evidence,
        effectiveFrom,
      });
      if (written.outcome === 'created') created += 1;
      else alreadyPresent += 1;
    } catch (e) {
      const code = e instanceof GovernanceWriteError ? e.code : 'governance_write_failed';
      return outcome(isTerminalGovernanceError(e) ? 'terminal' : 'retryable', code, {
        eventType: event.eventType, duplicate: feedback.duplicate, governance: { created, alreadyPresent },
      });
    }
  }

  return outcome('processed', null, {
    duplicate: feedback.duplicate, eventType: event.eventType, governance: { created, alreadyPresent },
  });
}
