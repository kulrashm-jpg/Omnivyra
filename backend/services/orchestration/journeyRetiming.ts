/**
 * SC-7 Q-4 — follow-up retiming after an out-of-office or "contact me later" reply.
 *
 * ─── THE ONE WIRED PATH: A PERSON'S RESUME WITH A RETURN DATE ─────────────
 * `resumeJourneyWithReturnDate` (called only by PATCH /api/execution-instances/:id with
 * `returnDate`) is human-supplied and deterministic: a person read the reply and typed the
 * date. It goes through `decideFollowUpRetiming` and persists `not_before` (20270127000000).
 * That is allowed while SC-7 is unratified; no classifier output reaches it.
 *
 * ─── NOT WIRED (owner decision SC7-R open) ────────────────────────────────
 * The SC-7 vocabulary (sc7-draft-1) is not ratified, so NO runtime path may let a
 * classifier's `out_of_office` or `follow_up` label change a journey. The only importer is
 * the run route above, for a person's resume; nothing in the sweeper, an engine adapter or
 * a worker imports it (a guard test proves that), and it does not import the classifier.
 * Its inputs are explicit, structured values: the signal kind
 * and a return date already in structured form. It parses no free text.
 *
 * ─── THE RULES ────────────────────────────────────────────────────────────
 *   R2  out_of_office never ends a journey and never produces an outcome, suppression,
 *       unsubscribe, complaint or channel switch: every decision carries `effects` with
 *       all of those false/null.
 *   R3  with a reliable return date, the follow-up becomes eligible at the FIRST permitted
 *       moment at or after (return date + configured delay), never before `now`, and only
 *       inside the journey's configured execution window (its weekdays and hours, in the
 *       person's zone when valid, else the window's zone, exactly as the sweeper's own
 *       `isWithinExecutionWindow` judges it). A date-only return date is midnight in the
 *       person's zone, else the window's, else the tenant's (`company_scheduler_prefs`).
 *   R4  no date, an ambiguous one, an implausible one, or no zone to read a date in →
 *       `hold_for_human`. A date is never invented and automated follow-up never continues.
 *   R5  follow_up retimes the same way and records `replied` (`effects.outcome`).
 *   R6  a paused run, a refusing control (kill switch, tenant disabled, channel off), a
 *       finished run or a settled step wins: `no_change`, nothing retimed.
 *   R7  idempotent: one scheduled action per step (`actionKey`), whatever the number of
 *       signals or evaluations. The same signal again is `duplicate_signal` with the
 *       prior time; an older signal never displaces a newer one.
 *   R8  out of order: a recorded positive reply, unsubscribe, complaint, rejection,
 *       booking or conversion from any OTHER source keeps its own consequence, and the
 *       out-of-office cannot override it (`superseded_by_consequence`).
 *
 * R1 (every inbound reply suspends the next automated follow-up until evaluated) is the
 * sweeper's, not this module's: since Prompt 4 an unclassified reply PAUSES the run with a
 * `needs_human` decision before any engine is asked (journeyResponses.assessJourneyResponse,
 * sweeper step 3), and a person resumes or ends it through the run route. A resume with a
 * return date uses this engine and persists the result as `not_before` (20270127000000).
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { getExecutionInstance, setExecutionInstanceState, TERMINAL_LIFECYCLE_STATES, type ExecutionInstance } from '../executionInstances/executionInstanceStore';
import { getPlanForInstance } from '../executionPlans/executionPlanStore';
import { deferStepUntil, listProgressionSteps } from '../workflowExecution/stepProgressionStore';
import { loadIndividualFacts } from './individualIntelligence';
import { channelRefusal } from './journeyGovernance';
import { durableJourneyResponsePort, type JourneyResponsePort } from './journeyResponses';
import { isWithinExecutionWindow, type JourneyExecutionWindow } from './journeyPolicy';

export const RETIMING_VERSION = 'q4.retiming.v1';

/** The two signal kinds this engine answers. Supplied by a caller; never read from a classifier here. */
export type RetimingSignalKind = 'out_of_office' | 'follow_up';

