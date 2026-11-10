/**
 * Prompt 5 — a PERSON evaluates the reply that paused a run.
 *
 * Since Prompt 4 an unclassified reply pauses the run with a `needs_human` decision whose
 * outcome is `reply_awaiting_evaluation:<reply fingerprint>` (journeyResponses, sweeper
 * step 3). An operator who read the reply records one of three evaluations through the
 * existing run route (PATCH /api/execution-instances/:id, `{ evaluation }`):
 *
 *   continue  the journey resumes as authored (the run moves paused → active);
 *   retime    the journey resumes after a return date the person typed, through the
 *             existing Prompt 4 retiming (`resumeJourneyWithReturnDate`, `not_before`);
 *   end       the run ends (`exitJourney`: unsent tasks withdrawn, the run cancelled).
 *   opt_out   the reply asked not to be contacted, in words no keyword detector matched
 *             ("take me off your list"). Owner decision G-11 (2026-11-07): every opt-out puts
 *             an immediate hold on ALL channels, and the tenant's own admin decides whether
 *             contact is allowed again (optOutReview.ts). In this order:
 *               1. the run's person (loadIndividualFacts); none → 409 `person_unknown`;
 *               2. their address and number (the intelligence port's readPersonContacts);
 *               3. the `*` holds through the canonical governance writer: an `unsubscribe` on
 *                  every channel and every purpose, on the person and on the CANONICAL address
 *                  and number, source `optout_review:reply_opt_out`, source ref `<run>:<reply>`;
 *               4. the company-admin review (trigger `reply_opt_out`, anchored on the person;
 *                  it locks no channel, so the admin may reopen any);
 *               5. then the run ends.
 *             A failure in 2–4 answers 503 `governance_write_failed` and the run stays paused
 *             (nothing is sent from a paused run). A hold already written stays: that is
 *             fail-safe, and the retry adopts it and joins the review.
 *
 * LIVE NOW, because it is not classifier output: a person decided, and the decision is
 * recorded with that person as its actor, through the decision mechanism that already
 * exists for a person's decisions (`recordPersonDecision`, `actor:<user id>` first). No new
 * table and no new decision kind:
 *   continue → `waiting`  outcome `reply_evaluated:continue:<fingerprint>`
 *   retime   → `deferred` outcome `reply_evaluated:retime:<fingerprint>`
 *   end      → `exited`   outcome `cancelled_by_person` (the progression route's own word)
 *   opt_out  → `exited`   outcome `unsubscribed` (the same word a restriction exit uses)
 *
 * The holds and the review are not a PI transition: the prospect's lifecycle is untouched (P-1).
 * Keeping such a person out of NEW enrolments through PI closure is PI's human-origin path.
 *
 * NOTHING REACHES PI (PI ruling P-1 = a, 2026-11-06). A human-confirmed reply is not fed to
 * the prospect lifecycle this round: routing it as `replied` would record a person's
 * judgement as an inference with no actor. This module imports no lifecycle or feedback
 * code (a test pins that).
 *
 * O2-F1 — every resume moves the run only from `paused`, a compare-and-set, so an
 * evaluation and a concurrent resume never both win; the loser is `resume_race_lost`.
 *
 * Authorization is the route's (the same guards as every PATCH, unchanged); the actor is
 * the authenticated principal, never a body field.
 */

import {
  compareAndSetExecutionInstanceState, getExecutionInstance, type ExecutionInstance,
} from '../executionInstances/executionInstanceStore';
import { listJourneyDecisions, recordPersonDecision, type RecordedJourneyDecision } from './journeyDecisionLog';
import { JOURNEY_SUSPENSION_OUTCOME_PREFIXES } from './journeyEvents';
import { exitJourney } from './journeyExit';
import { REPLY_AWAITING_EVALUATION } from './journeyResponses';
import { resumeJourneyWithReturnDate, type ResumeRefusal } from './journeyRetiming';
import { durableIntelligencePort, loadIndividualFacts } from './individualIntelligence';
import { OPT_OUT_HOLD_SOURCES, openOptOutReview, writeOptOutHolds } from './optOutReview';

export const REPLY_EVALUATION_ACTIONS = ['continue', 'retime', 'end', 'opt_out'] as const;

