/**
 * A7D — the deterministic consumer decision for one enrichment work item.
 *
 * ─── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 * A5 and A6A made the attempt state expressible; A7C made it readable. It was
 * still write-only in the sense that mattered: nothing turned that state into an
 * action, so `unknown` guarded nothing and a lease protected nothing beyond the
 * moment of claiming. This module closes that gap and stops there.
 *
 * It DECIDES. It does not select, claim, reclaim, execute, wait, enqueue or
 * escalate. Given one work item's latest attempt and the ambient facts a caller
 * already knows, it returns the one safe action and why. Every verb in the
 * result belongs to a future scheduler; none of them happens here.
 *
 * ─── PURE, TOTAL, AND FAIL-SAFE BY DEFAULT ────────────────────────────────
 * No I/O, no database, no clock of its own — `now` is supplied. Same input,
 * same output, always. And the fallthrough is OPERATOR_REVIEW, never
 * RETRY_PROVIDER: the schema does not enforce every cross-column invariant, so a
 * combination this classifier does not recognise may exist, and the only safe
 * response to "I do not understand this row" is a human, not a provider call.
 *
 * ─── THE PRECEDENCE, AND WHY IT IS THIS ORDER ─────────────────────────────
 *   1. a live lease            someone is working it RIGHT NOW
 *   2. ambiguity               a call may already have been paid for
 *   3. fresh evidence          we already have what was asked for
 *   4. credential / source     we cannot call at all
 *   5. recoverable             the work is abandoned — retry ADOPTS it
 *   6. the attempt's own end   terminal, transient, or provably unpaid
 *   7. anything else           OPERATOR_REVIEW
 *
 * The first rule is load-bearing and is NOT stated in the audit that preceded
 * this. A healthy in-flight execution is `in_flight` + `unknown` + a live lease:
 * the marker writes `unknown` BEFORE transport, and the worker holds the lease
 * throughout. If `unknown` outranked the lease, every ordinary provider call in
 * progress would escalate to a human. So the lease is checked first, and
 * `unknown` means process death only once nobody holds the work.
 */

import type { EnrichmentOutcome } from './providers/contract';
import type { EnrichmentAttemptRow } from './attempts';

/** The only actions a consumer may recommend. Closed, and deliberately small. */
export const ENRICHMENT_DECISIONS = [
  /** Nothing to do: evidence is fresh, or we are structurally unable to call. */
  'NO_ACTION',
  /** Someone else holds it, or a provider told us when we may return. */
  'WAIT',
  /**
   * Provably safe to contact the provider — including when doing so means
   * ADOPTING an abandoned attempt rather than opening a new one. See A7I below:
   * there is deliberately no separate RECLAIM verb, because recovery is not a
   * different action, it is the same action taking a different route inside the
   * claim.
   */
  'RETRY_PROVIDER',
  /** The provider answered and the answer stands for this evidence. */
  'TERMINAL',
  /** A human must look. Never a substitute for a decision we could make. */
  'OPERATOR_REVIEW',
] as const;
export type EnrichmentDecision = typeof ENRICHMENT_DECISIONS[number];

/**
 * Provider outcomes that MAY be reattempted once a horizon passes.
 *
 * The provider was reached and declined to answer *for now*. Exactly these four;
 * no category is inferred.
 */
export const TRANSIENT_OUTCOMES: readonly EnrichmentOutcome[] = [
  'rate_limited', 'quota_exceeded', 'timeout', 'provider_unavailable',
];

/**
 * Provider outcomes that stand for the current evidence.
 *
 * The provider was reached and gave a real answer. Reattempting changes nothing
 * until the underlying evidence ages, which is a freshness question this
 * function is told about rather than one it computes.
 */
export const TERMINAL_OUTCOMES: readonly EnrichmentOutcome[] = [
  'no_match', 'field_not_found', 'provider_declined',
];

