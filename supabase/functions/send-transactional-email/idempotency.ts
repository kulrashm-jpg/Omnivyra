/**
 * Idempotent send for `send-transactional-email` (correct-sending, pre-launch; e9 rulings 2026-11-13).
 *
 * Callers pass `idempotencyKey` in the body. The function used to IGNORE it, so every caller that passed a key
 * believed its email was deduplicated and it was not (and the outreach transport's `duplicate` flag could never be
 * true). Now, when a key is present:
 *
 *   RESERVE FIRST. One atomic database call (`transactional_email_reserve`) inserts the key in state 'sending'
 *   (INSERT ... ON CONFLICT DO NOTHING). Only the call that inserted it sends. Every other call is a duplicate:
 *     - 'sent'      -> answered as a duplicate success, nothing sent;
 *     - 'sending'   -> another call is sending right now: refused, retryable later;
 *     - 'uncertain' -> the provider may have it: never AUTO-resent within its window (CMS / D3 verdict);
 *     - a 'sending' reservation older than the stale bound (a crash mid-send) becomes 'uncertain' - never
 *       auto-resent, and reported as an alert-ready event for ops.
 *   An expired 'sent' key may be taken over (its window is over). An 'uncertain' key has the LONGER window
 *   max(type TTL, 7 days) from when it became uncertain (e9 ruling, 05 review): within it, never resent; after it,
 *   taken over like a sent one. The alert says when the key frees; an operator may resolve it sooner
 *   (transactional_email_resolve_uncertain, see docs/TRANSACTIONAL-EMAIL-IDEMPOTENCY-RUNBOOK.md).
 *   AFTER the send: success -> 'sent' + message id; a DEFINITE failure (nothing can have reached the provider)
 *   -> the reservation is DELETED, so a retry sends; an UNCERTAIN failure -> 'uncertain'.
 *
 *   WINDOW: the dedupe TTL is decided HERE from the email `type`, never by the caller (who cannot widen it).
 *
 * Pure: no Deno, no network. The handler supplies the store (database RPCs) and the send function; jest drives it
 * with fakes. No raw recipient address is ever stored - only its SHA-256.
 */

export type ReserveOutcome = 'reserved' | 'duplicate_sent' | 'duplicate_inflight' | 'duplicate_uncertain' | 'stale_marked_uncertain';

/** The database side, one RPC each (see the migration). Every method throws on a database error. */
export interface IdempotencyStore {
  /** `freesAt`: for an uncertain outcome, when its window closes (ISO), else null. */
  reserve(input: { key: string; emailType: string; recipientSha256: string; ttlSeconds: number; staleSeconds: number }): Promise<{ outcome: ReserveOutcome; messageId: string | null; freesAt: string | null }>;
  confirm(input: { key: string; messageId: string | null }): Promise<void>;
  release(input: { key: string }): Promise<void>;
  /** Returns when the key frees (ISO), or null when no 'sending' row moved. */
  markUncertain(input: { key: string; reason: string }): Promise<string | null>;
}

export type SendOnceResult =
  | { status: 200; body: { ok: true; messageId: string | null; duplicate?: true } }
  | { status: 409; body: { ok: false; error: 'IDEMPOTENCY_IN_FLIGHT'; duplicate: true; retryable: true } }
  | { status: 409; body: { ok: false; error: 'IDEMPOTENCY_UNCERTAIN'; duplicate: true; retryable: false } }
  | { status: 500; body: { ok: false; error: string; retryable: true } }
  | { status: 502; body: { ok: false; error: string; uncertain: true; retryable: false } }
  | { status: 503; body: { ok: false; error: 'IDEMPOTENCY_STORE_UNAVAILABLE'; retryable: true } };

/** A 'sending' reservation older than this is a crashed send: it becomes 'uncertain' (never resent). */
export const STALE_SENDING_SECONDS = 15 * 60;
/** The window when no rule names the type (and an unknown type is logged). */
export const DEFAULT_TTL_SECONDS = 24 * 3600;
const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * The dedupe window for one email, decided SERVER-side from its type (e9 ruling, option b).
 * credit_alert keys carry their own period (…:YYYY-MM-DD daily, …:YYYY-MM monthly); the window follows it, capped.
 */
export function ttlSecondsFor(emailType: string, key: string): { ttlSeconds: number; known: boolean } {
  switch (emailType) {
    case 'team_invite':
    case 'team_invite_credentials':
      return { ttlSeconds: 1 * HOUR, known: true };            // a SECOND reinvite an hour later must send
    case 'company_referral':
    case 'inbound_signup_notice':
      return { ttlSeconds: 7 * DAY, known: true };
    case 'credit_alert':
      if (/:\d{4}-\d{2}-\d{2}$/.test(key)) return { ttlSeconds: 1 * DAY, known: true };
      if (/:\d{4}-\d{2}$/.test(key)) return { ttlSeconds: 31 * DAY, known: true };
      return { ttlSeconds: DEFAULT_TTL_SECONDS, known: true };
    case 'lead_outreach':
      return { ttlSeconds: 30 * DAY, known: true };            // one key per outreach attempt: a repeat is never wanted
    case 'domain_verification_reminder':
    case 'activation_outreach':
      return { ttlSeconds: DEFAULT_TTL_SECONDS, known: true };
    default:
      return { ttlSeconds: DEFAULT_TTL_SECONDS, known: false };
  }
}

