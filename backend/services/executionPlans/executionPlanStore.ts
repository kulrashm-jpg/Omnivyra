/**
 * PI-036 — the Execution Plan store.
 *
 * The ONE writer of `execution_plans`, `execution_plan_steps` and
 * `execution_tasks`. Creation goes through the atomic `create_execution_plan`
 * function; everything else here is a read or a single state move.
 *
 * ─── THE PINNED VERSION IS AUTHORITATIVE (J-1) ────────────────────────────
 * `createExecutionPlan` takes a tenant and an INSTANCE. There is deliberately no
 * version parameter and no workflow parameter: the pinned `workflow_version_id`
 * is read off the instance inside the function, so nothing in this process can
 * re-point a historical run at a later publication. The persona planner is not
 * consulted — `PERSONA_PLAYBOOKS` is not a workflow definition.
 *
 * ─── WHY CREATION IS A SEPARATE TRANSITION, NOT PART OF INVOCATION ────────
 * Forced by evidence rather than chosen: 033's `create_execution_instance` is a
 * frozen certified artefact, so planning synchronously with invocation would mean
 * editing it. Invocation records that a run was asked for; planning materializes
 * what that run will do.
 *
 * ─── PREPARING A TASK IS NOT PERMISSION TO SEND ───────────────────────────
 * Nothing here schedules, dispatches, contacts a provider, creates an attempt or
 * an outcome, or touches `mayContact`. `requires_approval` is a REQUIREMENT
 * carried forward, never a grant; the governance chain
 * `kill_switch → suppression → region → approval → rate_limit → transport`
 * still runs in Outreach, untouched.
 *
 * ─── MESSAGE IDENTITY IS DEFERRED (J-5) ───────────────────────────────────
 * A step's `instruction` is authoring text — personalization INSTRUCTIONS, never
 * data — and a task's `action` carries it forward. Neither is a message and
 * neither claims a durable message or template identity. Nothing in this module
 * references `gtm_messages`.
 */
import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';

const PLANS_TABLE = 'execution_plans';
const STEPS_TABLE = 'execution_plan_steps';
const TASKS_TABLE = 'execution_tasks';
const CREATE_EXECUTION_PLAN_FN = 'create_execution_plan';

export const PLAN_STATUSES = ['materializing', 'ready', 'failed'] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_STEP_STATES = [
  'pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled',
] as const;
export type PlanStepState = typeof PLAN_STEP_STATES[number];

/** A step that has settled: nothing may move it again. */
export const TERMINAL_PLAN_STEP_STATES = [
  'completed', 'failed', 'skipped', 'cancelled',
] as const;

export const TASK_STATES = ['prepared', 'cancelled', 'failed'] as const;
export type TaskState = typeof TASK_STATES[number];

export const TERMINAL_TASK_STATES = ['cancelled', 'failed'] as const;

export const isTerminalPlanStepState = (s: PlanStepState): boolean =>
  (TERMINAL_PLAN_STEP_STATES as readonly string[]).includes(s);
