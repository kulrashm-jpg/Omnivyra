/**
 * PI contract #10 — the OUTCOME → TRANSITION INTERPRETER (PI-ADR-002 §3.1(5)).
 *
 * PI-ADR-002 §3.1(5) promises that "outcome interpretation maps the eight-value
 * outcome vocabulary onto lifecycle transitions and next actions". Until now
 * that mapping existed only as prose in `stateModel.ts:13-25` — "every edge
 * below has a named cause in the 8-value `outreach_outcomes` vocabulary" — and
 * nothing turned an outcome into a state. This module is that mapping, as code,
 * with the prose as its specification.
 *
 * ─── IT PROPOSES. IT DECIDES, SENDS AND WRITES NOTHING. ────────────────────
 * PI decides, Outreach executes (PI-ADR-002 §3.2.1). Nothing here composes,
 * enqueues, dispatches, schedules or writes — not a lifecycle row, and above all
 * not a TASK state: `feedbackIngestion` answers `stateAdvanced: false` for every
 * business signal (§3.2.3) and this module neither weakens nor bypasses that. It
 * returns a PROPOSAL shaped so a caller can hand it to `recordProspectTransition`
 * unchanged, and it is the caller — not this function — that decides to write.
 *
 * It is also DELIBERATELY UNWIRED. No route, worker, cron or read surface calls
 * it yet; wiring it bumps `PROSPECT_API_VERSION` and is a separate, deliberate
 * step.
 *
 * ─── AN OUTCOME IS EVIDENCE, NEVER A DECISION ──────────────────────────────
 * Every proposal carries the `outreach_outcomes.id` that caused it and the
 * stable `outcome:<id>` event key built from it, because that is exactly what
 * `lifecycleWriter.validate()` demands (`evidence_row_required`) and what
 * PI-ADR-002 §4 requires of every transition. An outcome that cannot be cited
 * cannot cause a transition, so an uncitable id abstains rather than proposing
 * an uncited move.
 *
 * ─── ABSENCE ABSTAINS ──────────────────────────────────────────────────────
 * PI-ADR-002 §3.2.5. No outcome, an unrecognised outcome, an outcome that maps
 * to no state, a prospect with no ledger — each returns an EXPLICIT no-transition
 * with a named reason. There is no default state and no nearest guess anywhere
 * in this module, and the vocabulary is covered exhaustively by a total
 * `Record<BusinessOutcomeType, …>` so a ninth outcome would fail to compile
 * rather than fall through to a default.
 *
 * ─── IT PRODUCES NO VERDICT, AND NO UNREACHABLE STATE ──────────────────────
 * `suppressed`, `outreach-ready` and `no-response` are COMPUTED VERDICTS
 * (PI-ADR-004 §4.1). They are not in `ProspectState`, so the map below cannot
 * name one, and this module deliberately surfaces NO readiness-adjacent
 * conclusion at all — `mayContact` remains the sole evaluator of what the
 * platform is permitted to do, and the cleanest way to honour "suppression
 * overrides everything" is to say nothing that could be mistaken for it.
 * `meeting_scheduled` is in `PROSPECT_STATES_UNREACHABLE_TODAY` and is likewise
 * never proposed — see the `meeting_booked` note in the map.
 *
 * ─── NO SENTIMENT AXIS ─────────────────────────────────────────────────────
 * `prospectOutcomes/corpus.ts` refuses to invent one ("no sentiment axis
 * exists; `replied` states nothing about tone") and so does this. `replied`
 * means a human answered, which is `engaged` — not "positive". `rejected` is an
 * operator's judgement carried on an outcome row, never something inferred from
 * a reply, which is why its proposal demands a `human` origin.
 *
 * ─── ONE OUTCOME AT A TIME ─────────────────────────────────────────────────
 * It interprets a SINGLE outcome against a SINGLE current state. Folding a
 * whole corpus into one conclusion needs a precedence and recency policy that
 * nobody has decided, and inventing one here would hide it.
 */

import {
  classifyProspectTransition,
  explainProspectTransition,
  isProspectState,
  isSourceEventKey,
  sourceEventKey,
  PROSPECT_STATES_UNREACHABLE_TODAY,
  type ProspectState,
  type TransitionOrigin,
} from './stateModel';
import type { BusinessOutcomeType } from '../leadOutreachExecution/types';

