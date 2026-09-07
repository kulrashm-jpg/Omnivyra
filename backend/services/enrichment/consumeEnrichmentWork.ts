/**
 * A7E — the consumer seam: one work item, decided by A7D, acted on through the
 * EXISTING PI infrastructure.
 *
 * ─── WHAT THIS IS, AND IS NOT ──────────────────────────────────────────────
 * A7D classifies. This module is the only thing that turns a classification into
 * an action, and it does so exclusively through primitives that already exist:
 * `listAttempts` (A7C) to load state, `decideEnrichmentAction` (A7D) to decide,
 * `reclaimExpiredAttempt` (A4U) to recover, and `executeEnrichmentRecorded`
 * (A4A/A4N) to execute. It contains NO state machine of its own.
 *
 * It is deliberately NOT a scheduler. It selects nothing, loops over nothing,
 * runs on no timer and is called by nobody. Selection, cadence and triggering
 * remain outside; this is the callable unit they would eventually call.
 *
 * ─── THE EXECUTION PATH IS STRUCTURALLY GATED ─────────────────────────────
 * `ports` is REQUIRED, with no default. This module cannot assemble a
 * production port set and deliberately does not try: A7A owns that composition,
 * and duplicating its suppression here would create exactly the second
 * implementation the audits forbid. A caller must therefore supply a real
 * composition to execute anything, which means:
 *
 *   - until A7A is merged, no caller CAN execute through this seam;
 *   - when it is, suppression arrives with the ports rather than being
 *     reimplemented here.
 *
 * That is the gate rather than a weakness. A7D's `freshEvidenceCoversRequest`
 * is a CLASSIFICATION input; A7A's `findRecentObservation` remains the
 * authoritative suppression immediately before transport. Two layers, and this
 * module removes neither.
 *
 * ─── NO PATH TO A PROVIDER EXCEPT THE RECORDED ONE ────────────────────────
 * Exactly one branch can reach a provider, and it goes through
 * `executeEnrichmentRecorded` with a lease and `requireAttemptRecord: true`. No
 * adapter is imported. Losing the claim is a normal concurrency outcome, not an
 * error, and it produces no call.
 */

import {
  listAttempts,
  reclaimExpiredAttempt,
  type EnrichmentAttemptRow,
} from './attempts';
import {
  decideEnrichmentAction,
  type EnrichmentDecision,
} from './decideEnrichmentAction';
import {
  executeEnrichmentRecorded,
  EnrichmentWorkClaimedError,
  AttemptRecordRequiredError,
  type RecordedEnrichmentResult,
} from './recordedExecution';
import type { ExecuteEnrichmentPorts } from './providers/execute';
import type { EnrichmentSubject } from './providers/contract';

/**
 * One unit of enrichment work.
 *
 * A4Y made the canonical attribute set part of work-item identity, so it is
 * carried here and used unchanged for the read, the decision and the execution.
 * `selectors` come from the caller's snapshot rather than being re-derived —
 * this module resolves no identity of its own.
 */
export interface EnrichmentWorkItem {
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  readonly entityId: string;
  readonly providerId: string;
  readonly requestedAttributes: readonly string[];
  readonly selectors: Readonly<Record<string, string>>;
}

export interface ConsumeEnrichmentWorkInput {
  readonly workItem: EnrichmentWorkItem;
  /** Supplied, never read from a clock — the decision stays deterministic. */
  readonly now: string;
  /**
   * A4J/A7A's answer, NOT a request to run the lookup. This is classification
   * input only; the execution path keeps its own authoritative suppression.
   */
  readonly freshEvidenceCoversRequest: boolean;
  readonly credentialAvailable: boolean;
  readonly sourceOperational: boolean;
  /** A4U — caller-supplied cutoff. Omitted preserves A4N behaviour exactly. */
  readonly abandonedBefore?: string;
  /**
   * The production port composition. REQUIRED and never defaulted here — see
   * the header. Only the RETRY_PROVIDER branch uses it.
   */
  readonly ports: ExecuteEnrichmentPorts;
  /** Worker identity and lease length for the claim. Never a credential. */
  readonly lease: { readonly claimedBy: string; readonly ttlMs: number };
  readonly purpose?: string;
  readonly correlationId?: string;
  /** Injected for testability; defaults to the real primitives. */
  readonly deps?: {
    readonly list?: typeof listAttempts;
    readonly reclaim?: typeof reclaimExpiredAttempt;
    readonly execute?: typeof executeEnrichmentRecorded;
  };
}

export interface ConsumeEnrichmentWorkResult {
  readonly decision: EnrichmentDecision;
  readonly reason: string;
  /** True only when a provider execution was actually attempted. */
  readonly executed: boolean;
  /** Present only for RECLAIM: whether ownership actually transferred. */
  readonly reclaimed?: boolean;
  /** Present only when execution ran and completed. */
  readonly result?: RecordedEnrichmentResult;
  /** Set when execution was refused for a normal, safe reason. */
  readonly refusal?: 'claim_lost' | 'attempt_not_recorded';
}