export const isTerminalTaskState = (s: TaskState): boolean =>
  (TERMINAL_TASK_STATES as readonly string[]).includes(s);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ExecutionPlanError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ExecutionPlanError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new ExecutionPlanError(message, code);
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
const num = (v: unknown): number =>
  typeof v === 'number' ? v : Number(v ?? 0);

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? d as Row[] : []);

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ExecutionPlan {
  readonly id: string;
  readonly organizationId: string;
  readonly executionInstanceId: string;
  /** The PINNED version this plan was built from. */
  readonly workflowVersionId: string;
  /** The frozen authored definition, so history survives archival. */
  readonly definitionSnapshot: unknown;
  readonly stepCount: number;
  readonly status: PlanStatus;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ExecutionPlanStep {
  readonly id: string;
  readonly organizationId: string;
  readonly planId: string;
  /** The authored key, stable within this plan for the life of the run. */
  readonly stepKey: string;
  readonly stepOrder: number;
  /** Authored channel INTENT — not narrowed to what is dispatchable today. */
  readonly channel: string;
  readonly instruction: string | null;
  readonly delayAfterPreviousHours: number;
  readonly state: PlanStepState;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ExecutionTask {
  readonly id: string;
  readonly organizationId: string;
  readonly executionInstanceId: string;
  readonly planStepId: string;
  readonly subjectKind: 'lead' | 'prospect';
  readonly subjectId: string;
  readonly channel: string;
  readonly action: string | null;
  readonly delayAfterPreviousHours: number;
  readonly requiresApproval: boolean;
  readonly state: TaskState;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

const PLAN_COLUMNS = 'id, organization_id, execution_instance_id, workflow_version_id, '
  + 'definition_snapshot, step_count, status, created_at, updated_at';
const STEP_COLUMNS = 'id, organization_id, plan_id, step_key, step_order, channel, '
  + 'instruction, delay_after_previous_hours, state, created_at, updated_at';
const TASK_COLUMNS = 'id, organization_id, execution_instance_id, plan_step_id, '
  + 'subject_kind, subject_id, channel, action, delay_after_previous_hours, '
  + 'requires_approval, state, created_at, updated_at';

const toPlan = (r: Row): ExecutionPlan => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  executionInstanceId: String(r.execution_instance_id),
  workflowVersionId: String(r.workflow_version_id),
  definitionSnapshot: r.definition_snapshot ?? null,
  stepCount: num(r.step_count),
  status: String(r.status) as PlanStatus,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toStep = (r: Row): ExecutionPlanStep => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  planId: String(r.plan_id),
  stepKey: String(r.step_key),
  stepOrder: num(r.step_order),
  channel: String(r.channel),
  instruction: str(r.instruction),
  delayAfterPreviousHours: num(r.delay_after_previous_hours),
  state: String(r.state) as PlanStepState,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toTask = (r: Row): ExecutionTask => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  executionInstanceId: String(r.execution_instance_id),
  planStepId: String(r.plan_step_id),
  subjectKind: String(r.subject_kind) as 'lead' | 'prospect',
  subjectId: String(r.subject_id),
  channel: String(r.channel),
  action: str(r.action),
  delayAfterPreviousHours: num(r.delay_after_previous_hours),
  requiresApproval: r.requires_approval === true,
  state: String(r.state) as TaskState,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

/** Translate a database error into this module's vocabulary. */
function translate(error: unknown, fallback: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? '');

  if (code === '23505') {
    if (message.includes('execution_plans_instance_unique')) {
      fail('that run already has a plan', 'plan_exists');
    }
    if (message.includes('execution_tasks_step_unique')) {
      fail('that plan step already has a task', 'task_exists');
    }
    fail('that execution record already exists', 'already_exists');
  }

  for (const [needle, msg, out] of [
    ['ep_create:invalid_org', 'organizationId must be a uuid', 'invalid_org'],
    ['ep_create:invalid_instance', 'executionInstanceId must be a uuid', 'invalid_instance'],
    ['ep_create:instance_not_found', 'no such execution instance in this tenant', 'instance_not_found'],
    ['ep_create:instance_terminal', 'a settled run cannot acquire a plan', 'instance_terminal'],
    ['ep_create:pinned_version_missing', 'the run pinned a version that no longer exists', 'pinned_version_missing'],
    ['ep_create:definition_has_no_steps', 'the pinned version has no steps to materialize', 'definition_has_no_steps'],
    ['ep_create:partial_materialization', 'the plan could not be fully materialized', 'partial_materialization'],
  ] as const) {
    if (message.includes(needle)) fail(msg, out);
  }

  if (message.includes('belongs to another tenant')) {
    fail('that execution instance belongs to another tenant', 'cross_tenant');
  }
  if (message.includes('are immutable')) {
    fail('that record is immutable', 'immutable');
  }
  if (message.includes('cannot be re-opened')) {
    fail('that record has already settled', 'already_settled');
  }

  fail(message || fallback, 'plan_store_error');
}

// ---------------------------------------------------------------------------
// Creation — one atomic call
// ---------------------------------------------------------------------------

/**
 * Materialize the plan for one run: plan + every step + one task per step, in a
 * single transaction.
 *
 * ATOMIC. The plan's `status` becomes `ready` only after every child exists, so
 * there is no observable state in which a plan claims readiness without its
 * steps and tasks. A failure anywhere rolls the entire structure back.
 *
 * Takes no version and no step content: both come from the instance's pinned
 * version inside the database.
 */
export async function createExecutionPlan(input: {
  organizationId: string;
  executionInstanceId: string;
}): Promise<ExecutionPlan> {
  assertTenant(input.organizationId);
  const instanceId = assertUuid(
    input.executionInstanceId, 'executionInstanceId', 'invalid_instance',
  );

  const res = await supabase.rpc(CREATE_EXECUTION_PLAN_FN, {
    p_organization_id: input.organizationId,
    p_execution_instance_id: instanceId,
  });
  if (res.error) translate(res.error, 'plan creation failed');

  const planId = typeof res.data === 'string'
    ? res.data
    : str((rows(res.data)[0] ?? {})[CREATE_EXECUTION_PLAN_FN]);
  if (planId === null) fail('plan creation returned no id', 'plan_store_error');

  const created = await getExecutionPlan(input.organizationId, planId);
  if (created === null) fail('plan creation did not persist', 'plan_store_error');
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getExecutionPlan(
  organizationId: string, planId: string,
): Promise<ExecutionPlan | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(PLANS_TABLE)
    .select(PLAN_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(planId, 'planId', 'invalid_plan'))
    .maybeSingle();
  if (res.error) translate(res.error, 'plan read failed');
  return res.data ? toPlan(res.data as unknown as Row) : null;
}

/** The plan for a run, or null. One run has at most one, by constraint. */
export async function getPlanForInstance(
  organizationId: string, executionInstanceId: string,
): Promise<ExecutionPlan | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(PLANS_TABLE)
    .select(PLAN_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('execution_instance_id',
      assertUuid(executionInstanceId, 'executionInstanceId', 'invalid_instance'))
    .maybeSingle();
  if (res.error) translate(res.error, 'plan read failed');
  return res.data ? toPlan(res.data as unknown as Row) : null;
}

export async function listPlanSteps(
  organizationId: string, planId: string,
): Promise<ExecutionPlanStep[]> {
  assertTenant(organizationId);
  const res = await ownedDbTable(STEPS_TABLE)
    .select(STEP_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('plan_id', assertUuid(planId, 'planId', 'invalid_plan'))
    .order('step_order', { ascending: true });
  if (res.error) translate(res.error, 'plan step read failed');
  return rows(res.data).map(toStep);
}

export async function listInstanceTasks(
  organizationId: string, executionInstanceId: string,
): Promise<ExecutionTask[]> {
  assertTenant(organizationId);
  const res = await ownedDbTable(TASKS_TABLE)
    .select(TASK_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('execution_instance_id',
      assertUuid(executionInstanceId, 'executionInstanceId', 'invalid_instance'))
    .order('created_at', { ascending: true });
  if (res.error) translate(res.error, 'task read failed');
  return rows(res.data).map(toTask);
}

export async function getExecutionTask(
  organizationId: string, taskId: string,
): Promise<ExecutionTask | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(TASKS_TABLE)
    .select(TASK_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(taskId, 'taskId', 'invalid_task'))
    .maybeSingle();
  if (res.error) translate(res.error, 'task read failed');
  return res.data ? toTask(res.data as unknown as Row) : null;
}

// ---------------------------------------------------------------------------
// State moves — the only mutations, and they move nothing else
// ---------------------------------------------------------------------------

/**
 * Move a plan step's state.
 *
 * The database enforces the half that matters: a settled step cannot be
 * re-opened, and the authored snapshot cannot be edited at all. Nothing finer is
 * enforced here, deliberately — no transition graph among the live states has
 * been ratified, and inventing one would decide a product question 036 was not
 * given. It advances nothing by itself: there is no scheduler.
 */
export async function setPlanStepState(input: {
  organizationId: string;
  stepId: string;
  state: PlanStepState;
}): Promise<ExecutionPlanStep | null> {
  assertTenant(input.organizationId);
  const stepId = assertUuid(input.stepId, 'stepId', 'invalid_step');
  if (!PLAN_STEP_STATES.includes(input.state)) {
    fail(`state must be one of ${PLAN_STEP_STATES.join(' | ')}`, 'invalid_state');
  }

  const res = await ownedDbTable(STEPS_TABLE)
    .update({ state: input.state })
    .eq('organization_id', input.organizationId)
    .eq('id', stepId)
    .select(STEP_COLUMNS)
    .maybeSingle();
  if (res.error) translate(res.error, 'plan step state change failed');
  return res.data ? toStep(res.data as unknown as Row) : null;
}

/**
 * Move a task's PREPARATION state.
 *
 * `prepared → cancelled | failed` only. There is no `sent`, `delivered` or
 * `dispatched` state here and there must not be: dispatch, attempts, delivery and
 * outcomes are Outreach-owned, and representing them here would blur the boundary
 * 036 exists to draw.
 */
export async function setExecutionTaskState(input: {
  organizationId: string;
  taskId: string;
  state: TaskState;
}): Promise<ExecutionTask | null> {
  assertTenant(input.organizationId);
  const taskId = assertUuid(input.taskId, 'taskId', 'invalid_task');
  if (!TASK_STATES.includes(input.state)) {
    fail(`state must be one of ${TASK_STATES.join(' | ')}`, 'invalid_state');
  }

  const res = await ownedDbTable(TASKS_TABLE)
    .update({ state: input.state })
    .eq('organization_id', input.organizationId)
    .eq('id', taskId)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (res.error) translate(res.error, 'task state change failed');
  return res.data ? toTask(res.data as unknown as Row) : null;
}

export const EXECUTION_PLANS_TABLE = PLANS_TABLE;
export const EXECUTION_PLAN_STEPS_TABLE = STEPS_TABLE;
export const EXECUTION_TASKS_TABLE = TASKS_TABLE;
export const CREATE_EXECUTION_PLAN_RPC = CREATE_EXECUTION_PLAN_FN;

/**
 * Orchestration — when this tenant last COMPLETED an action for this individual,
 * across all of their journeys, or null when never. The frequency policy's read.
 *
 * Two tenant-first reads over existing indexes: the person's execution tasks
 * (`ix_execution_tasks_subject`), then the latest `completed_at` among their plan
 * steps. A skip never counts — `completed_at` is set only on `completed`.
 * Throws on a failed read: an unknown history must not read as "never contacted".
 */
export async function lastCompletedActionAtForSubject(
  organizationId: string,
  subjectKind: 'lead' | 'prospect',
  subjectId: string,
): Promise<string | null> {
  assertTenant(organizationId);
  const sid = str(subjectId);
  if (sid === null) fail('subjectId is required', 'invalid_subject');
  const tasks = await ownedDbTable(TASKS_TABLE)
    .select('plan_step_id')
    .eq('organization_id', organizationId)
    .eq('subject_kind', subjectKind)
    .eq('subject_id', sid)
    .limit(1000);
  if (tasks.error) translate(tasks.error, 'subject task read failed');
  const stepIds = rows(tasks.data).map((r) => String(r.plan_step_id));
  if (stepIds.length === 0) return null;
  const steps = await ownedDbTable(STEPS_TABLE)
    .select('completed_at')
    .eq('organization_id', organizationId)
    .in('id', stepIds)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  if (steps.error) translate(steps.error, 'subject step read failed');
  const found = rows(steps.data);
  return found.length ? str(found[0].completed_at) : null;
}