export interface DecideEnrichmentActionInput {
  /** The latest attempt for this work item, or null when none exists. */
  readonly attempt: EnrichmentAttemptRow | null;
  /** Supplied, never read from a clock — that is what makes this deterministic. */
  readonly now: string;
  /** A4J/A7A already own the lookup; this is its ANSWER, not a request to run it. */
  readonly freshEvidenceCoversRequest: boolean;
  readonly credentialAvailable: boolean;
  readonly sourceOperational: boolean;
  /**
   * A4U — the cutoff at which an UNLEASED open attempt counts as abandoned.
   *
   * Caller-supplied, exactly as the claim requires. A7I: the SAME value the
   * caller forwards into execution, so what this function judges recoverable is
   * precisely what the claim will recover. Omitted means only an expired lease
   * is recoverable, which is A4N's behaviour. No duration is invented here.
   */
  readonly abandonedBefore?: string;
}

export interface EnrichmentActionDecision {
  readonly decision: EnrichmentDecision;
  /** Deterministic and auditable: the same input always yields the same text. */
  readonly reason: string;
}

const decide = (decision: EnrichmentDecision, reason: string): EnrichmentActionDecision =>
  ({ decision, reason });

/** Milliseconds, or null when the value is absent or unparseable. */
const asMs = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Classify one work item.
 *
 * Total over the input space: every path returns, and the final fallthrough is
 * OPERATOR_REVIEW.
 */