/**
 * Decide and act on ONE work item.
 *
 * The only branch that can reach a provider is RETRY_PROVIDER, and it does so
 * through the recorded execution seam with a lease. Every other decision is
 * inert by construction.
 */
export async function consumeEnrichmentWork(
  input: ConsumeEnrichmentWorkInput,
): Promise<ConsumeEnrichmentWorkResult> {
  const list = input.deps?.list ?? listAttempts;
  const reclaim = input.deps?.reclaim ?? reclaimExpiredAttempt;
  const execute = input.deps?.execute ?? executeEnrichmentRecorded;
  const w = input.workItem;

  // ── load the latest attempt for THIS work item ───────────────────────────
  // Scoped by the canonical attribute set: A4Y made it part of identity, so a
  // different set is a different work item and must not be read as this one's
  // history. Ordered newest-first by the seam, so one row is the latest.
  const attempts = await list({
    organizationId: w.organizationId,
    subject: w.subject,
    entityId: w.entityId,
    providerId: w.providerId,
    requestedAttributes: w.requestedAttributes,
    limit: 1,
  });
  const attempt: EnrichmentAttemptRow | null = attempts.length ? attempts[0] : null;

  // ── the single source of classification ──────────────────────────────────
  const { decision, reason } = decideEnrichmentAction({
    attempt,
    now: input.now,
    freshEvidenceCoversRequest: input.freshEvidenceCoversRequest,
    credentialAvailable: input.credentialAvailable,
    sourceOperational: input.sourceOperational,
    abandonedBefore: input.abandonedBefore,
  });

  switch (decision) {
    // ── inert by construction ──────────────────────────────────────────────
    // No attempt is created merely because a scheduler looked at the work item,
    // no timer is manufactured, and no retry record is written. WAIT simply
    // leaves the item for a future cycle.
    case 'NO_ACTION':
    case 'WAIT':
    case 'TERMINAL':
    case 'OPERATOR_REVIEW':
      return { decision, reason, executed: false };

    // ── recover abandoned ownership, and stop there ────────────────────────
    case 'RECLAIM': {
      const taken = await reclaim({
        organizationId: w.organizationId,
        subject: w.subject,
        entityId: w.entityId,
        providerId: w.providerId,
        requestedAttributes: w.requestedAttributes,
        claimedBy: input.lease.claimedBy,
        claimedUntil: new Date(Date.parse(input.now) + Math.max(1, input.lease.ttlMs)).toISOString(),
        now: input.now,
        abandonedBefore: input.abandonedBefore,
      });
      // A null result means another worker took it first. That is a normal
      // concurrency outcome, not an error, and it authorises nothing.
      //
      // Execution does NOT chain from here. Adopting a reclaimed attempt into
      // the recorded execution path has no existing seam — `executeEnrichmentRecorded`
      // always opens or claims its own attempt — and inventing one would be new
      // infrastructure. The next cycle re-reads and re-decides.
      return { decision, reason, executed: false, reclaimed: taken !== null };
    }

    // ── the ONLY path to a provider ────────────────────────────────────────
    case 'RETRY_PROVIDER': {
      try {
        const result = await execute(
          {
            organizationId: w.organizationId,
            subject: w.subject,
            entityId: w.entityId,
            // A4Y identity preserved verbatim: the set A7D judged is the set
            // executed. Never re-sorted, widened or narrowed.
            attributes: w.requestedAttributes,
            selectors: w.selectors,
            purpose: input.purpose ?? 'scheduled enrichment',
            correlationId: input.correlationId ?? `a7e-${w.entityId}-${input.now}`,
          },
          w.providerId,
          input.ports,
          {
            // A4N: the claim is the arbiter. Of two schedulers seeing the same
            // work, the database admits exactly one.
            lease: input.lease,
            // A4J: no provider call without a recorded attempt.
            requireAttemptRecord: true,
          },
        );
        return { decision, reason, executed: true, result };
      } catch (err) {
        // Losing the claim is the normal answer when another worker holds the
        // work — not an incident, and it produced no provider call.
        if (err instanceof EnrichmentWorkClaimedError) {
          return { decision, reason, executed: false, refusal: 'claim_lost' };
        }
        // A4J fail-closed: the attempt could not be recorded, so no provider was
        // contacted. Also not an incident to retry blindly.
        if (err instanceof AttemptRecordRequiredError) {
          return { decision, reason, executed: false, refusal: 'attempt_not_recorded' };
        }
        // Anything else is a real failure and is surfaced unchanged: A4E has
        // already closed the attempt truthfully, and swallowing it here would
        // hide a paid call.
        throw err;
      }
    }

    default: {
      // Unreachable while the vocabulary is closed; a compile-time exhaustiveness
      // check that degrades to review rather than to a provider call.
      const never: never = decision;
      return {
        decision: never,
        reason: 'unrecognised decision requires operator review',
        executed: false,
      };
    }
  }
}
