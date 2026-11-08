/**
 * P0 CONTACT GOVERNANCE — one decision from several database reads, each judged
 * at the instant its own rows were read.
 *
 * ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * The anchored loader issues TWO PostgREST requests when a caller holds both a
 * person and a target: one per anchor, because the two supporting indexes are
 * separate partial indexes and a single `or()` would use neither. PostgREST
 * serves one transaction per request, so those two responses carry two
 * different `transaction_timestamp()` values. There is no single instant that
 * honestly describes both.
 *
 * Picking one would be picking a fail-open direction. The earliest makes a
 * just-started restriction read as "not yet in force"; the latest makes a
 * just-expired deferment read as "lapsed". Both PERMIT contact, and on a
 * suppression check neither is acceptable.
 *
 * So no instant is picked. Each response is evaluated against the instant it
 * arrived with, and the per-response verdicts are combined in the RESTRICTIVE
 * direction only.
 *
 * ─── IT IS NOT A SECOND AUTHORITY ─────────────────────────────────────────
 * Every verdict in here is produced by `mayContact` and by nothing else. There
 * is no rule, no band, no timestamp comparison and no temporal parser in this
 * file: it chooses among verdicts the authority returned. That is the whole
 * reason it is a separate module from the evaluator rather than a change to it.
 *
 * ─── WHAT IT DOES NOT GUARANTEE ───────────────────────────────────────────
 * It does NOT make two requests into one atomic database snapshot, and nothing
 * here should be read as claiming that. Two requests observe two snapshots. The
 * combined decision is sound as of the EARLIER of them: a restriction committed
 * after the first request began can still be missed by it, exactly as any
 * read-then-act decision can miss a write that lands after its read. See
 * READ-AFTER-CHANGE at the foot of this file for the timeline and for the
 * options that would narrow it.
 *
 * What it does guarantee is narrower and checkable:
 *   1. no row set is ever judged against another request's instant;
 *   2. no row set is ever judged against a host clock;
 *   3. a permissive verdict never overrides a restrictive one;
 *   4. a read that failed, or that returned rows without a usable instant,
 *      prevents the combined decision from permitting contact.
 */

import { mayContact, type MayContactInput, type MayContactResult } from './contactGovernance';
import type { GovernanceRead, GovernanceReadAnchor } from './contactGovernanceRepository';

/**
 * Everything `mayContact` needs EXCEPT the two things that must come per read.
 * Derived from the authority's own input type, so a field added there cannot be
 * silently dropped here.
 */
export type GovernanceEvaluationBase = Omit<MayContactInput, 'records' | 'now'>;

/** What happened to ONE read, and the verdict it produced on its own. */
export interface GovernanceReadEvaluation {
  anchor: GovernanceReadAnchor;
  /** The instant handed to the authority for this read. `null` = nothing to judge. */
  readAt: string | null;
  recordCount: number;
  /** This read's own verdict, or `null` when it contributed none. */
  verdict: MayContactResult | null;
  /** Set when this read could not be evaluated. The combined decision fails closed. */
  indeterminate?: string;
}

/**
 * `ok: false` is the INDETERMINATE outcome, and it is not a verdict: the caller
 * must fail closed in its own vocabulary, exactly as it already does for
 * `GovernanceLoadResult.ok === false`. Representing it instead as a `blocked`
 * `MayContactResult` was rejected — a verdict naming no record and no
 * governance type would be indistinguishable from a real restriction in logs
 * and in an operator's explanation of why a send was stopped.
 */
export type AggregatedGovernanceDecision =
  | { ok: true; verdict: MayContactResult; reads: GovernanceReadEvaluation[] }
  | { ok: false; error: string; reads: GovernanceReadEvaluation[] };

/**
 * The instant handed to the authority when there are NO records to judge.
 *
 * Provably inert, and the inertness is TESTED rather than assumed: `input.now`
 * is read at exactly one place in the evaluator — the `isInForce` filter — and
 * a filter over an empty array never invokes its callback. With `records: []`
 * the verdict is "nothing applies" for every possible instant.
 * `contactGovernanceReadAggregation.test.ts` pins that across a spread of
 * instants including this one, so a future change that starts reading `now`
 * for an empty set fails there instead of quietly depending on this value.
 *
 * It is deliberately NOT a clock reading. Putting a real instant here would be
 * inventing a decision time for a decision that had nothing to decide.
 */
const NO_RECORDS_INSTANT = '';

/**
 * A total order over an entire verdict, most restrictive first.
 *
 * The FIRST key is the only one that carries meaning: the gate band, which is
 * how the evaluator itself ranks severity (lower band wins, and `allowed` sorts
 * past the end). The rest are TIEBREAKS ONLY and assert nothing about
 * severity — they exist so that two equally restrictive verdicts resolve the
 * same way whichever order the reads happened in. Every observable field of the
 * verdict appears, so a tie is a verdict equal field for field, and the
 * reduction below is independent of input ordering by construction rather than
 * by luck.
 *
 * A non-`allowed` verdict with a null `gate` cannot occur today — the evaluator
 * sets them together. It is ranked 0, the most restrictive position, so that if
 * it ever could it would fail closed rather than sort as permissive.
 */
const severityKey = (r: MayContactResult): readonly [number, string, string, string, string, string, string] => [
  r.decision === 'allowed' ? Number.MAX_SAFE_INTEGER : (r.gate ?? 0),
  r.governanceType ?? '',
  r.recordId ?? '',
  r.matchedBy ?? '',
  r.reason,
  r.deferredUntil ?? '',
  r.decision,
];

const compareSeverity = (a: MayContactResult, b: MayContactResult): number => {
  const ka = severityKey(a);
  const kb = severityKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
};