/** The hold source of an operator opt-out (G-11: every hold source carries the `optout_review:` prefix). */
export const REPLY_OPT_OUT_HOLD_SOURCE = OPT_OUT_HOLD_SOURCES.reply_opt_out;
export type ReplyEvaluationAction = typeof REPLY_EVALUATION_ACTIONS[number];

/** The outcome prefix of a recorded evaluation: `reply_evaluated:<action>:<fingerprint>`. */
export const REPLY_EVALUATED = 'reply_evaluated';

export type ReplyEvaluationRefusal =
  | 'invalid_action' | 'actor_required' | 'return_date_required' | 'return_date_not_allowed'
  | 'not_awaiting_evaluation' | 'person_unknown' | 'governance_write_failed' | ResumeRefusal;

export type ReplyEvaluationOutcome =
  | {
    readonly ok: true;
    readonly action: ReplyEvaluationAction;
    readonly instance: ExecutionInstance | null;
    readonly notBefore: string | null;
    readonly cancelledSteps: number | null;
    /** True when the decision could not be recorded: the evaluation stands, and the caller is told. */
    readonly auditFailed: boolean;
  }
  | { readonly ok: false; readonly code: ReplyEvaluationRefusal; readonly reason: string };

const no = (code: ReplyEvaluationRefusal, reason: string): ReplyEvaluationOutcome => ({ ok: false, code, reason });

export interface AwaitingReply {
  readonly planStepId: string | null;
  readonly stepKey: string | null;
  readonly channel: string | null;
  /** The reply's fingerprint, as its suspension decision stores it. */
  readonly replyKey: string;
}

/**
 * The reply this paused run is waiting on, from its own decisions: the LATEST suspension
 * must be a reply suspension (an approval revocation, or a pause with no suspension
 * decision, is not a reply to evaluate) and must not have been evaluated already.
 */
export function awaitingReply(decisions: readonly Pick<RecordedJourneyDecision, 'decision' | 'outcome' | 'planStepId' | 'stepKey' | 'channel'>[]): AwaitingReply | null {
  const replyPrefix = `${REPLY_AWAITING_EVALUATION}:`;
  const suspensions = decisions.filter((d) => d.decision === 'needs_human' && typeof d.outcome === 'string'
    && JOURNEY_SUSPENSION_OUTCOME_PREFIXES.some((p) => (d.outcome as string).startsWith(p)));
  const latest = suspensions[suspensions.length - 1];
  if (latest === undefined || !(latest.outcome as string).startsWith(replyPrefix)) return null;
  const replyKey = (latest.outcome as string).slice(replyPrefix.length);
  if (replyKey === '') return null;
  const done = decisions.some((d) => typeof d.outcome === 'string'
    && d.outcome.startsWith(`${REPLY_EVALUATED}:`) && d.outcome.endsWith(`:${replyKey}`));
  if (done) return null;
  return { planStepId: latest.planStepId, stepKey: latest.stepKey, channel: latest.channel, replyKey };
}

