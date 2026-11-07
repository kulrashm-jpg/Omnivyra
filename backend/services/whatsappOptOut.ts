/**
 * WhatsApp STOP / opt-out — recognise an inbound opt-out and record it in the
 * CANONICAL contact-governance store.
 *
 * Enforcement already exists: `whatsappBroadcastService.processBatch` evaluates
 * `mayContact` against `contact_governance_records` for every recipient before
 * any Meta send, and fails closed when the store cannot be read (W0-C, Path D
 * in contactGovernanceEvaluation.ts). What was missing is the WRITE: an inbound
 * "STOP" was stored as a conversation message and nothing else, so the sender
 * kept receiving broadcasts. This module is that write and nothing more:
 *
 *   - it writes only through `recordContactGovernance`, the store's single
 *     permitted writer (no new table, no legacy suppression store);
 *   - the record is an `unsubscribe` on channel `whatsapp`, anchored to the
 *     sender's number as `+<digits>` — the same normalised form the broadcast
 *     gate computes for an E.164 recipient, so the two meet;
 *   - detection is a WHOLE-MESSAGE keyword match, never a substring, so
 *     "please stop calling me at night" is a message, not an opt-out;
 *   - re-opt-in ("START") is NOT automatic: revoking a restriction is an
 *     operator act (unsubscribeService.ts, decision D).
 *
 * G-11 (owner, 2026-11-07): the `whatsapp` record above keeps WhatsApp closed for
 * good. After it, every channel is put on hold for the sender's number and the
 * company admin's review is opened (leadOutreachExecution/optOutHold.ts); the
 * admin may reopen phone or email, never WhatsApp. The source ref is the Meta
 * message id, so a redelivered webhook joins the same review, or does nothing
 * once that review is decided.
 *
 * Evidence is a summary only (keyword, ids, detector version) — never the
 * message text, which the writer refuses anyway.
 */

import { GovernanceWriteError, recordContactGovernance } from './prospectIdentity/contactGovernanceWriter';
import { isTerminalGovernanceError } from './leadOutreachExecution/unsubscribeService';
import { holdAndOpenOptOutReview, type OptOutHoldOutcome } from './leadOutreachExecution/optOutHold';

export const WHATSAPP_OPT_OUT_SOURCE = 'webhook:whatsapp_inbound';
export const WHATSAPP_OPT_OUT_DETECTOR_VERSION = 'wa-optout-1';

/**
 * Whole-message opt-out phrases, compared after trimming, upper-casing,
 * collapsing whitespace and dropping trailing punctuation. `STOP PROMOTIONS`
 * is the text of Meta's marketing opt-out quick-reply button.
 */
export const WHATSAPP_OPT_OUT_KEYWORDS: readonly string[] = [
  'STOP',
  'STOP ALL',
  'STOPALL',
  'STOP PROMOTIONS',
  'UNSUBSCRIBE',
  'OPT OUT',
  'OPTOUT',
  'OPT-OUT',
  'CANCEL',
  'END',
  'QUIT',
];

const normaliseText = (text: string): string =>
  text.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '');

/** The matched keyword when the whole message is an opt-out, else null. */
export function detectWhatsAppOptOut(text: unknown): { keyword: string } | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const candidate = normaliseText(text);
  return WHATSAPP_OPT_OUT_KEYWORDS.includes(candidate) ? { keyword: candidate } : null;
}

/**
 * The governance target for a WhatsApp sender. Meta's `from` is the sender's
 * number in international form without `+`; the broadcast gate normalises an
 * E.164 recipient to `+<digits>`, so the opt-out is recorded in that form.
 * Null when the value cannot be a phone number (E.164 allows at most 15 digits).
 */
export function whatsappSenderTarget(waId: unknown): string | null {
  if (typeof waId !== 'string') return null;
  const digits = waId.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export interface WhatsAppOptOutInput {
  organizationId: string;
  waId: string;
  waMessageId: string;
  keyword: string;
  socialAccountId: string | null;
}

export interface WhatsAppOptOutOutcome {
  status: 'recorded' | 'already_present' | 'invalid_sender' | 'terminal_failure' | 'retryable_failure';
  /** A code, never a number or message text. */
  reason: string | null;
  attempts: number;
  /** G-11: the all-channel hold and the admin review. Null when the channel record failed. */
  review: OptOutHoldOutcome['status'] | null;
  reviewId: string | null;
}

/** Bounded inline retry: a transient write failure must not lose an opt-out. */
export const WHATSAPP_OPT_OUT_MAX_ATTEMPTS = 3;

/**
 * Records the opt-out, then the G-11 hold and review. Never throws. A terminal
 * writer error is not retried; a transient one is retried up to
 * WHATSAPP_OPT_OUT_MAX_ATTEMPTS times. Repeats (webhook redelivery) collapse on
 * the store's canonical key and report `already_present`.
 *
 * Success needs BOTH: a failed hold or review is reported as a failure, so the
 * webhook job retries it (the channel record is then `already_present`).
 */
export async function recordWhatsAppOptOut(input: WhatsAppOptOutInput): Promise<WhatsAppOptOutOutcome> {
  const target = whatsappSenderTarget(input.waId);
  if (!target) return { status: 'invalid_sender', reason: 'sender_not_a_phone_number', attempts: 0, review: null, reviewId: null };

  let lastCode = 'governance_write_failed';
  for (let attempt = 1; attempt <= WHATSAPP_OPT_OUT_MAX_ATTEMPTS; attempt++) {
    try {
      const written = await recordContactGovernance({
        organizationId: input.organizationId,
        governanceType: 'unsubscribe',
        channel: 'whatsapp',
        personId: null,
        target,
        source: WHATSAPP_OPT_OUT_SOURCE,
        evidence: {
          waMessageId: input.waMessageId,
          matchedKeyword: input.keyword,
          detectorVersion: WHATSAPP_OPT_OUT_DETECTOR_VERSION,
          socialAccountId: input.socialAccountId,
        },
      });
      const held = await holdAndOpenOptOutReview({
        organizationId: input.organizationId,
        trigger: 'whatsapp_stop',
        anchor: { kind: 'target', channel: 'whatsapp', target },
        sourceRef: input.waMessageId,
        triggerRecordId: written.id,
        phone: target,
        evidence: { detectorVersion: WHATSAPP_OPT_OUT_DETECTOR_VERSION, socialAccountId: input.socialAccountId },
      });
      if (held.status === 'retryable_failure' || held.status === 'terminal_failure') {
        return { status: held.status, reason: held.reason, attempts: attempt, review: held.status, reviewId: null };
      }
      return {
        status: written.outcome === 'created' ? 'recorded' : 'already_present', reason: null, attempts: attempt,
        review: held.status, reviewId: held.reviewId,
      };
    } catch (e) {
      lastCode = e instanceof GovernanceWriteError ? e.code : 'governance_write_failed';
      if (isTerminalGovernanceError(e)) return { status: 'terminal_failure', reason: lastCode, attempts: attempt, review: null, reviewId: null };
    }
  }
  return { status: 'retryable_failure', reason: lastCode, attempts: WHATSAPP_OPT_OUT_MAX_ATTEMPTS, review: null, reviewId: null };
}