/** The more restrictive of two verdicts; a tie resolves to an equal value. */
const moreRestrictive = (a: MayContactResult, b: MayContactResult): MayContactResult =>
  (compareSeverity(a, b) <= 0 ? a : b);

/**
 * Evaluate each read at its own instant and combine the verdicts restrictively.
 *
 * `reads` is `GovernanceLoadResult.reads`. It is optional on that type so that
 * existing consumers and hand-built port doubles keep compiling, which means
 * `undefined` can reach here — and it is INDETERMINATE, never "no reads". A
 * producer that did not report its reads has not said what it read, and the one
 * thing that must not follow from that is permission to make contact.
 *
 * An EMPTY array is different, and is not indeterminate: the loaders return it
 * when they made no request at all because no anchor and no channel could have
 * matched anything. Nothing was read because nothing could apply, and the
 * verdict is the same "nothing applies" the evaluator already returned for that
 * case before this change.
 */
export function evaluateGovernanceReads(
  reads: readonly GovernanceRead[] | undefined,
  base: GovernanceEvaluationBase,
): AggregatedGovernanceDecision {
  if (reads === undefined) {
    return {
      ok: false,
      error: 'governance reads were not reported, so no decision instant is known',
      reads: [],
    };
  }

  const evaluations: GovernanceReadEvaluation[] = [];
  const verdicts: MayContactResult[] = [];
  const indeterminate: string[] = [];

  for (const read of reads) {
    if (!read.ok) {
      const why = `${read.anchor}: ${read.error ?? 'read failed'}`;
      indeterminate.push(why);
      evaluations.push({ anchor: read.anchor, readAt: null, recordCount: 0, verdict: null, indeterminate: why });
      continue;
    }

    if (read.records.length === 0) {
      // NEUTRAL, which is not the same as permissive: it contributes no verdict
      // at all, so it cannot outvote a restriction from the other read. No
      // instant is required, and none is fabricated.
      evaluations.push({ anchor: read.anchor, readAt: read.readAt, recordCount: 0, verdict: null });
      continue;
    }

    if (read.readAt === null) {
      // Rows arrived, but without the one instant they can honestly be judged
      // against. The only alternatives are another request's instant or a host
      // clock, and both are the defect this change exists to remove.
      const why = `${read.anchor}: ${read.records.length} governance record(s) arrived without a database read instant`;
      indeterminate.push(why);
      evaluations.push({ anchor: read.anchor, readAt: null, recordCount: read.records.length, verdict: null, indeterminate: why });
      continue;
    }

    // THE ONE LOAD-BEARING LINE: this read's rows, this read's instant.
    const verdict = mayContact({ ...base, records: read.records, now: read.readAt });
    verdicts.push(verdict);
    evaluations.push({ anchor: read.anchor, readAt: read.readAt, recordCount: read.records.length, verdict });
  }

  if (indeterminate.length > 0) {
    // FAIL CLOSED FIRST, before any permissive verdict is considered. A read we
    // could not evaluate is not outweighed by a read that said yes — and when
    // the other read was a restriction, its reason stays in `reads`, so an
    // operator still sees everything that was known.
    return { ok: false, error: `governance state is indeterminate — ${indeterminate.join('; ')}`, reads: evaluations };
  }

  if (verdicts.length === 0) {
    // Every read was empty, or no read was needed. One verdict, from the
    // authority, over an empty record set — see NO_RECORDS_INSTANT.
    return { ok: true, verdict: mayContact({ ...base, records: [], now: NO_RECORDS_INSTANT }), reads: evaluations };
  }

  return { ok: true, verdict: verdicts.reduce(moreRestrictive), reads: evaluations };
}

/**
 * READ-AFTER-CHANGE, stated rather than glossed.
 *
 * Request A (person anchor) opens its transaction at T1. Request B (target
 * anchor) opens its own at T2 > T1. A restriction COMMITTED at T, T1 < T < T2,
 * and anchored to the person, is invisible to A — its snapshot predates the
 * commit — and unmatched by B, which filters `target_normalized`, not
 * `person_id`. The combined decision can therefore permit contact although by
 * T2 a person-anchored restriction existed.
 *
 * Three things are true about that window, and all three matter:
 *   • It is NOT introduced here. `loadGovernanceRecords` already issued these
 *     two requests before this change; only the instant each is judged at is
 *     new. The window is the width it has always been.
 *   • It is the ordinary bound of any read-then-decide gate. A single atomic
 *     read at T1 would miss the same commit. What two requests add is that a
 *     commit visible by T2 can still be missed — so the combined decision is
 *     sound as of T1, the EARLIER instant, and not as of T2.
 *   • It cannot be closed by restrictive aggregation, and this module does not
 *     claim to close it. Aggregation chooses between verdicts; it cannot
 *     conjure rows that neither request returned.
 *
 * Narrowing it is an OWNER DECISION with real costs, not a change to make
 * quietly. The options, with what each actually buys:
 *   (a) accept the window and record it — the standard bound, no cost;
 *   (b) one request via `or()` — one snapshot, one instant, no window between
 *       anchors at all; it reverses the documented partial-index decision on
 *       the hottest governance read and needs a performance owner;
 *   (c) REPEATABLE READ or SERIALIZABLE across both reads — not expressible
 *       through PostgREST, which gives one transaction per request;
 *   (d) enforce at the write boundary instead, so a restriction committed
 *       during a send cancels it — a different mechanism and a larger change.
 *
 * A fifth non-option, for the record: re-reading after the decision and
 * comparing. It narrows nothing, because the same window reopens around the
 * re-read.
 */