/** Bumped when the mapping changes, so a stored transition traces its reading. */
export const OUTCOME_INTERPRETER_VERSION = 'pi.outcome-interpreter.1';

// ── What an outcome has to be, for this module to read it ───────────────────

/**
 * The minimum an outcome must carry. A structural subset of `ProspectOutcome`
 * (`prospectOutcomes/corpus.ts`) on purpose: a corpus row can be passed in
 * directly, and this module does not import the corpus — it must not acquire a
 * dependency on a read path it is not part of.
 *
 * `type` is typed loosely because the corpus reports a stored value outside the
 * established vocabulary as `null` and lists it, rather than coercing it into
 * the nearest recognised category. That value reaches here as-is and is
 * refused by name.
 */
export interface InterpretableOutcome {
  /** `outreach_outcomes.id`. The citation, and the anchor of the event key. */
  readonly id: string;
  readonly type: BusinessOutcomeType | string | null;
}

export interface OutcomeInterpretationInput {
  /** The one outcome being read. Absent is a legitimate input, not an error. */
  readonly outcome: InterpretableOutcome | null | undefined;
  /**
   * The prospect's state NOW, from `readCurrentProspectState`. Null means the
   * prospect has no lifecycle ledger — which abstains, see `lifecycle_not_open`.
   */
  readonly currentState: ProspectState | null | undefined;
}

// ── What it answers ─────────────────────────────────────────────────────────

export type NoTransitionReason =
  /** Nothing was supplied. Absence abstains; it is not "cold". */
  | 'no_outcome'
  /** A stored value outside the 8-value vocabulary. Reported, never coerced. */
  | 'outcome_not_in_vocabulary'
  /** The outcome has no usable `outreach_outcomes.id`, so it cannot be cited. */
  | 'evidence_not_citable'
  /** The prospect has no ledger. `ensureProspectLifecycleOpen` owns the first row. */
  | 'lifecycle_not_open'
  /** A real outcome that names no resting position. `opened` and `clicked`. */
  | 'not_lifecycle_bearing'
  /** The mapping describes the edge, but the target is unreachable today. */
  | 'target_state_unreachable'
  /** The prospect is already where the mapping points. The writer's `unchanged`. */
  | 'already_in_target_state'
  /** The target is a real state, but not from here — the graph refuses the edge. */
  | 'edge_not_permitted'
  /** A machine-derived silence must not overturn a human's judgement. */
  | 'human_judgement_not_overturned';

/** A transition the caller MAY write. Shaped to feed `RecordTransitionInput`. */
export interface ProposedTransition {
  readonly kind: 'transition';
  readonly from: ProspectState;
  readonly to: ProspectState;
  /**
   * The origin the write MUST carry. `human` is not a formality: the writer
   * refuses a human transition that names no actor (`actor_required`), so a
   * `human` proposal is unwritable until a caller attaches the operator who
   * made the judgement. That is the intended friction.
   */
  readonly origin: TransitionOrigin;
  readonly evidence: { readonly kind: 'outreach_outcome'; readonly outcomeId: string };
  /** `outcome:<id>` — append-only, so one outcome causes at most one transition. */
  readonly sourceEventKey: string;
  readonly outcomeType: BusinessOutcomeType;
  /** Audit prose for `reasoning`. States the cause, never a sentiment. */
  readonly reasoning: string;
  readonly modelVersion: string;
}

export interface NoTransition {
  readonly kind: 'no-transition';
  readonly reason: NoTransitionReason;
  /** The state the mapping points at, when it points at one. Never a guess. */
  readonly describedTarget: ProspectState | null;
  readonly outcomeType: BusinessOutcomeType | null;
  readonly detail: string;
}

/**
 * The mapping is genuinely undecided for this input. LOUDER than a
 * no-transition on purpose: a caller must not read "nobody has decided" as
 * "correctly nothing to do".
 */
export interface NeedsPolicy {
  readonly kind: 'needs-policy';
  readonly decision: 'converted_has_no_state' | 'silence_after_engagement';
  readonly outcomeType: BusinessOutcomeType;
  readonly describedTarget: null;
  /** The concrete options, so the decision can be taken rather than rediscovered. */
  readonly alternatives: readonly string[];
  readonly detail: string;
}

export type OutcomeInterpretation = ProposedTransition | NoTransition | NeedsPolicy;

// ── THE MAPPING ─────────────────────────────────────────────────────────────

