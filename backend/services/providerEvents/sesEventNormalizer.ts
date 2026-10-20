/**
 * WP3 / L6–L8 — one SES event notification → the facts the rest of the
 * pipeline needs. An ADAPTER, not an authority: it decides nothing about
 * tenancy and writes nothing. Pure; never throws.
 *
 * THE MAPPING:
 *   Delivery   → evidence `delivered`.
 *   Bounce     → evidence `bounced`. ONLY `bounceType: Permanent` also yields a
 *                `bounce_hard` restriction (decision A: the address, `email`).
 *                Transient and Undetermined bounces are evidence only — a full
 *                mailbox is not a standing instruction.
 *   Complaint  → evidence `delivered` (a complaint implies the message arrived;
 *                the SES type is kept in the evidence) plus a `complaint`
 *                restriction on every channel (decision A). The outcome
 *                vocabulary has no `complaint`, and adding one needs a
 *                migration, so it is deliberately not invented here.
 *   Reject     → evidence `bounced` (SES refused to send; never a restriction:
 *                it says nothing about the recipient's wishes).
 *   Anything else (Send, DeliveryDelay, Open, Click, Rendering Failure, …) is
 *   `unsupported` and dropped by the caller with a 2xx.
 *
 * THE RECIPIENT. The platform sends ONE `To` per message
 * (`Destination.ToAddresses: [envelope.to]`), so `mail.destination` must hold
 * exactly one address. Bounced/complained recipients must all be that address.
 * Anything else is refused rather than guessed at.
 *
 * EVIDENCE IS A SUMMARY. Types only — no addresses, no diagnostic text, no
 * headers — because it is persisted as delivery evidence.
 */
import { normalizeEmail } from '../identityResolutionService';
import { SES_EDGE_PROVIDER_NAME } from '../leadOutreachExecution/emailTransport';

export const SES_MAPPED_EVENT_TYPES = ['Delivery', 'Bounce', 'Complaint', 'Reject'] as const;
export type SesMappedEventType = (typeof SES_MAPPED_EVENT_TYPES)[number];

export type GovernanceAction =
  | { type: 'bounce_hard'; channel: 'email'; anchors: 'target' }
  | { type: 'complaint'; channel: '*'; anchors: 'target_and_person' };

export interface NormalizedSesEvent {
  provider: string;
  providerMessageId: string;
  providerEventId: string;
  eventType: SesMappedEventType;
  signal: 'delivered' | 'bounced';
  occurredAt: string;
  /** The single destination address, as SES reported it (not normalised). */
  recipient: string;
  governance: GovernanceAction | null;
  evidence: Record<string, unknown>;
}

export type SesNormalizationFailure =
  | 'malformed_payload'
  | 'unsupported_event_type'
  | 'missing_provider_message_id'
  | 'invalid_timestamp'
  | 'recipient_unresolvable';

export interface SesNormalizationResult {
  ok: boolean;
  event: NormalizedSesEvent | null;
  failure: SesNormalizationFailure | null;
  eventType: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function at(payload: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = payload;
  for (const key of path) {
    if (!isObject(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

const isoOrNull = (v: unknown): string | null => {
  const raw = str(v);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const TIMESTAMP_PATH: Readonly<Record<SesMappedEventType, readonly string[]>> = {
  Delivery: ['delivery', 'timestamp'],
  Bounce: ['bounce', 'timestamp'],
  Complaint: ['complaint', 'timestamp'],
  Reject: ['mail', 'timestamp'],
};

const fail = (failure: SesNormalizationFailure, eventType: string | null): SesNormalizationResult =>
  ({ ok: false, event: null, failure, eventType });

/** The affected-recipient list each event type carries, as plain addresses. */
function affectedRecipients(payload: Record<string, unknown>, eventType: SesMappedEventType): unknown[] | null {
  if (eventType === 'Bounce') {
    const list = at(payload, ['bounce', 'bouncedRecipients']);
    return Array.isArray(list) ? list.map((r) => (isObject(r) ? r.emailAddress : undefined)) : null;
  }
  if (eventType === 'Complaint') {
    const list = at(payload, ['complaint', 'complainedRecipients']);
    return Array.isArray(list) ? list.map((r) => (isObject(r) ? r.emailAddress : undefined)) : null;
  }
  return [];
}

/**
 * Normalize one SES event. `snsMessageId` comes from the VERIFIED envelope and
 * becomes the deduplication key, so a publisher cannot choose its own.
 */
export function normalizeSesEvent(payload: unknown, snsMessageId: string): SesNormalizationResult {
  if (!isObject(payload)) return fail('malformed_payload', null);

  // `notificationType` (identity notifications) or `eventType` (configuration
  // set event publishing). Both are accepted; neither is inferred.
  const rawType = str(payload.notificationType) ?? str(payload.eventType);
  if (!rawType) return fail('malformed_payload', null);
  if (!(SES_MAPPED_EVENT_TYPES as readonly string[]).includes(rawType)) return fail('unsupported_event_type', rawType);
  const eventType = rawType as SesMappedEventType;

  const providerMessageId = str(at(payload, ['mail', 'messageId']));
  if (!providerMessageId) return fail('missing_provider_message_id', eventType);

  const occurredAt = isoOrNull(at(payload, TIMESTAMP_PATH[eventType]));
  if (!occurredAt) return fail('invalid_timestamp', eventType);

  // Exactly one destination, and every affected recipient is that one.
  const destination = at(payload, ['mail', 'destination']);
  if (!Array.isArray(destination) || destination.length !== 1 || !str(destination[0])) {
    return fail('recipient_unresolvable', eventType);
  }
  const recipient = String(destination[0]);
  const normalized = normalizeEmail(recipient);
  const affected = affectedRecipients(payload, eventType);
  if (affected === null) return fail('malformed_payload', eventType);
  if ((eventType === 'Bounce' || eventType === 'Complaint') && affected.length === 0) {
    return fail('recipient_unresolvable', eventType);
  }
  if (!normalized || affected.some((a) => normalizeEmail(typeof a === 'string' ? a : '') !== normalized)) {
    return fail('recipient_unresolvable', eventType);
  }

  const bounceType = str(at(payload, ['bounce', 'bounceType']));
  const bounceSubType = str(at(payload, ['bounce', 'bounceSubType']));
  const feedbackType = str(at(payload, ['complaint', 'complaintFeedbackType']));

  let signal: NormalizedSesEvent['signal'] = 'delivered';
  let governance: GovernanceAction | null = null;
  if (eventType === 'Bounce') {
    signal = 'bounced';
    if (bounceType === 'Permanent') governance = { type: 'bounce_hard', channel: 'email', anchors: 'target' };
  } else if (eventType === 'Reject') {
    signal = 'bounced';
  } else if (eventType === 'Complaint') {
    governance = { type: 'complaint', channel: '*', anchors: 'target_and_person' };
  }

  return {
    ok: true,
    failure: null,
    eventType,
    event: {
      provider: SES_EDGE_PROVIDER_NAME,
      providerMessageId,
      providerEventId: snsMessageId,
      eventType,
      signal,
      occurredAt,
      recipient,
      governance,
      evidence: {
        sesEventType: eventType,
        ...(bounceType ? { bounceType } : {}),
        ...(bounceSubType ? { bounceSubType } : {}),
        ...(feedbackType ? { complaintFeedbackType: feedbackType } : {}),
        snsMessageId,
      },
    },
  };
}
