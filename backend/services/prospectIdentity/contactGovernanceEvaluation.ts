/**
 * W2-A PHASE 4A — the ONE impure edge that joins the canonical reader to the
 * canonical evaluator.
 *
 * ─── WHAT THIS IS, AND WHY IT IS SO SMALL ─────────────────────────────────
 * Path A (`execution/suppressionService.canonicalVerdict`) and Path B
 * (`leadOutreachExecution/governanceService.resolveCanonicalGovernanceWithAnchor`)
 * each performed the SAME three steps in their own words:
 *
 *   1. load the tenant's candidate records for (person?, target?, channel)
 *   2. normalise the target with the same normaliser the reader used
 *   3. hand both to `mayContact`
 *
 * Duplicating those three steps meant the two paths could drift on WHAT is
 * loaded or WHAT is handed to the evaluator — a drift that would be invisible
 * until one path enforced a do-not-contact the other did not. This module is
 * that triple, once.
 *
 * ─── WHAT THIS DELIBERATELY DOES *NOT* ABSORB ─────────────────────────────
 * The two paths differ in ways that are CORRECT and must not be flattened, so
 * each keeps them:
 *
 *   IDENTITY. Path A resolves a person from a raw endpoint via `identity_claims`
 *   (it is reached with a recipient and no identity). Path B resolves one from
 *   the Contract 13 anchor order — explicit id, `outreach_tasks.person_id`,
 *   `leads.unified_person_id`. These answer different questions from different
 *   evidence; forcing one resolver on both seams would weaken whichever lost.
 *   This module therefore ACCEPTS an already-resolved `personId` and resolves
 *   nothing.
 *
 *   FAILURE SHAPE. Path A fail-closes by THROWING a stage-tagged error its
 *   caller maps onto a suppression result and a counter. Path B fail-closes by
 *   RETURNING a `blocked` verdict carrying `version: 'li3c'`. Both are
 *   fail-closed and both are observable; neither is the other. This module
 *   reports `ok: false` and lets each caller keep its own vocabulary.
 *
 *   APPLICABILITY. Path B has a real "the canonical layer does not apply" case
 *   (no tenant, no channel, nothing to anchor on) that Path A cannot reach.
 *   That stays with Path B.
 *
 *   LEGACY STORES. Neither is touched here. Path A reads `suppression_entries`;
 *   Path B reads `outreach_suppressions`; Phase 4A does NOT converge them, and
 *   this module gives neither path sight of the other's store.
 *
 *   THE CLOCK. Path A evaluates at `new Date()`; Path B at an injected
 *   `evaluatedAt` that makes its decisions reproducible. `now` is a parameter.
 *
 * ─── TWO PRECISE BEHAVIOURS WORTH STATING ─────────────────────────────────
 * The internal `try` wraps the LOAD ONLY. `mayContact` throws when it is given
 * no tenant or no channel, and that throw must keep propagating: Path A turns it
 * into its canonical-read fail-closed exit, while Path B lets it reach
 * `evaluateTaskGovernance`'s context-load handler. Catching it here would
 * silently relabel one of them.
 *
 * `mayContact` remains the SOLE policy owner. No band, no ordering, no
 * `campaign_exclusion` behaviour and no anchor rule is reimplemented, decided or
 * second-guessed in this file. It loads and it delegates.
 */

