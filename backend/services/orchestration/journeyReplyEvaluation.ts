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
 *
 * LIVE NOW, because it is not classifier output: a person decided, and the decision is
 * recorded with that person as its actor, through the decision mechanism that already
 * exists for a person's decisions (`recordPersonDecision`, `actor:<user id>` first). No new
 * table and no new decision kind:
 *   continue → `waiting`  outcome `reply_evaluated:continue:<fingerprint>`
 *   retime   → `deferred` outcome `reply_evaluated:retime:<fingerprint>`
 *   end      → `exited`   outcome `cancelled_by_person` (the progression route's own word)
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

export const REPLY_EVALUATION_ACTIONS = ['continue', 'retime', 'end'] as const;
export type ReplyEvaluationAction = typeof REPLY_EVALUATION_ACTIONS[number];

/** The outcome prefix of a recorded evaluation: `reply_evaluated:<action>:<fingerprint>`. */
export const REPLY_EVALUATED = 'reply_evaluated';

export type ReplyEvaluationRefusal =
  | 'invalid_action' | 'actor_required' | 'return_date_required' | 'return_date_not_allowed'
  | 'not_awaiting_evaluation' | ResumeRefusal;

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
    cancelledSteps = await exitJourney(input.organizationId, input.executionInstanceId);
    instance = await getExecutionInstance(input.organizationId, input.executionInstanceId);
  }

  const reasons = [`evaluation:${act}`, `reply:${pending.replyKey}`, ...(notBefore === null ? [] : [`return_floor=${notBefore}`])];
  const auditFailed = await recordPersonDecision(input.organizationId, actor, act === 'end'
    ? { executionInstanceId: input.executionInstanceId, planStepId: null, stepKey: null, channel: null, engine: null, decision: 'exited', outcome: 'cancelled_by_person', reasons }
    : {
      executionInstanceId: input.executionInstanceId, planStepId: pending.planStepId, stepKey: pending.stepKey, channel: pending.channel, engine: null,
      decision: act === 'continue' ? 'waiting' : 'deferred', outcome: `${REPLY_EVALUATED}:${act}:${pending.replyKey}`, reasons,
    });
  return { ok: true, action: act, instance, notBefore, cancelledSteps, auditFailed };
}
