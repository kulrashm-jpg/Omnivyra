/**
 * PI-037 — the Workflow execution engine's progression surface.
 *
 * Three operations, and all three only move state:
 *
 *   advanceExecutionRun     make whatever is now eligible `ready`
 *   transitionPlanStep      record an outcome a caller asserts
 *   cancelExecutionRun      cancel the Workflow-side records of a run
 *
 * It creates nothing. 036 materialized every step and task up front, so there is
 * nothing left to create — which is also why running an advance twice cannot
 * duplicate anything.
 *
 * ─── READINESS IS NOT PERMISSION, AND NOT DELIVERY ────────────────────────
 * A `ready` step means "this is the next thing due". It is not permission to
 * contact anyone: `mayContact` and the chain
 * `kill_switch → suppression → region → approval → rate_limit → transport`
 * remain authoritative and are untouched here. A step may be ready while Outreach
 * later refuses to send, and that is the expected shape, not a conflict.
 *
 * Nothing in this module calls a provider, a transport, an adapter or a queue, and
 * nothing marks a task sent, delivered or failed-at-provider.
 *
 * ─── COMPLETION IS ALWAYS CALLER-ASSERTED ─────────────────────────────────
 * This engine never infers that a step completed. 036 prepares every task when the
 * plan is materialized, so treating materialization as completion would fabricate
 * success for work that never ran. `transitionPlanStep` records what an executing
 * layer reports; the engine decides only what is eligible and what follows what.
 *
 * ─── WHY THERE IS NO WORKER HERE ──────────────────────────────────────────
 * `advanceExecutionRun` is a poll, not a daemon. It is idempotent and converges,
 * so a caller may run it on any cadence. 037 adds no background process: one would
 * be new infrastructure, and the readiness decision is fully determined by state.
 */
import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';

const STEPS_TABLE = 'execution_plan_steps';
const ADVANCE_FN = 'advance_execution_plan';
const CANCEL_FN = 'cancel_execution_run';

/** The states a step may hold, as 036 ratified them. 037 adds none. */
export const STEP_STATES = [
  'pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled',
] as const;
export type StepState = typeof STEP_STATES[number];

/** Settled: the step will not move again. */
export const SETTLED_STEP_STATES = ['completed', 'failed', 'skipped', 'cancelled'] as const;

/**
 * The states that ADVANCE the linear chain, and therefore anchor the next step's
 * relative delay. `skipped` is here by owner ratification: a skip is a deliberate
 * decision that the run should continue without this step's work. It still never
 * reads as success — the state stays `skipped` and `completed_at` stays null.
 */
export const ADVANCING_STEP_STATES = ['completed', 'skipped'] as const;

/** The states that STOP the chain. Nothing continues past one of these. */
export const BLOCKING_STEP_STATES = ['failed', 'cancelled'] as const;

/**
 * The transition graph, enforced authoritatively by the database trigger and
 * mirrored here so a caller gets a clear refusal before the wire.
 *
 * `ready → completed` is permitted without passing through `running`, because
 * `running` is an optional observation: an executing layer that never reports a
 * start should still be able to report an outcome.
 */
export const STEP_TRANSITIONS: Readonly<Record<StepState, readonly StepState[]>> = {
  pending: ['ready', 'skipped', 'cancelled'],
  ready: ['running', 'completed', 'skipped', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export const isSettledStepState = (s: StepState): boolean =>
  (SETTLED_STEP_STATES as readonly string[]).includes(s);
export const advancesChain = (s: StepState): boolean =>
  (ADVANCING_STEP_STATES as readonly string[]).includes(s);
export const canTransition = (from: StepState, to: StepState): boolean =>
  (STEP_TRANSITIONS[from] as readonly string[]).includes(to);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StepProgressionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'StepProgressionError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new StepProgressionError(message, code);
}

function assertTenant(organizationId: string): void {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    fail('organizationId must be a uuid', 'invalid_org');
  }
}