export async function evaluateSuspendedReply(input: {
  organizationId: string;
  executionInstanceId: string;
  action: unknown;
  returnDate?: unknown;
  actorUserId: unknown;
  now?: string;
}): Promise<ReplyEvaluationOutcome> {
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  if (!(REPLY_EVALUATION_ACTIONS as readonly string[]).includes(action)) {
    return no('invalid_action', `evaluation must be one of ${REPLY_EVALUATION_ACTIONS.join(' | ')}`);
  }
  const act = action as ReplyEvaluationAction;
  const actor = typeof input.actorUserId === 'string' ? input.actorUserId.trim() : '';
  if (actor === '') return no('actor_required', 'an evaluation is a person\'s decision; no authenticated actor was given');
  const hasDate = input.returnDate !== undefined && input.returnDate !== null;
  if (act === 'retime' && !hasDate) return no('return_date_required', "a retime needs returnDate: { kind: 'date', date } or { kind: 'instant', at }");
  if (act !== 'retime' && hasDate) return no('return_date_not_allowed', `a returnDate is only given with evaluation 'retime', not '${act}'`);

  const run = await getExecutionInstance(input.organizationId, input.executionInstanceId);
  if (run === null) return no('run_not_found', 'no such execution instance');
  if (run.lifecycleState !== 'paused') return no('not_paused', `the run is ${run.lifecycleState}; only a paused run's reply is evaluated`);
  const pending = awaitingReply(await listJourneyDecisions(input.organizationId, input.executionInstanceId));
  if (pending === null) return no('not_awaiting_evaluation', 'the run is paused, but not on a reply awaiting evaluation');

  let instance: ExecutionInstance | null = null;
  let notBefore: string | null = null;
  let cancelledSteps: number | null = null;
  let optOut: { holdIds: string[]; reviewId: string } | null = null;
  if (act === 'continue') {
    const moved = await compareAndSetExecutionInstanceState({
      organizationId: input.organizationId, instanceId: input.executionInstanceId, expectedState: 'paused', lifecycleState: 'active',
    });
    if (moved.applied !== true) {
      if (moved.reason === 'not_found') return no('run_not_found', 'no such execution instance');
      return no('resume_race_lost', `the run became ${moved.current?.lifecycleState ?? 'unknown'} while this evaluation was being applied; it was not moved by it`);
    }
    instance = moved.instance;
  } else if (act === 'retime') {
    const resumed = await resumeJourneyWithReturnDate(input.organizationId, input.executionInstanceId, input.returnDate, input.now);
    if (resumed.ok !== true) return no(resumed.code, resumed.reason);
    instance = resumed.instance;
    notBefore = resumed.notBefore;
  } else {
    if (act === 'opt_out') {
      // The record first: a run is never ended on an opt-out that left no restriction behind.
      const facts = await loadIndividualFacts(input.organizationId, { kind: run.subjectKind, id: run.subjectId }, input.now ?? new Date().toISOString());
      if (facts.personId === null) return no('person_unknown', 'the run\'s subject resolves to no person, so no restriction can be recorded; the run stays paused');
      const contacts = await durableIntelligencePort.readPersonContacts(input.organizationId, facts.personId).catch(() => null);
      if (contacts === null) return no('governance_write_failed', 'the person\'s address and number could not be read, so the hold cannot cover them; the run stays paused');
      const sourceRef = `${input.executionInstanceId}:${pending.replyKey}`;
      let holdIds: string[];
      try {
        holdIds = await writeOptOutHolds({
          organizationId: input.organizationId,
          personId: facts.personId,
          email: contacts.email,
          phone: contacts.phone,
          holdSource: REPLY_OPT_OUT_HOLD_SOURCE,
          sourceRef,
          evidence: { actor, reason: 'free_text_opt_out', reply: pending.replyKey, executionInstanceId: input.executionInstanceId },
        });
      } catch (e) {
        return no('governance_write_failed', `the opt-out hold could not be recorded (${(e as { code?: string } | null)?.code ?? 'error'}); the run stays paused and nothing was ended`);
      }
      try {
        const review = await openOptOutReview({
          organizationId: input.organizationId,
          anchor: { kind: 'person', personId: facts.personId },
          trigger: 'reply_opt_out',
          holdIds,
          sourceRef,
          holdSource: REPLY_OPT_OUT_HOLD_SOURCE,
          now: input.now,
        });
        optOut = { holdIds, reviewId: review.reviewId };
      } catch (e) {
        return no('governance_write_failed', `the hold is recorded, but the admin review could not be opened (${(e as { code?: string } | null)?.code ?? 'error'}); the run stays paused, and a retry adopts the hold`);
      }
    }
    cancelledSteps = await exitJourney(input.organizationId, input.executionInstanceId);
    instance = await getExecutionInstance(input.organizationId, input.executionInstanceId);
  }

  const reasons = [`evaluation:${act}`, `reply:${pending.replyKey}`, ...(notBefore === null ? [] : [`return_floor=${notBefore}`]),
    ...(optOut === null ? [] : [...optOut.holdIds.map((id) => `governance:${id}`), `optout_review:${optOut.reviewId}`])];
  const auditFailed = await recordPersonDecision(input.organizationId, actor, act === 'end' || act === 'opt_out'
    ? { executionInstanceId: input.executionInstanceId, planStepId: null, stepKey: null, channel: null, engine: null, decision: 'exited', outcome: act === 'opt_out' ? 'unsubscribed' : 'cancelled_by_person', reasons }
    : {
      executionInstanceId: input.executionInstanceId, planStepId: pending.planStepId, stepKey: pending.stepKey, channel: pending.channel, engine: null,
      decision: act === 'continue' ? 'waiting' : 'deferred', outcome: `${REPLY_EVALUATED}:${act}:${pending.replyKey}`, reasons,
    });
  return { ok: true, action: act, instance, notBefore, cancelledSteps, auditFailed };
}