/**
 * How each outcome is read. Stated as DATA so a test can assert it rather than
 * trust prose — the idiom `PROSPECT_STATES_NOT_MODELLED` already uses.
 *
 * `from` is the one piece of context the mapping genuinely needs, and only
 * `no_response` needs more of it than the graph already supplies.
 */
export type OutcomeDisposition =
  /** Unconditional: this outcome names this state, from wherever the graph allows. */
  | { readonly kind: 'transition'; readonly to: ProspectState; readonly origin: TransitionOrigin; readonly rationale: string }
  /** In the vocabulary, but it names no resting position. */
  | { readonly kind: 'not-lifecycle-bearing'; readonly rationale: string }
  /** The edge is described by the contract; the state cannot be reached today. */
  | { readonly kind: 'unreachable'; readonly describes: ProspectState; readonly rationale: string }
  /** Conditional on the state the prospect is in. See `no_response`. */
  | { readonly kind: 'conditional'; readonly to: ProspectState; readonly origin: TransitionOrigin; readonly rationale: string }
  /** No target exists in the vocabulary, and picking one would be an invention. */
  | { readonly kind: 'needs-policy'; readonly decision: NeedsPolicy['decision']; readonly alternatives: readonly string[]; readonly rationale: string };

/**
 * The eight-value vocabulary, read onto the transition graph.
 *
 * A total `Record` over `BusinessOutcomeType`: the exhaustiveness is a compile
 * error, not a test convention. Four outcomes name an edge, one describes an
 * edge it cannot reach, two name nothing, one has no state to name.
 *
 * Cross-check against `stateModel.ts:19-25`: the outcome vocabulary causes
 * `-> engaged`, `-> nurture`, `-> not_interested` and `-> closed_disqualified`,
 * and describes `-> meeting_scheduled`. It does NOT cause `-> qualified`, whose
 * named cause is the ICP evaluator, and it does not cause the initial
 * `identified` row, whose cause is prospect resolution. No outcome is mapped
 * onto an edge whose cause is something other than an outcome.
 */
