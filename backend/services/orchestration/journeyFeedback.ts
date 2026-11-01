/**
 * Journey feedback → Prospect Intelligence. The caller the B3 producer never had.
 *
 * `produceLifecycleFromOutcome` joined outcomes to the PI lifecycle but nothing called
 * it, so a recorded reply never reached the prospect. This module supplies the call and
 * decides nothing: which outcome means what stays `interpretOutcome`'s, legality and
 * idempotency stay the lifecycle writer's, and PI's files are unchanged.
 *
 *   WS-3 outcomes  every recent `outreach_outcomes` row of the tenant, whether or not
 *                  a journey produced it. Keyed on the row, so a reply that arrives
 *                  after its journey finished still reaches the prospect.
 *   WhatsApp       a reply has no outcome row: outreach_outcomes.task_id is NOT NULL
 *                  and WhatsApp has no outreach task. It is read through the same
 *                  interpreter and written with the writer's `engagement_thread`
 *                  evidence. Only replies to a live journey are seen.
 *
 * RE-READING IS SAFE. Replays converge on `uq_prospect_lifecycle_source_event`, so the
 * window only bounds cost. An outage longer than OUTCOME_LOOKBACK_HOURS leaves older
 * outcomes unfed, and reaching MAX_OUTCOMES_PER_SWEEP is reported as work remaining.
 */

import crypto from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import {
  interpretOutcome,
  produceLifecycleFromOutcome,
  readCurrentProspectState,
  recordProspectTransition,
  sourceEventKey,
} from '../prospectLifecycle';

export const OUTCOME_LOOKBACK_HOURS = 72;
export const MAX_OUTCOMES_PER_SWEEP = 100;
/** The types the ratified map can act on. `opened` and `clicked` never move a prospect. */
const LIFECYCLE_BEARING_OUTCOMES = ['replied', 'unsubscribed', 'rejected', 'no_response', 'converted', 'meeting_booked'];

export interface LifecycleFeedbackReport {
  readonly seen: number;
  readonly written: number;
  /** Refusal code → count. Codes only; never a person. */
  readonly refused: Record<string, number>;
  readonly errors: number;
  readonly truncated: boolean;
}

export interface LifecycleFeedbackDeps {
  readonly produce: typeof produceLifecycleFromOutcome;
}

export async function feedRecentOutcomesToLifecycle(
  organizationId: string,
  now: string,
  deps: LifecycleFeedbackDeps = { produce: produceLifecycleFromOutcome },
): Promise<LifecycleFeedbackReport> {
  const since = new Date(Date.parse(now) - OUTCOME_LOOKBACK_HOURS * 3_600_000).toISOString();
  const res = await ownedDbTable('outreach_outcomes')
    .select('id')
    .eq('company_id', organizationId)              // TENANT FIRST
    .in('outcome_type', LIFECYCLE_BEARING_OUTCOMES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_OUTCOMES_PER_SWEEP + 1);
  if (res.error) {
    throw Object.assign(new Error('outreach outcomes unreadable'), { code: 'outcomes_unreadable' });
  }
  const rows = (res.data ?? []) as unknown as Array<{ id: string }>;
  const truncated = rows.length > MAX_OUTCOMES_PER_SWEEP;
  const ids = rows.slice(0, MAX_OUTCOMES_PER_SWEEP).map((r) => String(r.id));

  let written = 0;
  let errors = 0;
  const refused: Record<string, number> = {};
  for (const outcomeId of ids) {
    try {
      const r = await deps.produce({ organizationId, outcomeId, now });
      if (r.wrote) written += 1;
      if (r.refusal) refused[r.refusal] = (refused[r.refusal] ?? 0) + 1;
    } catch {
      errors += 1;                                 // one bad outcome must not cost the rest
    }
  }
  return { seen: ids.length, written, refused, errors, truncated };
}

/**
 * The identity of a WhatsApp reply on PI's event axis: a stable fingerprint of the
 * message id, because PI's key vocabulary is closed and Meta's ids use characters it
 * refuses. `derivation` is the form it offers for a fingerprint of underlying evidence.
 */
export const whatsappReplyFingerprint = (messageId: string): string =>
  `wa-reply-${crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 32)}`;

/**
 * One WhatsApp reply on a journey about a prospect. The transition is the interpreter's
 * answer to `replied`, nothing of this module's own. No code, thread text or number is
 * stored: the evidence names the thread and message.
 */
export async function feedWhatsAppReplyToLifecycle(input: {
  organizationId: string;
  prospectId: string;
  messageId: string;
  threadId: string;
  now: string;
}): Promise<{ wrote: boolean; refusal: string | null }> {
  const current = await readCurrentProspectState(input.organizationId, input.prospectId);
  const fingerprint = whatsappReplyFingerprint(input.messageId);
  const reading = interpretOutcome({
    outcome: {
      id: fingerprint,
      type: 'replied',
      provenance: {
        organizationId: input.organizationId,
        source: 'provider',
        provider: 'whatsapp',
        providerEventId: input.messageId,
        derived: false,
        actor: null,
      },
    },
    currentState: current?.state ?? null,
  });
  if (reading.kind !== 'transition') return { wrote: false, refusal: reading.kind };
  if (reading.origin !== 'derived') return { wrote: false, refusal: 'not_derived' };

  const written = await recordProspectTransition({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    to: reading.to,
    origin: reading.origin,
    actorUserId: null,
    evidence: { kind: 'engagement_thread', detail: { threadId: input.threadId, messageId: input.messageId } },
    sourceEventKey: sourceEventKey('derivation', fingerprint),
    reasoning: reading.reasoning,
    modelVersion: reading.modelVersion,
    now: input.now,
  });
  return { wrote: written.wrote, refusal: null };
}