/**
 * ═══ THE TRANSITIONAL GOVERNANCE CONTRACT (Phase 4C-0, recorded here) ═══════
 *
 * Four paths evaluate contact governance. They SHARE this edge and nothing
 * else, and that asymmetry is the contract — not an unfinished migration.
 *
 *   Path A  execution/suppressionService.isSuppressed
 *           canonical (here) -> `suppression_entries`, INCLUDING the
 *           transitional `__global__` sentinel. Reached by executionBridge
 *           (dry-run) and the operator route's suppress / release /
 *           check_suppression actions.
 *   Path B  leadOutreachExecution/governanceService + governance
 *           canonical (here) -> `outreach_suppressions`, ALL FOUR scopes
 *           (recipient, channel, task, lead). Reached by the LIVE dispatch gate.
 *   Path C  prospectOutreach/readiness — CANONICAL ONLY. A test asserts it
 *           names no legacy store.
 *   Path D  leadIntelligence export (W0-B) and whatsappBroadcastService (W0-C)
 *           — CANONICAL ONLY, via the tenant-wide reader plus pure `mayContact`.
 *
 * ─── THE INVARIANTS ────────────────────────────────────────────────────────
 *   1. TENANT FIRST. Validated before any data access; never guessed. No
 *      tenant is a fail-closed exit, not an empty result.
 *   2. IDENTITY: genuine ABSENCE (the store answered, no person claims the
 *      endpoint) degrades to target-only matching and must NOT block. A FAILED
 *      or AMBIGUOUS resolution must. Conflating them is the defect both halves
 *      of this seam exist to prevent.
 *   3. CANONICAL FIRST, and it SHORT-CIRCUITS. A canonical block or deferment
 *      returns before any legacy store is read at all.
 *   4. LEGACY MAY ONLY ADD A BLOCK. It can never grant permission, and it is
 *      never consulted to release a canonical restriction.
 *   5. FAIL CLOSED on a canonical read failure and on each path's OWN legacy
 *      read failure. An unreadable do-not-contact list is never "nobody is
 *      suppressed".
 *   6. RELEASE is channel-exact and SYMMETRIC across both stores: releasing one
 *      channel lifts no `'*'` record, and releasing `'*'` lifts no
 *      channel-specific record. Canonical records are revoked, never deleted.
 *   7. OBSERVABILITY carries no endpoint value — no email, phone or handle in
 *      any log line or fault code. Fault codes carry the SQLSTATE only.
 *   8. `mayContact` precedence, bands, wildcard semantics and the inertness of
 *      `campaign_exclusion` are FIXED. This edge loads and delegates.
 *
 * ─── TRANSITION LIMITS ─────────────────────────────────────────────────────
 * Do NOT make both paths read both legacy stores: that would let a sentinel no
 * application flow can write or revoke block live sends for every tenant, and
 * would hand Path A scopes it structurally cannot evaluate. Do NOT extend any
 * legacy read to Paths C or D. Do NOT add a global, task or lead scope to
 * canonical contact governance. Do NOT create new production dependencies on
 * either legacy store.
 *
 * ─── RETIREMENT GATES ──────────────────────────────────────────────────────
 * Retiring a READ, retiring a SCOPE, disposing of DATA and DROPPING a table are
 * four separate operations with four separate proofs. None is authorized.
 *   G-1  documentation (this comment)                        — done
 *   G-2  implementation (scopesEvaluated, diagnostics,
 *        phone normalisation)                               — NOT authorized
 *   G-3  database evidence: consumer inventory beyond the
 *        tracked tree, plus authorized row counts verified
 *        by project REF, never by Studio name               — NOT authorized
 *   G-4  retirement: data disposition, replacement-behaviour
 *        tests, rollback script, schema authorization        — NOT authorized
 * The controlling property for G-4: for every input blocked today, the
 * post-removal system must still block, or the difference must be accepted in
 * writing. That includes each read's FAIL-CLOSED contribution, which must be
 * removed deliberately and tested — never as a side effect of deleting a query.
 *
 * ─── UNRESOLVED DECISIONS ──────────────────────────────────────────────────
 *   D-1   `__global__`: retirement is the accepted DIRECTION, conditional on
 *         confirming no product, legal or safety requirement depends on it.
 *         Blocking stays intact meanwhile. OWNER/LEGAL.
 *   D-3   task scope: transitional, leading retirement candidate.
 *         lead scope: OPEN — retire, or design a separate operational control.
 *         Neither becomes a canonical governance scope by default.
 *   P4-2  additive diagnostics on `check_suppression`: blocked pending an
 *         external consumer inventory.
 * Per-path detail lives with each path: see `execution/suppressionService` for
 * Path A and `leadOutreachExecution/governanceService` for Path B.
 */

import { mayContact, type MayContactResult } from './contactGovernance';
import { type ContactPurpose } from './contactPurpose';
import { loadGovernanceRecords, normalizeGovernanceTarget } from './contactGovernanceRepository';

/**
 * PHASE 4C-2 — which governance scopes an evaluation ACTUALLY evaluated.
 *
 * OBSERVABILITY METADATA ONLY. Nothing in this repository reads it to decide
 * anything: it does not affect authorization, matching, eligibility or the
 * verdict. It exists because an evaluation that matched on a target alone and
 * one that matched with a person anchor resolved were previously
 * indistinguishable to an operator, even though only the second could ever have
 * matched a person-anchored do-not-contact record.
 *
 * THE VOCABULARY IS GROUNDED IN EXISTING NAMES — the canonical anchors
 * `mayContact` reports as `matchedBy`, and the two legacy stores as they are
 * named in their own DDL:
 *
 *   canonical.person                   the canonical read completed AND a person
 *                                      anchor was in play, so person-anchored
 *                                      records could match
 *   canonical.target                   the canonical read completed AND a
 *                                      normalised target was in play
 *   suppression_entries                Path A's legacy read COMPLETED. One value,
 *                                      not two: that read is a single query
 *                                      spanning the tenant rows and the
 *                                      `__global__` sentinel together, so
 *                                      splitting it would claim a granularity
 *                                      the code does not have
 *   outreach_suppressions.recipient    Path B's legacy read COMPLETED and this
 *   outreach_suppressions.channel      scope had a value to match on. One query
 *   outreach_suppressions.task         derives all four, so they are reported
 *   outreach_suppressions.lead         per scope only where a value existed
 *
 * ─── WHAT A REPORTED VALUE DOES *NOT* CLAIM ───────────────────────────────
 *   - It never claims a RESTRICTION was found. That is the verdict's job.
 *   - It never claims a store was read that the path does not read: Path A
 *     reports no `outreach_suppressions.*`, Path B reports no
 *     `suppression_entries`, and Paths C and D report neither.
 *   - `canonical.target` alone never implies person-specific governance was
 *     evaluated. A target-only or degraded-identity evaluation reports exactly
 *     that, which is the whole point.
 *
 * ─── ABSENCE IS THE FAILURE SIGNAL ────────────────────────────────────────
 * A scope is listed ONLY once its read has successfully completed. A canonical
 * or legacy read that failed, or a store a canonical block short-circuited past,
 * is simply NOT listed — and the existing fail-closed `reason` already says
 * which stage could not answer. No new state is invented, and no additional read
 * is ever performed to populate this list.
 */