function assertUuid(value: string, label: string, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${label} must be a uuid`, code);
  return value;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? d as Row[] : []);

export interface ProgressionStep {
  readonly id: string;
  readonly organizationId: string;
  readonly planId: string;
  readonly stepKey: string;
  readonly stepOrder: number;
  readonly channel: string;
  readonly delayAfterPreviousHours: number;
  readonly state: StepState;
  readonly readyAt: string | null;
  readonly startedAt: string | null;
  /** When the step settled, in ANY settled state. The progression anchor. */
  readonly settledAt: string | null;
  /** Set ONLY on `completed`. Never set by a skip. */
  readonly completedAt: string | null;
}

const STEP_COLUMNS = 'id, organization_id, plan_id, step_key, step_order, channel, '
  + 'delay_after_previous_hours, state, ready_at, started_at, settled_at, completed_at';

const toStep = (r: Row): ProgressionStep => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  planId: String(r.plan_id),
  stepKey: String(r.step_key),
  stepOrder: num(r.step_order),
  channel: String(r.channel),
  delayAfterPreviousHours: num(r.delay_after_previous_hours),
  state: String(r.state) as StepState,
  readyAt: str(r.ready_at),
  startedAt: str(r.started_at),
  settledAt: str(r.settled_at),
  completedAt: str(r.completed_at),
});

function translate(error: unknown, fallback: string): never {
  const message = String((error as { message?: string } | null)?.message ?? '');

  for (const [needle, msg, code] of [
    ['ea_advance:invalid_input', 'organizationId and executionInstanceId are required', 'invalid_input'],
    ['ea_advance:instance_not_found', 'no such execution instance in this tenant', 'instance_not_found'],
    ['ea_advance:no_plan', 'that run has no plan to advance', 'no_plan'],
    ['ea_advance:plan_not_ready', 'that run\'s plan is not ready', 'plan_not_ready'],
    ['ea_cancel:instance_not_found', 'no such execution instance in this tenant', 'instance_not_found'],
    ['ea_cancel:instance_terminal', 'that run has already finished', 'instance_terminal'],
  ] as const) {
    if (message.includes(needle)) fail(msg, code);
  }

  if (message.includes('has no execution meaning')) {
    fail('that step transition is not allowed', 'invalid_transition');
  }
  if (message.includes('cannot be re-opened')) {
    fail('that step has already settled', 'already_settled');
  }
  if (message.includes('is immutable') || message.includes('write-once')) {
    fail('that step record is immutable', 'immutable');
  }
  fail(message || fallback, 'progression_error');
}

// ---------------------------------------------------------------------------
// Advancement
// ---------------------------------------------------------------------------

/**
 * Make whatever is now eligible `ready`, and move the run's lifecycle if the step
 * states imply it.
 *
 * IDEMPOTENT. The readiness write is conditional on the step still being
 * `pending`, and the run row is locked for the duration, so two concurrent callers
 * cannot both make the same step ready and cannot advance past each other. Calling
 * it when nothing is due returns 0 and changes nothing.
 *
 * A PAUSED or terminal run returns 0 rather than raising: an advance is a poll.
 *
 * Returns how many steps became ready — at most one, since a linear chain has a
 * single frontier and the next step's anchor cannot exist until this one settles.
 */
export async function advanceExecutionRun(input: {
  organizationId: string;
  executionInstanceId: string;
}): Promise<number> {
  assertTenant(input.organizationId);
  const instanceId = assertUuid(
    input.executionInstanceId, 'executionInstanceId', 'invalid_instance',
  );

  const res = await supabase.rpc(ADVANCE_FN, {
    p_organization_id: input.organizationId,
    p_execution_instance_id: instanceId,
  });
  if (res.error) translate(res.error, 'advancement failed');

  if (typeof res.data === 'number') return res.data;
  const first = rows(res.data)[0] ?? {};
  return num(first[ADVANCE_FN]);
}

/**
 * Cancel the Workflow-side records of a run: every live step and prepared task
 * becomes `cancelled`, and the run itself does too.
 *
 * Workflow-side ONLY. No provider is told, no in-flight delivery is recalled and
 * no Outreach attempt is touched — those are Outreach's to own. A cancelled task
 * is never readable as a completed step: the states are disjoint.
 *
 * Returns how many steps were cancelled.
 */
export async function cancelExecutionRun(input: {
  organizationId: string;
  executionInstanceId: string;
}): Promise<number> {
  assertTenant(input.organizationId);
  const instanceId = assertUuid(
    input.executionInstanceId, 'executionInstanceId', 'invalid_instance',
  );

  const res = await supabase.rpc(CANCEL_FN, {
    p_organization_id: input.organizationId,
    p_execution_instance_id: instanceId,
  });
  if (res.error) translate(res.error, 'cancellation failed');

  if (typeof res.data === 'number') return res.data;
  const first = rows(res.data)[0] ?? {};
  return num(first[CANCEL_FN]);
}

// ---------------------------------------------------------------------------
// Caller-asserted outcomes
// ---------------------------------------------------------------------------

/**
 * Record a transition a caller asserts.
 *
 * The graph is checked here for a clear refusal and enforced in the database
 * regardless, so a caller that bypasses this store still cannot write a transition
 * that has no execution meaning. The timestamps are set by the database trigger,
 * never by the caller — a caller-supplied settle time could forge an anchor and
 * retime every later step.
 *
 * This records an outcome; it does not produce one. Nothing here executes work.
 */
export async function transitionPlanStep(input: {
  organizationId: string;
  stepId: string;
  state: StepState;
}): Promise<ProgressionStep | null> {
  assertTenant(input.organizationId);
  const stepId = assertUuid(input.stepId, 'stepId', 'invalid_step');
  if (!STEP_STATES.includes(input.state)) {
    fail(`state must be one of ${STEP_STATES.join(' | ')}`, 'invalid_state');
  }

  const current = await getProgressionStep(input.organizationId, stepId);
  if (current === null) return null;
  if (current.state === input.state) return current;        // idempotent no-op
  if (isSettledStepState(current.state)) {
    fail(
      `step is ${current.state} and settled — a settled step cannot be re-opened`,
      'already_settled',
    );
  }
  if (!canTransition(current.state, input.state)) {
    fail(
      `a step cannot move from ${current.state} to ${input.state}`,
      'invalid_transition',
    );
  }

  const res = await ownedDbTable(STEPS_TABLE)
    .update({ state: input.state })
    .eq('organization_id', input.organizationId)
    .eq('id', stepId)
    // CONDITIONAL on the state we decided from, so a concurrent transition cannot
    // be overwritten by this one: the loser updates nothing and sees null.
    .eq('state', current.state)
    .select(STEP_COLUMNS)
    .maybeSingle();
  if (res.error) translate(res.error, 'step transition failed');
  return res.data ? toStep(res.data as unknown as Row) : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getProgressionStep(
  organizationId: string, stepId: string,
): Promise<ProgressionStep | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(STEPS_TABLE)
    .select(STEP_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(stepId, 'stepId', 'invalid_step'))
    .maybeSingle();
  if (res.error) translate(res.error, 'step read failed');
  return res.data ? toStep(res.data as unknown as Row) : null;
}

/** Every step of a plan, in authored order. */
export async function listProgressionSteps(
  organizationId: string, planId: string,
): Promise<ProgressionStep[]> {
  assertTenant(organizationId);
  const res = await ownedDbTable(STEPS_TABLE)
    .select(STEP_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('plan_id', assertUuid(planId, 'planId', 'invalid_plan'))
    .order('step_order', { ascending: true });
  if (res.error) translate(res.error, 'step read failed');
  return rows(res.data).map(toStep);
}

/**
 * The step currently `ready`, or null.
 *
 * A linear chain has at most one, which is why this is a single read rather than a
 * queue: there is no branching, so there is never a second frontier.
 */
export async function getReadyStep(
  organizationId: string, planId: string,
): Promise<ProgressionStep | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(STEPS_TABLE)
    .select(STEP_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('plan_id', assertUuid(planId, 'planId', 'invalid_plan'))
    .eq('state', 'ready')
    .order('step_order', { ascending: true })
    .limit(1);
  if (res.error) translate(res.error, 'step read failed');
  const found = rows(res.data);
  return found.length ? toStep(found[0]) : null;
}

export const EXECUTION_PLAN_STEPS_TABLE = STEPS_TABLE;
export const ADVANCE_EXECUTION_PLAN_RPC = ADVANCE_FN;
export const CANCEL_EXECUTION_RUN_RPC = CANCEL_FN;