export const OUTCOME_TRANSITION_MAP: Readonly<Record<BusinessOutcomeType, OutcomeDisposition>> = {
  // `opened` and `clicked` are in UNOBSERVABLE_BUSINESS_OUTCOMES — no transport
  // here emits them — but that is not the whole reason they map to nothing.
  // Even fully instrumented, a pixel load is not a resting position: it says a
  // message was rendered, not where the prospect stands. Reading one as
  // engagement is the sentiment invention this lane refuses, in its weakest and
  // most tempting form.
  opened: {
    kind: 'not-lifecycle-bearing',
    rationale: 'an open is a message-rendering event, not a prospect position; it is also unobservable today',
  },
  clicked: {
    kind: 'not-lifecycle-bearing',
    rationale: 'a click is a message-interaction event, not a prospect position; it is also unobservable today',
  },

  // `replied` -> `engaged`. The one unambiguous, observable, lifecycle-bearing
  // outcome: a human answered. NOTHING about tone is read from it. The graph
  // already carries the two edges this makes real and explains both —
  // `identified -> engaged` for inbound, and `not_interested -> engaged`
  // because `rejected` means "not interested in THIS" and a later reply is a
  // real observation the writer must not drop.
  replied: {
    kind: 'transition',
    to: 'engaged',
    origin: 'derived',
    rationale: 'a reply is a witnessed human response, which is engagement; it says nothing about tone',
  },

  // `meeting_booked` DESCRIBES `qualified|engaged -> meeting_scheduled` and
  // proposes nothing. See `THE meeting_booked CONTRADICTION` below.
  meeting_booked: {
    kind: 'unreachable',
    describes: 'meeting_scheduled',
    rationale: 'meeting_scheduled is in PROSPECT_STATES_UNREACHABLE_TODAY — no booking integration exists',
  },

  // `rejected` -> `not_interested`, and it must be written as `human`.
  //
  // `feedbackIngestion` excludes `rejected` from `FEEDBACK_SIGNALS` outright,
  // stating why: it is "an operator's reading of a reply, recorded through the
  // human decision path with an approver attached", and admitting it would let
  // an anonymous webhook assert a human judgement. The manual route excludes it
  // for the same reason. So a `rejected` row is, by construction, somebody's
  // judgement — and a transition caused by it is `origin: 'human'`, not a model
  // output. Marking it `derived` would launder a judgement into an inference.
  rejected: {
    kind: 'transition',
    to: 'not_interested',
    origin: 'human',
    rationale: 'a rejection is an operator judgement that this prospect is not interested in THIS approach',
  },

  // `no_response` -> `nurture`, CONDITIONALLY.
  //
  // PROSPECT_STATES_NOT_MODELLED and PI-ADR-004 §4.1 both say the prospect-level
  // state a no-response implies is `nurture`. Both also say it is a per-ATTEMPT
  // derived fact. Those two statements only agree where nothing better is known:
  // one unanswered attempt on a prospect who has already replied does not put
  // that prospect in nurture, and letting it would let a silence erase a
  // witnessed engagement. So the proposal is made only from the states that
  // carry neither witnessed engagement nor a human judgement, and the rest are
  // reported rather than guessed. See `interpretOutcome` for each branch.
  //
  // NOTE this interprets a no-response row THAT ALREADY EXISTS. It does not
  // derive one: the elapsed-window rule needs a window policy and is not here.
  no_response: {
    kind: 'conditional',
    to: 'nurture',
    origin: 'derived',
    rationale: 'an unanswered attempt on a prospect with no witnessed engagement implies nurture (PI-ADR-004 §4.1)',
  },

  // `unsubscribed` -> `closed_disqualified`. The prose names this cause
  // directly: "a close can be caused by `unsubscribed`", and it is why
  // `closed_disqualified` has no exits — a re-openable terminal would let the
  // ledger say "pursue" about someone who asked never to be contacted.
  //
  // This is a LIFECYCLE fact, not a governance one. It does not suppress
  // anybody and does not claim to: `mayContact` reads
  // `contact_governance_records` live and remains the only thing that decides
  // whether the platform may act. Closing the prospect where they stand and
  // suppressing contact are two different acts with two different owners.
  unsubscribed: {
    kind: 'transition',
    to: 'closed_disqualified',
    origin: 'derived',
    rationale: 'an unsubscribe is "never contact me again" — the prospect is closed, and the close has no exit',
  },

  // `converted` has NO STATE. The seven states are resting positions in a
  // pursuit; none of them is success. `closed_disqualified` is the only
  // terminal, and calling a won prospect disqualified would be a lie recorded
  // in an append-only ledger. `engaged` is true but strictly weaker than the
  // evidence, and would make a conversion indistinguishable from a reply.
  // Neither is a reading of the vocabulary; both are inventions. DECISION
  // REQUIRED.
  converted: {
    kind: 'needs-policy',
    decision: 'converted_has_no_state',
    alternatives: [
      'add a terminal `converted` state to the vocabulary, the graph and the DB CHECK (needs a migration)',
      'treat conversion as an event on another entity (an opportunity) and leave the prospect where it stands',
      'map it to `engaged` and accept that the ledger cannot distinguish a conversion from a reply',
    ],
    rationale: 'the prospect vocabulary has no success state; every candidate target is an invention, not a reading',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//
// THE `meeting_booked` CONTRADICTION — verified, and decided against proposing.
//
// The two halves of the repository genuinely disagree, and both are current:
//
//   • `meeting_booked` is in `UNOBSERVABLE_BUSINESS_OUTCOMES`
//     (leadOutreachExecution/types.ts) because no transport reports it and no
//     booking integration exists. `stateModel.ts:47-51` builds on that to call
//     `meeting_scheduled` "CONTRACT-ONLY and unreachable today", and
//     `PROSPECT_STATES_UNREACHABLE_TODAY` names it.
//   • `pages/api/outreach/outcomes.ts` nevertheless admits `meeting_booked` in
//     `MANUAL_OUTCOME_SIGNALS` — deliberately, as one of "the four signals a
//     human can honestly observe" — and `feedbackIngestion` accepts it as a
//     business signal. CONFIRMED: a `meeting_booked` row can exist in
//     production today, with `source: 'manual'` and an operator attached.
//
// So "unobservable" is precise but narrower than it reads: no MACHINE observes
// a booking; an operator can assert one. The contradiction is real and is
// reported, not papered over.
//
// THE DECISION TAKEN HERE: the interpreter DESCRIBES the edge and PROPOSES
// NOTHING. Reasons, in order of weight:
//
//   1. Coherence with the writer. `lifecycleWriter.validate()` now refuses any
//      state in `PROSPECT_STATES_UNREACHABLE_TODAY`. An interpreter that
//      proposed `meeting_scheduled` would emit proposals that the only writer
//      is guaranteed to reject — a worse failure than abstaining, because it
//      looks like it worked.
//   2. Whether one operator's assertion makes a contract-only state reachable
//      is a PROGRAMME decision, not an implementation detail. PI-ADR-004 §5
//      lists the whole meeting cluster as "blocked, not decided here".
//   3. Abstaining is reversible in one line; a wrong row in an append-only
//      ledger is not.
//
// Reported as DECISION REQUIRED: either (a) keep `meeting_scheduled`
// contract-only and stop admitting `meeting_booked` on the manual route, or
// (b) accept a manual assertion as sufficient, drop `meeting_scheduled` from
// `PROSPECT_STATES_UNREACHABLE_TODAY`, and let this mapping propose it with
// `origin: 'human'` and the operator attached. Both are coherent. Doing neither
// is the only incoherent option, and it is the current state.
//
// ─────────────────────────────────────────────────────────────────────────────

const isBusinessOutcomeType = (v: unknown): v is BusinessOutcomeType =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(OUTCOME_TRANSITION_MAP, v);

const isUnreachableToday = (s: ProspectState): boolean =>
  (PROSPECT_STATES_UNREACHABLE_TODAY as readonly string[]).includes(s);

/**
 * States a machine-derived silence may NOT be read against without a policy.
 *
 * Both carry a WITNESSED response — a reply, or a booking somebody asserted.
 * Whether an unanswered later attempt decays that back to nurture is the
 * elapsed-window question PI-ADR-002 §3.1(4) leaves open, so it is raised
 * rather than answered. Every other state falls through to the graph: a
 * silence legitimately moves an unjudged prospect to nurture, confirms one
 * already in nurture, and is refused outright from the terminal.
 */
const SILENCE_NEEDS_POLICY_FROM: readonly ProspectState[] = ['engaged', 'meeting_scheduled'] as const;

const abstain = (
  reason: NoTransitionReason,
  describedTarget: ProspectState | null,
  outcomeType: BusinessOutcomeType | null,
  detail: string,
): NoTransition => ({ kind: 'no-transition', reason, describedTarget, outcomeType, detail });

/**
 * Interpret one outcome against one current state.
 *
 * TOTAL, PURE and DETERMINISTIC: no I/O, no clock, no ambient time, no throw.
 * Every path returns one of the three results, including the paths that exist
 * only because the input was malformed. It is the shape the codebase's other
 * pure deciders take — `classifyProspectTransition` is the nearest neighbour,
 * and this function defers the whole question "is this edge legal" to it rather
 * than restating the graph.
 */
export function interpretOutcome(input: OutcomeInterpretationInput): OutcomeInterpretation {
  const outcome = input.outcome ?? null;

  if (!outcome) {
    return abstain('no_outcome', null, null, 'no outcome was supplied — absence abstains, it is not evidence of anything');
  }

  const type = outcome.type;
  if (!isBusinessOutcomeType(type)) {
    // The corpus already reports unrecognised stored values rather than
    // coercing them. Coercing one here would undo that at the last step.
    return abstain(
      'outcome_not_in_vocabulary',
      null,
      null,
      `'${String(type)}' is not one of the eight business outcomes — it is reported, never coerced to the nearest one`,
    );
  }

  // An outcome that cannot be cited cannot cause a transition. `sourceEventKey`
  // THROWS on an unstable identifier by design, so its input is checked first:
  // this function must stay total.
  const id = String(outcome.id ?? '').trim();
  if (!isSourceEventKey(`outcome:${id}`)) {
    return abstain(
      'evidence_not_citable',
      null,
      type,
      'the outcome has no stable outreach_outcomes.id, so no transition could cite it (PI-ADR-002 §4)',
    );
  }

  const disposition = OUTCOME_TRANSITION_MAP[type];

  if (disposition.kind === 'not-lifecycle-bearing') {
    return abstain('not_lifecycle_bearing', null, type, disposition.rationale);
  }

  if (disposition.kind === 'unreachable') {
    return abstain('target_state_unreachable', disposition.describes, type, disposition.rationale);
  }

  if (disposition.kind === 'needs-policy') {
    return {
      kind: 'needs-policy',
      decision: disposition.decision,
      outcomeType: type,
      describedTarget: null,
      alternatives: disposition.alternatives,
      detail: disposition.rationale,
    };
  }

  const from = input.currentState ?? null;

  // No ledger means no transition to propose. Opening the ledger is the one
  // write with no decision in it and `ensureProspectLifecycleOpen` owns it;
  // letting an outcome write the FIRST row would make the outcome the
  // initialiser and skip `identified` entirely. Open it, then re-interpret.
  if (from === null) {
    return abstain(
      'lifecycle_not_open',
      disposition.to,
      type,
      'this prospect has no lifecycle ledger — call ensureProspectLifecycleOpen first, then re-interpret',
    );
  }
  if (!isProspectState(from)) {
    // A stored value outside the vocabulary is corrupt, not absent. Same rule
    // as `classifyProspectTransition`, applied before the graph is consulted.
    return abstain(
      'edge_not_permitted',
      disposition.to,
      type,
      `'${String(from)}' is not a prospect lifecycle state — the current state is corrupt, not absent`,
    );
  }

  // ── the one conditional reading: a derived silence ──
  if (disposition.kind === 'conditional') {
    if (from === 'not_interested') {
      // Silence after a rejection is not news. Proposing `nurture` here would
      // let a derived fact quietly reopen an operator's judgement.
      return abstain(
        'human_judgement_not_overturned',
        disposition.to,
        type,
        'an unanswered attempt tells us nothing new about a prospect an operator already marked not interested',
      );
    }
    if (SILENCE_NEEDS_POLICY_FROM.includes(from)) {
      // DECISION REQUIRED — and explicitly not guessed.
      return {
        kind: 'needs-policy',
        decision: 'silence_after_engagement',
        outcomeType: type,
        describedTarget: null,
        alternatives: [
          `never demote: witnessed engagement holds and '${from}' ignores a no-response`,
          'demote after a ratified threshold of consecutive unanswered attempts within a window (needs POLICY-3)',
          'demote on the first unanswered attempt, accepting that one silence erases a witnessed reply',
        ],
        detail:
          `the prospect is '${from}', which carries a witnessed response; whether a derived silence decays that `
          + 'back to nurture needs the elapsed-window policy, which is undecided',
      };
    }
  }

  // ── the graph has the last word ──
  //
  // The mapping says WHICH state an outcome names. Whether that state is
  // reachable from here is `classifyProspectTransition`'s answer and is not
  // re-litigated: one graph, one implementation.
  const verdict = classifyProspectTransition(from, disposition.to);

  if (verdict.kind === 'unchanged') {
    // The writer treats this as a legal reassessment, not an error. The
    // interpreter reports it as a no-transition because no transition is what
    // it is; whether to append a "reassessed, unchanged" row is the writer's
    // debounce decision, not a reading of the outcome.
    return abstain(
      'already_in_target_state',
      disposition.to,
      type,
      `the prospect is already '${disposition.to}' — this outcome confirms the position rather than changing it`,
    );
  }

  if (verdict.kind === 'illegal') {
    return abstain('edge_not_permitted', disposition.to, type, explainProspectTransition(from, disposition.to));
  }

  if (verdict.kind !== 'move') {
    // `initial` is unreachable: `from === null` returned above. Reported rather
    // than assumed away, because an assumption here would silently propose an
    // initial row caused by an outcome.
    return abstain(
      'lifecycle_not_open',
      disposition.to,
      type,
      'the classifier reports no prior state, so there is no transition to propose',
    );
  }

  // A last structural guard. `ProspectState` cannot express a computed verdict,
  // so `suppressed` / `outreach-ready` / `no-response` are already impossible
  // here; an unreachable-today state is NOT, so it is refused rather than
  // trusted to the map staying correct.
  if (isUnreachableToday(verdict.to)) {
    return abstain(
      'target_state_unreachable',
      verdict.to,
      type,
      `'${verdict.to}' is in PROSPECT_STATES_UNREACHABLE_TODAY and the writer refuses it`,
    );
  }

  return {
    kind: 'transition',
    from: verdict.from,
    to: verdict.to,
    origin: disposition.origin,
    evidence: { kind: 'outreach_outcome', outcomeId: id },
    sourceEventKey: sourceEventKey('outcome', id),
    outcomeType: type,
    reasoning: disposition.rationale,
    modelVersion: OUTCOME_INTERPRETER_VERSION,
  };
}