export function decideEnrichmentAction(
  input: DecideEnrichmentActionInput,
): EnrichmentActionDecision {
  const nowMs = asMs(input.now);
  if (nowMs === null) {
    // Without a usable clock nothing time-dependent can be judged, and several
    // rules are time-dependent. Refusing to guess is the whole contract.
    return decide('OPERATOR_REVIEW', 'the supplied clock is not a usable timestamp');
  }

  const blocked = !input.credentialAvailable
    ? 'credential unavailable; no provider call should be attempted'
    : !input.sourceOperational
      ? 'source unavailable; no provider call should be attempted'
      : null;

  // ── no attempt has ever been made ────────────────────────────────────────
  if (!input.attempt) {
    if (input.freshEvidenceCoversRequest) {
      return decide('NO_ACTION', 'fresh evidence already covers requested attributes');
    }
    if (blocked) return decide('NO_ACTION', blocked);
    return decide('RETRY_PROVIDER', 'no attempt exists and no fresh evidence covers the request');
  }

  const a = input.attempt;

  // ── 1. a live lease outranks everything ──────────────────────────────────
  // A healthy execution mid-transport is `in_flight` + `unknown` + a live lease,
  // because the marker is written BEFORE the call. Checking ambiguity first
  // would escalate every ordinary in-flight call to a human.
  if (a.completedAt === null && a.claimedUntil !== null) {
    const until = asMs(a.claimedUntil);
    if (until === null) {
      return decide('OPERATOR_REVIEW', 'unrecognised attempt state requires operator review');
    }
    // Strictly greater: a lease expiring exactly now is expired, matching the
    // `claimed_until < now` predicate `dbReclaim` already uses.
    if (until > nowMs) return decide('WAIT', 'live lease is active');
  }

  // ── 2. ambiguity, once nobody holds the work ─────────────────────────────
  if (a.providerCallState === 'unknown') {
    return decide('OPERATOR_REVIEW', 'provider call state is unknown; retry is unsafe');
  }
  if (a.executionStatus === 'platform_failed' && a.providerCallState === 'called') {
    return decide('OPERATOR_REVIEW',
      'provider may have been called but response was not persisted');
  }

  // ── 3. we already have what was asked for ────────────────────────────────
  if (input.freshEvidenceCoversRequest) {
    return decide('NO_ACTION', 'fresh evidence already covers requested attributes');
  }

  // ── 4. we cannot call at all ─────────────────────────────────────────────
  // A missing credential or an inoperable source is an owner/vendor blocker, not
  // a transient provider failure. Retrying it changes nothing until someone
  // outside this system acts.
  if (blocked) return decide('NO_ACTION', blocked);

  // ── 5. abandoned and recoverable ─────────────────────────────────────────
  //
  // ─── A7I: RECOVERY IS NOT A SEPARATE ACTION ──────────────────────────────
  // This branch used to answer RECLAIM, on the reading that recovering an
  // abandoned attempt and calling a provider were two different things a caller
  // did in two steps. They are not, and treating them as two produced a
  // livelock: the caller reclaimed, took a fresh lease, and on the next cycle
  // rule 1 saw its own live lease and said WAIT — after which the lease expired
  // and this branch said RECLAIM again, forever. Nothing ever executed, nothing
  // ever completed, and A4N's live index went on blocking every new attempt for
  // that work item. That is the exact permanent wedge A4U was written to end.
  //
  // The recovery step was never needed, because `claimEnrichmentWork` already
  // performs it: its INSERT collides with the live index, and on 23505 it
  // reclaims and ADOPTS the existing row instead of opening a second one. So
  // RETRY_PROVIDER is the honest answer for both shapes below. The caller does
  // one thing, the database arbitrates it atomically, and the attempt reaches a
  // terminal state instead of circling.
  //
  // Both shapes are provably UNPAID — `in_flight` + `not_called` is asserted
  // immediately below — so adopting one and calling the provider spends the
  // tenant's quota exactly once, for a call that never happened.
  if (a.completedAt === null) {
    if (a.executionStatus !== 'in_flight' || a.providerCallState !== 'not_called') {
      return decide('OPERATOR_REVIEW', 'unrecognised attempt state requires operator review');
    }
    if (a.claimedUntil !== null) {
      // Reached only when the lease has expired — a live one returned above.
      // `reclaimExpiredAttempt`'s base predicate covers this with no cutoff.
      return decide('RETRY_PROVIDER',
        'expired uncalled attempt is adopted by the claim');
    }
    // Unleased. A4U: staleness is the caller's cutoff, never a duration we pick.
    const cutoff = asMs(input.abandonedBefore);
    const startedAt = asMs(a.startedAt);
    if (cutoff === null || startedAt === null) {
      // Without a cutoff an unleased row is indistinguishable from a live
      // manual execution, and stealing one would let two workers call a
      // provider. Waiting is the only safe answer, and it is not a livelock:
      // the row is untouched, so supplying a cutoff later resolves it.
      return decide('WAIT', 'unleased attempt is open and no abandonment cutoff was supplied');
    }
    if (startedAt < cutoff) {
      return decide('RETRY_PROVIDER',
        'unleased attempt is abandoned past the cutoff and is adopted by the claim');
    }
    return decide('WAIT', 'unleased attempt is open and not yet past the abandonment cutoff');
  }

  // ── 6. the attempt finished; classify how ────────────────────────────────
  switch (a.executionStatus) {
    case 'mark_failed':
      if (a.providerCallState !== 'not_called') break;      // contradictory → fallthrough
      return decide('RETRY_PROVIDER',
        'pre-call marker failure; provider call is proven not to have occurred');

    case 'platform_failed':
      if (a.providerCallState !== 'not_called') break;      // `called` handled above
      return decide('RETRY_PROVIDER', 'platform failure before provider call');

    case 'refused_pre_call':
      if (a.providerCallState !== 'not_called') break;
      // The blockers were checked above; reaching here means they have cleared.
      return decide('RETRY_PROVIDER',
        'pre-call refusal no longer applies; the blocking cause has cleared');

    case 'completed': {
      if (a.outcome === null) break;                        // completed must carry a verdict
      if (TERMINAL_OUTCOMES.includes(a.outcome)) {
        return decide('TERMINAL', 'terminal provider outcome');
      }
      if (TRANSIENT_OUTCOMES.includes(a.outcome)) {
        const horizon = asMs(a.nextRetryAt);
        if (horizon === null) {
          // A6A preserves a horizon ONLY when the provider supplied one. Absent
          // means the provider expressed no opinion — it does not mean "retry
          // now". No backoff policy exists in this repository, and inventing one
          // here would make it the policy by accident.
          return decide('OPERATOR_REVIEW',
            'transient outcome with no provider retry horizon; no retry policy exists');
        }
        return horizon > nowMs
          ? decide('WAIT', 'transient outcome is still within retry horizon')
          : decide('RETRY_PROVIDER', 'transient outcome is eligible after retry horizon');
      }
      // A completed attempt whose outcome is in neither set — including the
      // non-calling refusals, which should have closed as `refused_pre_call`.
      break;
    }

    default:
      break;
  }

  // ── 7. anything unrecognised ─────────────────────────────────────────────
  // Deliberately never RETRY_PROVIDER. The database does not enforce every
  // cross-column invariant, so a combination this classifier does not model may
  // exist, and spending a tenant's quota on a row we do not understand is the
  // exact failure the A4 series exists to prevent.
  return decide('OPERATOR_REVIEW', 'unrecognised attempt state requires operator review');
}