export type GovernanceScopeEvaluated =
  | 'canonical.person'
  | 'canonical.target'
  | 'suppression_entries'
  | 'outreach_suppressions.recipient'
  | 'outreach_suppressions.channel'
  | 'outreach_suppressions.task'
  | 'outreach_suppressions.lead';

export interface CanonicalEvaluationRequest {
  /** MANDATORY. Governance is never evaluated without a tenant. */
  organizationId: string;
  /** MANDATORY. `'*'` records apply to every channel; the reader asks for both. */
  channel: string;
  /** Already resolved by the caller's own resolver, or null for target-only matching. */
  personId: string | null;
  /** The RAW recipient. Normalisation happens here, with the reader's own function. */
  target: string | null;
  /** Injected instant, so a caller that must be reproducible can be. */
  now: string;
  /**
   * PG-001 ATTEMPT PURPOSE — what the caller is about to do.
   *
   * OPTIONAL, and an omission is SAFE BY CONSTRUCTION: an undeclared purpose is
   * `all`, which stays subject to every restriction. That is why planning,
   * readiness, export and recommendation callers can keep calling this
   * unchanged — they are not sending, so they declare nothing and are governed
   * by the broadest reading of every record.
   *
   * An EXECUTION BOUNDARY should always pass one. Path B dispatch passes
   * `'outreach'`.
   */
  attemptPurpose?: ContactPurpose;
}

export type CanonicalEvaluationResult =
  | {
      ok: true;
      verdict: MayContactResult;
      /** The value actually compared against, returned so a caller need not recompute it. */
      targetNormalized: string | null;
      /**
       * PHASE 4C-2 — the CANONICAL scopes this evaluation actually evaluated.
       * Empty when the reader was handed no anchor at all, because it then
       * returns without reading and nothing was evaluated.
       */
      scopesEvaluated: readonly GovernanceScopeEvaluated[];
    }
  /** The records could not be read. The caller MUST fail closed in its own vocabulary. */
  | { ok: false; error: string };

/**
 * Load the tenant's candidate governance records and evaluate them.
 *
 * Never fails open: an unreadable store yields `ok: false`, never an empty
 * record set, because "nobody is governed" and "we could not ask" must never be
 * the same answer.
 */
export async function evaluateCanonicalGovernance(
  request: CanonicalEvaluationRequest,
): Promise<CanonicalEvaluationResult> {
  const { organizationId, channel, personId, target, now, attemptPurpose } = request;

  let loaded;
  try {
    loaded = await loadGovernanceRecords({ organizationId, personId, target, channel });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'canonical governance read failed' };
  }
  if (!loaded.ok) return { ok: false, error: loaded.error ?? 'canonical governance read failed' };

  // Normalise explicitly with the SAME function the repository used for its
  // query. Deriving it from a loaded record would be wrong: a record matched on
  // person could carry a different target and would silently change what the
  // evaluator compares against.
  const targetNormalized = normalizeGovernanceTarget(channel, target);

  const verdict = mayContact({
    organizationId,
    personId,
    targetNormalized,
    channel,
    now,
    records: loaded.records,
    attemptPurpose,
  });

  // PHASE 4C-2 — derived from what this call actually did, not from a static
  // list of what it could have done. The read has completed by this point
  // (`ok: false` returned above otherwise), so each anchor that was in play is
  // reported and each that was absent is not. No extra read is performed.
  const scopesEvaluated: GovernanceScopeEvaluated[] = [];
  if (personId) scopesEvaluated.push('canonical.person');
  if (targetNormalized) scopesEvaluated.push('canonical.target');

  return { ok: true, verdict, targetNormalized, scopesEvaluated };
}