/** A return date in STRUCTURED form only. Free text is the caller's problem, and not solved here. */
export type ReturnDate =
  | { readonly kind: 'date'; readonly date: string }
  | { readonly kind: 'instant'; readonly at: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' };

export interface RetimingSignal {
  /** The inbound message's stable identity (e.g. `engagement_messages.platform_message_id`). */
  readonly signalId: string;
  readonly kind: RetimingSignalKind;
  readonly receivedAt: string;
  readonly returnDate: ReturnDate;
}

/** A consequence already recorded in its own store. `sourceId` names the message that produced it, when known. */
export interface RecordedConsequence {
  readonly outcome: string;
  readonly sourceId: string | null;
}

/** The single scheduled action an earlier evaluation decided for this step, if any. */
export interface PriorRetiming {
  readonly actionKey: string;
  readonly signalId: string;
  readonly receivedAt: string;
  readonly nextEligibleAt: string;
}

export interface RetimingContext {
  readonly organizationId: string;
  readonly executionInstanceId: string;
  /** The step the next automated follow-up would be. */
  readonly planStepId: string;
  readonly runLifecycleState: string;
  readonly stepState: string;
  /** The central gate's refusal for the step's channel (kill switch etc.), or null. */
  readonly controlRefusal: string | null;
  readonly consequences: readonly RecordedConsequence[];
  readonly prior: PriorRetiming | null;
}

export interface RetimingPolicy {
  /** Hours after the return date before the follow-up may act. */
  readonly delayHours: number;
  readonly window: JourneyExecutionWindow | null;
  readonly personTimezone: string | null;
  readonly tenantTimezone: string | null;
}

/** What the decision does to the journey besides timing. Out-of-office: always nothing. */
export interface RetimingEffects {
  readonly outcome: 'replied' | null;
  readonly endsJourney: false;
  readonly suppression: false;
  readonly unsubscribe: false;
  readonly complaint: false;
  readonly channelSwitch: false;
}

export type HoldReason =
  | 'return_date_missing' | 'return_date_ambiguous' | 'return_date_implausible'
  | 'return_date_zone_unknown' | 'no_permitted_moment' | 'invalid_policy';
export type NoChangeReason =
  | 'run_finished' | 'run_paused' | 'controls_refuse' | 'step_settled'
  | 'superseded_by_consequence' | 'duplicate_signal' | 'older_than_prior';

export type RetimingDecision =
  | { readonly kind: 'retime'; readonly actionKey: string; readonly signalId: string; readonly nextEligibleAt: string; readonly effects: RetimingEffects; readonly reasons: readonly string[] }
  | { readonly kind: 'hold_for_human'; readonly actionKey: string; readonly signalId: string; readonly reason: HoldReason; readonly effects: RetimingEffects; readonly reasons: readonly string[] }
  | { readonly kind: 'no_change'; readonly actionKey: string; readonly signalId: string; readonly reason: NoChangeReason; readonly nextEligibleAt: string | null; readonly effects: RetimingEffects; readonly reasons: readonly string[] };

/** Consequences that are the person's own answer, and outrank any retiming. */
export const SUPERSEDING_OUTCOMES = ['replied', 'meeting_booked', 'converted', 'rejected', 'unsubscribed', 'complained'] as const;

const HOUR_MS = 3_600_000;
const QUARTER_MS = 15 * 60_000;
/** How far ahead a permitted moment is searched: two weeks covers any weekly window. */
const WINDOW_SEARCH_MS = 14 * 24 * HOUR_MS;
/** A return more than a year away is not a reliable date for a follow-up. */
const MAX_RETURN_AHEAD_MS = 366 * 24 * HOUR_MS;
const MAX_DELAY_HOURS = 24 * 90;

const NO_EFFECTS: RetimingEffects = { outcome: null, endsJourney: false, suppression: false, unsubscribe: false, complaint: false, channelSwitch: false };
const effectsFor = (kind: RetimingSignalKind, acted: boolean): RetimingEffects =>
  (kind === 'follow_up' && acted ? { ...NO_EFFECTS, outcome: 'replied' } : NO_EFFECTS);

/** One scheduled action per step, ever: the key does not depend on the signal. */
export function retimingActionKey(organizationId: string, executionInstanceId: string, planStepId: string): string {
  return createHash('sha256').update(JSON.stringify([RETIMING_VERSION, organizationId, executionInstanceId, planStepId])).digest('hex').slice(0, 32);
}

const isValidZone = (tz: string | null | undefined): tz is string => {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** The zone's offset from UTC at instant `t`, in ms (wall clock minus UTC). */
function zoneOffsetMs(zone: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(t / 1000) * 1000;
}

/** Midnight of a calendar date in `zone` (or the first moment of that day where midnight does not exist). */
export function zonedMidnight(date: string, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const guess = Date.UTC(y, mo - 1, d);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let t = guess - zoneOffsetMs(zone, guess);
  const second = guess - zoneOffsetMs(zone, t);
  if (second !== t) t = second;
  return t;
}

/** An instant must carry its own offset; a bare local time is ambiguous. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The first moment at or after `fromMs` the window permits, judged exactly as the sweeper
 * judges it. Every real UTC offset is a multiple of 15 minutes, so a window's local hour
 * boundary always falls on a UTC quarter-hour, and the quarter-hour grid finds it exactly.
 */
export function firstPermittedMoment(fromMs: number, window: JourneyExecutionWindow | null, personTimezone: string | null): number | null {
  if (window === null) return fromMs;
  const iso = (t: number) => new Date(t).toISOString();
  if (isWithinExecutionWindow(window, iso(fromMs), personTimezone)) return fromMs;
  for (let t = Math.ceil(fromMs / QUARTER_MS) * QUARTER_MS; t <= fromMs + WINDOW_SEARCH_MS; t += QUARTER_MS) {
    if (isWithinExecutionWindow(window, iso(t), personTimezone)) return t;
  }
  return null;
}

/**
 * The deterministic consequence of one out-of-office / follow-up signal for the next
 * automated follow-up of a journey step. Pure: reads nothing, writes nothing, and the same
 * inputs always give the same decision.
 */
export function decideFollowUpRetiming(
  signal: RetimingSignal, context: RetimingContext, policy: RetimingPolicy, now: string,
): RetimingDecision {
  const actionKey = retimingActionKey(context.organizationId, context.executionInstanceId, context.planStepId);
  const base = { actionKey, signalId: signal.signalId };
  const unchanged = (reason: NoChangeReason, why: string, nextEligibleAt: string | null = null): RetimingDecision =>
    ({ kind: 'no_change', ...base, reason, nextEligibleAt, effects: NO_EFFECTS, reasons: [why] });
  const hold = (reason: HoldReason, why: string): RetimingDecision =>
    ({ kind: 'hold_for_human', ...base, reason, effects: effectsFor(signal.kind, true), reasons: [why] });

  // R6 — a finished run, a paused one, a refusing control, a settled step: nothing moves.
  if ((TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(context.runLifecycleState)) {
    return unchanged('run_finished', `the run is ${context.runLifecycleState}`);
  }
  if (context.runLifecycleState === 'paused') return unchanged('run_paused', 'the run is paused; a pause is not retimed');
  if (context.controlRefusal !== null) return unchanged('controls_refuse', `the channel is not available: ${context.controlRefusal}`);
  if (context.stepState !== 'pending' && context.stepState !== 'ready') {
    return unchanged('step_settled', `the step is ${context.stepState}`);
  }

  // R8 — the person's own answer from another message keeps its consequence.
  const other = context.consequences.find((c) =>
    (SUPERSEDING_OUTCOMES as readonly string[]).includes(c.outcome) && c.sourceId !== signal.signalId);
  if (other !== undefined) {
    return unchanged('superseded_by_consequence', `a recorded ${other.outcome} keeps its own consequence`);
  }

  // R7 — one action per step: the same signal again, or an older one, changes nothing.
  const prior = context.prior;
  if (prior !== null && prior.actionKey === actionKey) {
    if (prior.signalId === signal.signalId) return unchanged('duplicate_signal', 'this signal was already applied', prior.nextEligibleAt);
    const priorMs = Date.parse(prior.receivedAt);
    const thisMs = Date.parse(signal.receivedAt);
    if (!Number.isFinite(thisMs) || (Number.isFinite(priorMs) && thisMs < priorMs)) {
      return unchanged('older_than_prior', 'a newer signal already decided this step', prior.nextEligibleAt);
    }
  }

  const nowMs = Date.parse(now);
  const delay = policy.delayHours;
  if (!Number.isFinite(nowMs) || typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_HOURS) {
    return hold('invalid_policy', 'the evaluation instant or the configured delay is not usable');
  }

  // R3 / R4 — only a reliable, structured return date retimes.
  const rd = signal.returnDate;
  if (rd.kind === 'none') return hold('return_date_missing', 'no return date was given; a person decides when to follow up');
  if (rd.kind === 'ambiguous') return hold('return_date_ambiguous', 'the return date is ambiguous; a date is never invented');
  let returnMs: number | null;
  if (rd.kind === 'instant') {
    returnMs = typeof rd.at === 'string' && INSTANT.test(rd.at) ? Date.parse(rd.at) : null;
    if (returnMs === null || !Number.isFinite(returnMs)) return hold('return_date_ambiguous', 'the return instant carries no usable offset');
  } else {
    const zone = [policy.personTimezone, policy.window?.timezone ?? null, policy.tenantTimezone].find(isValidZone) ?? null;
    if (zone === null) return hold('return_date_zone_unknown', 'no timezone is known to read a calendar date in');
    returnMs = zonedMidnight(rd.date, zone);
    if (returnMs === null) return hold('return_date_ambiguous', 'the return date is not a calendar date');
  }
  if (returnMs - nowMs > MAX_RETURN_AHEAD_MS) return hold('return_date_implausible', 'the return date is more than a year away');

  const candidate = Math.max(returnMs + delay * HOUR_MS, nowMs);
  const at = firstPermittedMoment(candidate, policy.window, policy.personTimezone);
  if (at === null) return hold('no_permitted_moment', 'the execution window permits no moment in the next two weeks');
  return {
    kind: 'retime', ...base, nextEligibleAt: new Date(at).toISOString(), effects: effectsFor(signal.kind, true),
    reasons: [`${signal.kind}: return ${new Date(returnMs).toISOString()} + ${delay}h, first permitted moment`],
  };
}

// ── the read seam: the context and policy from the stores that already hold them ──

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * Read the context and policy for one step from the existing stores. READS ONLY. Throws
 * when a source cannot be read: "could not tell" is never "retime anyway". `prior` comes
 * from the caller: no store holds a scheduled retiming yet (that needs the lead's
 * migration, see the Q-4 report).
 */
export async function loadRetimingInputs(
  organizationId: string, executionInstanceId: string, planStepId: string,
  options: { personId?: string | null; prior?: PriorRetiming | null; responses?: JourneyResponsePort; personTimezone?: string | null } = {},
): Promise<{ context: RetimingContext; policy: RetimingPolicy }> {
  const instance = await getExecutionInstance(organizationId, executionInstanceId);
  if (instance === null) throw Object.assign(new Error('no such run in this tenant'), { code: 'run_not_found' });
  const plan = await getPlanForInstance(organizationId, executionInstanceId);
  if (plan === null) throw Object.assign(new Error('the run has no plan'), { code: 'plan_not_found' });
  const step = (await listProgressionSteps(organizationId, plan.id)).find((s) => s.id === planStepId);
  if (step === undefined) throw Object.assign(new Error('no such step in this run'), { code: 'step_not_found' });

  const responses = options.responses ?? durableJourneyResponsePort;
  const consequences: RecordedConsequence[] = (await responses.ws3Outcomes(organizationId, executionInstanceId))
    .map((outcome) => ({ outcome, sourceId: null }));
  // A WhatsApp reply names its message, so the signal's own message never supersedes itself.
  if (options.personId !== undefined) {
    const reply = await responses.whatsappReply(organizationId, executionInstanceId, options.personId);
    if (reply !== null) consequences.push({ outcome: reply.outcome, sourceId: reply.messageId });
  }

  const prefs = await ownedDbTable('company_scheduler_prefs').select('timezone').eq('company_id', organizationId).maybeSingle();
  if (prefs.error) throw Object.assign(new Error('the tenant timezone is unreadable'), { code: 'tenant_timezone_unreadable' });

  const snapshot = (plan.definitionSnapshot && typeof plan.definitionSnapshot === 'object' ? plan.definitionSnapshot : {}) as {
    policy?: { execution_window?: JourneyExecutionWindow };
  };
  return {
    context: {
      organizationId, executionInstanceId, planStepId,
      runLifecycleState: instance.lifecycleState,
      stepState: step.state,
      controlRefusal: await channelRefusal(organizationId, step.channel),
      consequences,
      prior: options.prior ?? null,
    },
    policy: {
      delayHours: step.delayAfterPreviousHours,
      window: snapshot.policy?.execution_window ?? null,
      personTimezone: options.personTimezone ?? null,
      tenantTimezone: text((prefs.data as Record<string, unknown> | null)?.timezone),
    },
  };
}

// ── The human-review fallback with a date: a person resumes a paused run ──────

export type ResumeRefusal =
  | 'run_not_found' | 'not_paused' | 'invalid_return_date' | 'return_date_in_past' | 'return_date_too_far'
  | 'no_step_to_defer' | 'held_for_review' | 'superseded';

export type ResumeOutcome =
  | { readonly ok: true; readonly instance: ExecutionInstance; readonly notBefore: string; readonly planStepId: string }
  | { readonly ok: false; readonly code: ResumeRefusal; readonly reason: string };

const YEAR_MS = 366 * 24 * HOUR_MS;

/** Server-side validation of a person's return date: structured, real, not past, within a year. */
export function validateOperatorReturnDate(raw: unknown, now: string, zone: string | null):
{ ok: true; returnDate: ReturnDate } | { ok: false; code: 'invalid_return_date' | 'return_date_in_past' | 'return_date_too_far'; reason: string } {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  const nowMs = Date.parse(now);
  let startMs: number | null = null;
  let endMs: number | null = null;
  let rd: ReturnDate | null = null;
  if (o?.kind === 'date' && typeof o.date === 'string') {
    if (!isValidZone(zone)) return { ok: false, code: 'invalid_return_date', reason: 'no timezone is known to read a calendar date in; give an instant with an offset' };
    startMs = zonedMidnight(o.date, zone);
    if (startMs === null) return { ok: false, code: 'invalid_return_date', reason: 'returnDate.date must be a real YYYY-MM-DD date' };
    endMs = startMs + 24 * HOUR_MS;
    rd = { kind: 'date', date: o.date };
  } else if (o?.kind === 'instant' && typeof o.at === 'string') {
    if (!INSTANT.test(o.at) || !Number.isFinite(Date.parse(o.at))) return { ok: false, code: 'invalid_return_date', reason: 'returnDate.at must be an ISO instant with an offset' };
    startMs = Date.parse(o.at);
    endMs = startMs;
    rd = { kind: 'instant', at: o.at };
  } else {
    return { ok: false, code: 'invalid_return_date', reason: "returnDate must be { kind: 'date', date: 'YYYY-MM-DD' } or { kind: 'instant', at: <ISO with offset> }" };
  }
  if (!Number.isFinite(nowMs) || endMs <= nowMs) return { ok: false, code: 'return_date_in_past', reason: 'the return date is in the past; the run stays paused' };
  if (startMs - nowMs > YEAR_MS) return { ok: false, code: 'return_date_too_far', reason: 'the return date is more than a year away; the run stays paused' };
  return { ok: true, returnDate: rd };
}

/**
 * A person resumes a PAUSED run with a structured return date. The date goes through
 * `decideFollowUpRetiming`; a `retime` persists `not_before` on the run's next step (the
 * ready one, else the lowest pending one) FIRST, and only then is the run made active, so
 * no sweep ever sees it active without the floor. Anything else leaves the run paused.
 * Tenant authorization is the caller's (the route's guards, unchanged).
 *
 * The reply that suspended the run is the thing the person evaluated, so a recorded
 * `replied` does not supersede their date; any other recorded answer (complaint,
 * unsubscribe, rejection, booking, conversion) does, and the run is not resumed.
 */
export async function resumeJourneyWithReturnDate(
  organizationId: string, executionInstanceId: string, rawReturnDate: unknown, now: string = new Date().toISOString(),
): Promise<ResumeOutcome> {
  const run = await getExecutionInstance(organizationId, executionInstanceId);
  if (run === null) return { ok: false, code: 'run_not_found', reason: 'no such execution instance' };
  if (run.lifecycleState !== 'paused') return { ok: false, code: 'not_paused', reason: `the run is ${run.lifecycleState}; only a paused run is resumed with a return date` };
  const plan = await getPlanForInstance(organizationId, executionInstanceId);
  const steps = plan === null ? [] : await listProgressionSteps(organizationId, plan.id);
  const step = steps.find((s) => s.state === 'ready') ?? steps.find((s) => s.state === 'pending') ?? null;
  if (step === null) return { ok: false, code: 'no_step_to_defer', reason: 'the run has no pending or ready step to defer' };

  const facts = await loadIndividualFacts(organizationId, { kind: run.subjectKind, id: run.subjectId }, now);
  const loaded = await loadRetimingInputs(organizationId, executionInstanceId, step.id, {
    personId: facts.personId, personTimezone: facts.personTimezone ?? null,
  });
  const zone = [loaded.policy.personTimezone, loaded.policy.window?.timezone ?? null, loaded.policy.tenantTimezone].find(isValidZone) ?? null;
  const valid = validateOperatorReturnDate(rawReturnDate, now, zone);
  if ('code' in valid) return { ok: false, code: valid.code, reason: valid.reason };

  const decision = decideFollowUpRetiming(
    { signalId: `operator-resume:${executionInstanceId}`, kind: 'out_of_office', receivedAt: now, returnDate: valid.returnDate },
    { ...loaded.context, runLifecycleState: 'active', consequences: loaded.context.consequences.filter((c) => c.outcome !== 'replied') },
    loaded.policy, now,
  );
  if (decision.kind === 'hold_for_human') return { ok: false, code: 'held_for_review', reason: decision.reasons[0] ?? decision.reason };
  if (decision.kind === 'no_change') {
    return { ok: false, code: decision.reason === 'superseded_by_consequence' ? 'superseded' : 'held_for_review', reason: decision.reasons[0] ?? decision.reason };
  }
  const deferred = await deferStepUntil({ organizationId, stepId: step.id, notBefore: decision.nextEligibleAt });
  if (deferred === null) return { ok: false, code: 'no_step_to_defer', reason: 'the step is gone' };
  const updated = await setExecutionInstanceState({ organizationId, instanceId: executionInstanceId, lifecycleState: 'active' });
  if (updated === null) return { ok: false, code: 'run_not_found', reason: 'no such execution instance' };
  return { ok: true, instance: updated, notBefore: deferred.notBefore ?? decision.nextEligibleAt, planStepId: step.id };
}