/** Thrown for a failure BEFORE any request left for the provider (configuration): definitely nothing was sent. */
export class PreSendError extends Error {
  constructor(message: string) { super(message); this.name = 'PreSendError'; }
}

/**
 * Could the provider have accepted the message? DEFINITE failure only when it certainly did not: a PreSendError,
 * or the provider ANSWERED with a 4xx. A 5xx, or no answer at all (network error, timeout), is UNCERTAIN.
 */
export function classifySendError(err: unknown): 'definite' | 'uncertain' {
  if (err instanceof PreSendError || (err as { name?: string })?.name === 'PreSendError') return 'definite';
  const status = (err as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) return 'definite';
  return 'uncertain';
}

/** SHA-256 hex of the normalised recipient (lower-case, trimmed). No raw address is stored. */
export async function recipientSha256(recipient: string): Promise<string> {
  const data = new TextEncoder().encode(String(recipient ?? '').trim().toLowerCase());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const asMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Send exactly once per key. Without a key: send as before (no dedupe was requested).
 * `log` receives alert-ready events (no raw recipient, no key material beyond the key the caller chose).
 */
export async function sendOnce(input: {
  key: string | null | undefined;
  emailType: string;
  recipient: string;
  store: IdempotencyStore;
  send: () => Promise<string | null>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}): Promise<SendOnceResult> {
  const log = input.log ?? (() => undefined);
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!key) {
    try {
      return { status: 200, body: { ok: true, messageId: await input.send() } };
    } catch (err) {
      return classifySendError(err) === 'definite'
        ? { status: 500, body: { ok: false, error: asMessage(err), retryable: true } }
        : { status: 502, body: { ok: false, error: asMessage(err), uncertain: true, retryable: false } };
    }
  }

  const { ttlSeconds, known } = ttlSecondsFor(input.emailType, key);
  if (!known) log('TRANSACTIONAL_EMAIL_TTL_DEFAULTED', { emailType: input.emailType, ttlSeconds });

  let reserved: { outcome: ReserveOutcome; messageId: string | null; freesAt: string | null };
  try {
    reserved = await input.store.reserve({
      key, emailType: input.emailType, recipientSha256: await recipientSha256(input.recipient), ttlSeconds, staleSeconds: STALE_SENDING_SECONDS,
    });
  } catch (err) {
    // No reservation, no send: sending without one would be exactly the duplicate this exists to stop.
    log('TRANSACTIONAL_EMAIL_IDEMPOTENCY_STORE_FAILED', { emailType: input.emailType, error: asMessage(err) });
    return { status: 503, body: { ok: false, error: 'IDEMPOTENCY_STORE_UNAVAILABLE', retryable: true } };
  }

  switch (reserved.outcome) {
    case 'duplicate_sent':
      return { status: 200, body: { ok: true, messageId: reserved.messageId, duplicate: true } };
    case 'duplicate_inflight':
      return { status: 409, body: { ok: false, error: 'IDEMPOTENCY_IN_FLIGHT', duplicate: true, retryable: true } };
    case 'stale_marked_uncertain':
      log('TRANSACTIONAL_EMAIL_UNCERTAIN', { emailType: input.emailType, reason: 'stale_sending_reservation', key, freesAt: reserved.freesAt });
      return { status: 409, body: { ok: false, error: 'IDEMPOTENCY_UNCERTAIN', duplicate: true, retryable: false } };
    case 'duplicate_uncertain':
      return { status: 409, body: { ok: false, error: 'IDEMPOTENCY_UNCERTAIN', duplicate: true, retryable: false } };
    case 'reserved':
      break;
  }

  let messageId: string | null;
  try {
    messageId = await input.send();
  } catch (err) {
    if (classifySendError(err) === 'definite') {
      try {
        await input.store.release({ key });
      } catch (releaseErr) {
        // The reservation stays 'sending'; the stale bound turns it 'uncertain' later - fail SAFE (no resend).
        log('TRANSACTIONAL_EMAIL_RELEASE_FAILED', { emailType: input.emailType, key, error: asMessage(releaseErr) });
      }
      return { status: 500, body: { ok: false, error: asMessage(err), retryable: true } };
    }
    let freesAt: string | null = null;
    try {
      freesAt = await input.store.markUncertain({ key, reason: asMessage(err).slice(0, 500) });
    } catch (markErr) {
      log('TRANSACTIONAL_EMAIL_MARK_UNCERTAIN_FAILED', { emailType: input.emailType, key, error: asMessage(markErr) });
    }
    log('TRANSACTIONAL_EMAIL_UNCERTAIN', { emailType: input.emailType, reason: 'send_outcome_unknown', key, freesAt });
    return { status: 502, body: { ok: false, error: asMessage(err), uncertain: true, retryable: false } };
  }

  try {
    await input.store.confirm({ key, messageId });
  } catch (confirmErr) {
    // SENT, but not recorded as sent: the reservation stays 'sending' and turns 'uncertain' at the stale bound -
    // never resent. The caller is told the truth: it was sent.
    log('TRANSACTIONAL_EMAIL_CONFIRM_FAILED', { emailType: input.emailType, key, error: asMessage(confirmErr) });
  }
  return { status: 200, body: { ok: true, messageId } };
}
