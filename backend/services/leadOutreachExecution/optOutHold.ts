/**
 * G-11 — the Outreach side of an opt-out hold. A WhatsApp STOP and an email unsubscribe each
 * write their own channel record first (that channel stays closed for good); this module then
 * puts the contact on hold on EVERY channel and opens the company admin's review.
 *
 * The review, the hold format and adoption belong to Orchestration (optOutReview.ts). This
 * module only calls them, in the agreed order:
 *
 *   1. DEDUPE. A redelivered webhook or a second click on the same link carries the same
 *      source ref. When a DECIDED review already lists it, the admin has ruled on this very
 *      opt-out: nothing is held again. A pending review or none: carry on (steps 2 and 3 are
 *      idempotent, so a retry after a crash lands on the same holds and joins).
 *   2. HOLDS. `writeOptOutHolds` writes the canonical `*` holds with the trigger's hold source.
 *   3. REVIEW. `openOptOutReview` adopts the holds and opens or joins the pending review.
 *      `hold_revoked` (a decision released a hold between 2 and 3) writes the holds again.
 *
 * Never throws. A failure is reported as retryable or terminal; a hold already written stays
 * (fail-safe: the contact is closed), and a retry adopts it.
 */
import { GovernanceWriteError } from '../prospectIdentity/contactGovernanceWriter';
import {
  OPT_OUT_HOLD_SOURCES,
  OptOutReviewError,
  findOptOutReviewBySourceRef,
  openOptOutReview,
  writeOptOutHolds,
  type OptOutAnchor,
  type OptOutTrigger,
} from '../orchestration/optOutReview';
import { isTerminalGovernanceError } from './unsubscribeService';

/** Review refusals a retry cannot change. Everything else is treated as transient. */
const TERMINAL_REVIEW_ERRORS: ReadonlySet<string> = new Set([
  'invalid_input', 'invalid_hold_source', 'anchor_required', 'hold_not_found', 'cross_tenant_reference',
]);

export const OPT_OUT_HOLD_MAX_ATTEMPTS = 3;

export interface OptOutHoldInput {
  organizationId: string;
  trigger: Extract<OptOutTrigger, 'whatsapp_stop' | 'email_unsubscribe'>;
  anchor: OptOutAnchor;
  /** Stable per opt-out: the Meta message id, or `attempt:<attemptId>`. */
  sourceRef: string;
  /** The channel record the trigger wrote; recorded on the review, never revoked. */
  triggerRecordId: string | null;
  personId?: string | null;
  /** Every known address and number; canonicalised by writeOptOutHolds. */
  emails?: ReadonlyArray<string | null | undefined>;
  phone?: string | null;
  /** Summary only (ids, codes); the source ref is added by writeOptOutHolds. */
  evidence?: Record<string, unknown>;
}

export interface OptOutHoldOutcome {
  status: 'opened' | 'joined' | 'already_decided' | 'retryable_failure' | 'terminal_failure';
  reviewId: string | null;
  holdIds: string[];
  /** A code, never an address or a number. */
  reason: string | null;
}

const codeOf = (e: unknown): string =>
  (e instanceof OptOutReviewError || e instanceof GovernanceWriteError) ? e.code : 'optout_hold_failed';

const isTerminal = (e: unknown): boolean =>
  isTerminalGovernanceError(e) || (e instanceof OptOutReviewError && TERMINAL_REVIEW_ERRORS.has(e.code));

export async function holdAndOpenOptOutReview(input: OptOutHoldInput): Promise<OptOutHoldOutcome> {
  const holdSource = OPT_OUT_HOLD_SOURCES[input.trigger];
  let reason = 'optout_hold_failed';
  for (let attempt = 1; attempt <= OPT_OUT_HOLD_MAX_ATTEMPTS; attempt++) {
    try {
      // 1. Dedupe on the source ref.
      const existing = await findOptOutReviewBySourceRef({ organizationId: input.organizationId, sourceRef: input.sourceRef });
      if (existing !== null && existing.state === 'decided') {
        return { status: 'already_decided', reviewId: existing.id, holdIds: [], reason: null };
      }

      // 2. The holds: the person, and every known address and number.
      const emails = [...new Set((input.emails ?? []).filter((e): e is string => typeof e === 'string' && e.trim() !== ''))];
      const holdIds: string[] = [];
      for (let i = 0; i < Math.max(emails.length, 1); i++) {
        const ids = await writeOptOutHolds({
          organizationId: input.organizationId,
          personId: i === 0 ? input.personId ?? null : null,
          email: emails[i] ?? null,
          phone: i === 0 ? input.phone ?? null : null,
          holdSource,
          sourceRef: input.sourceRef,
          evidence: input.evidence,
        }).catch((e: unknown) => {
          // A second address with nothing else to anchor is not a failure of the first.
          if (i > 0 && e instanceof OptOutReviewError && e.code === 'anchor_required') return [] as string[];
          throw e;
        });
        holdIds.push(...ids);
      }

      // 3. The review.
      const review = await openOptOutReview({
        organizationId: input.organizationId,
        anchor: input.anchor,
        trigger: input.trigger,
        holdIds: [...new Set(holdIds)],
        triggerRecordId: input.triggerRecordId,
        sourceRef: input.sourceRef,
        holdSource,
      });
      return { status: review.outcome, reviewId: review.reviewId, holdIds: [...new Set(holdIds)], reason: null };
    } catch (e) {
      reason = codeOf(e);
      if (isTerminal(e)) return { status: 'terminal_failure', reviewId: null, holdIds: [], reason };
      // hold_revoked and transient failures: write the holds again and retry.
    }
  }
  return { status: 'retryable_failure', reviewId: null, holdIds: [], reason };
}
