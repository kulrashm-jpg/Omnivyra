/**
 * PI-040 — the Outreach Bridge.
 *
 * The ONE writer of `outreach_bridge_handoffs`, and the only thing in this
 * repository that creates a legacy `outreach_tasks` row from the 036 execution
 * substrate.
 *
 * It is a TRANSLATION AND HANDOFF layer, not a second Outreach engine. After it
 * returns, the existing certified engine owns everything: governance, approval,
 * quota, transport, attempts, delivery evidence and outcomes. None of that is
 * reimplemented, re-derived or second-guessed here.
 *
 * ─── WHY A REAL LEGACY ROW (D4-2) ─────────────────────────────────────────
 * The existing engine is taskId-driven and database-backed:
 * `dispatchInternalOutreachTask` loads the task by id, attempts are numbered
 * against it, governance is evaluated against it, and six tables foreign key
 * `outreach_tasks(id)`. An in-memory translation reaches none of that.
 *
 * ─── WHAT THE LEGACY COLUMNS MEAN FOR A BRIDGED ROW ───────────────────────
 *   lead_id       the originating `subject_id`. `subject_kind` is NEVER encoded
 *                 there and must never be inferred from it — this mapping is the
 *                 authority. Safe because governance, suppression and quota are
 *                 all PERSON-keyed, and because `plan_task_id` alone makes the
 *                 legacy identity tuple unique.
 *   plan_task_id  the `execution_task_id`: globally unique and run-dimensioned.
 *                 Nothing is fabricated and no `task-<order>-<slug>` is minted.
 *                 It is NOT the bridge identity.
 *   person_id     the resolved canonical person. Mandatory at handoff; NULL only after the
 *                 person was erased (A6-10 option B, 20270113000000).
 *
 * ─── THE BRIDGE GRANTS NO PERMISSION ─────────────────────────────────────
 * It never calls `mayContact`, never evaluates a gate, never converts `blocked`
 * into `allowed`, and never calls a provider or a transport. An autonomy mode of
 * `autonomous` means "no per-action human approval was required by the
 * Workflow" — it does not mean this person may be contacted. The chain
 * `kill_switch → suppression → region → eligibility/approval → rate_limit →
 * transport` runs afterwards, in the existing engine, against the task created
 * here.
 */
import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';
import { resolveSubjectPersonId } from '../leadOutreachExecution/personAnchor';
import { resolveTransport, supportedChannels } from '../leadOutreachExecution/transport';
import {
  EXECUTION_RUNTIME_VERSION, TRANSLATION_VERSION, GOVERNANCE_VERSION,
} from '../leadOutreachExecution/runtimeVersion';
import { resolveStepPolicy, type WorkflowExecutionMode } from '../workflows/workflowStore';
import { getExecutionTask } from '../executionPlans/executionPlanStore';
import { getProgressionStep } from '../workflowExecution/stepProgressionStore';

const HANDOFFS_TABLE = 'outreach_bridge_handoffs';
const PLANS_TABLE = 'execution_plans';
const BRIDGE_FN = 'bridge_execution_task';

/**
 * The Workflow engine is this bridge's "planner" as far as the legacy row's
 * provenance columns are concerned. A distinct value, so a bridged row is
 * always distinguishable from one the legacy planner materialized.
 */
export const BRIDGE_PLANNER_VERSION = 'wf-bridge-1.0.0';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OutreachBridgeError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'OutreachBridgeError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new OutreachBridgeError(message, code);
}

function assertTenant(organizationId: string): void {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    fail('organizationId must be a uuid', 'invalid_org');
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? d as Row[] : []);

export interface OutreachBridgeHandoff {
  readonly id: string;
  readonly organizationId: string;
  readonly executionTaskId: string;
  readonly outreachTaskId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly executionInstanceId: string;
  readonly executionPlanId: string;
  readonly executionPlanStepId: string;
  readonly subjectKind: 'lead' | 'prospect';
  readonly subjectId: string;
  /** NULL only after the person was erased (A6-10 option B: ON DELETE SET NULL). */
  readonly personId: string | null;
  readonly executionMode: WorkflowExecutionMode;
  readonly workflowRequiresApproval: boolean;
  readonly policySource: 'authored' | 'legacy_default';
  readonly createdAt: string | null;
}

const HANDOFF_COLUMNS = 'id, organization_id, execution_task_id, outreach_task_id, '
  + 'campaign_id, workflow_id, workflow_version_id, execution_instance_id, '
  + 'execution_plan_id, execution_plan_step_id, subject_kind, subject_id, person_id, '
  + 'execution_mode, workflow_requires_approval, policy_source, created_at';

const toHandoff = (r: Row): OutreachBridgeHandoff => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  executionTaskId: String(r.execution_task_id),
  outreachTaskId: String(r.outreach_task_id),
  campaignId: String(r.campaign_id),
  workflowId: String(r.workflow_id),
  workflowVersionId: String(r.workflow_version_id),
  executionInstanceId: String(r.execution_instance_id),
  executionPlanId: String(r.execution_plan_id),
  executionPlanStepId: String(r.execution_plan_step_id),
  subjectKind: String(r.subject_kind) as 'lead' | 'prospect',
  subjectId: String(r.subject_id),
  personId: r.person_id == null ? null : String(r.person_id),
  executionMode: String(r.execution_mode) as WorkflowExecutionMode,
  workflowRequiresApproval: r.workflow_requires_approval === true,
  policySource: String(r.policy_source) as 'authored' | 'legacy_default',
  createdAt: str(r.created_at),
});

function translate(error: unknown, fallback: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? '');

  if (code === '23505') {
    if (message.includes('outreach_bridge_handoffs_task_unique')) {
      fail('that execution task has already been bridged', 'already_bridged');
    }
    if (message.includes('outreach_bridge_handoffs_legacy_unique')) {
      fail('that outreach task is already claimed by another handoff', 'legacy_claimed');
    }
    fail('that handoff already exists', 'already_exists');
  }

  for (const [needle, msg, out] of [
    ['ob_bridge:invalid_input', 'organizationId and executionTaskId are required', 'invalid_input'],
    ['ob_bridge:person_unresolved', 'the subject did not resolve to a canonical person', 'person_unresolved'],
    ['ob_bridge:invalid_policy', 'the workflow step policy is not coherent', 'invalid_policy'],
    ['ob_bridge:task_not_found', 'no such execution task in this tenant', 'task_not_found'],
    ['ob_bridge:task_not_prepared', 'that execution task is not in a preparable state', 'task_not_prepared'],
    ['ob_bridge:run_not_executable', 'that run is paused, cancelled or finished', 'run_not_executable'],
  ] as const) {
    if (message.includes(needle)) fail(msg, out);
  }

  if (message.includes('belongs to another tenant')) {
    fail('that record belongs to another tenant', 'cross_tenant');
  }
  if (message.includes('disagrees with execution task')) {
    fail('the recorded attribution does not match the execution task', 'attribution_mismatch');
  }
  if (message.includes('immutable historical record')) {
    fail('a handoff is immutable', 'immutable');
  }
  fail(message || fallback, 'bridge_error');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The handoff for an execution task, or null. At most one, by constraint. */
export async function getHandoffForTask(
  organizationId: string, executionTaskId: string,
): Promise<OutreachBridgeHandoff | null> {
  assertTenant(organizationId);
  if (!UUID.test(executionTaskId)) fail('executionTaskId must be a uuid', 'invalid_task');
  const res = await ownedDbTable(HANDOFFS_TABLE)
    .select(HANDOFF_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('execution_task_id', executionTaskId)
    .maybeSingle();
  if (res.error) translate(res.error, 'handoff read failed');
  return res.data ? toHandoff(res.data as unknown as Row) : null;
}

export async function listInstanceHandoffs(
  organizationId: string, executionInstanceId: string,
): Promise<OutreachBridgeHandoff[]> {
  assertTenant(organizationId);
  if (!UUID.test(executionInstanceId)) fail('executionInstanceId must be a uuid', 'invalid_instance');
  const res = await ownedDbTable(HANDOFFS_TABLE)
    .select(HANDOFF_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('execution_instance_id', executionInstanceId)
    .order('created_at', { ascending: true });
  if (res.error) translate(res.error, 'handoff read failed');
  return rows(res.data).map(toHandoff);
}

/**
 * The step's authorized policy, read from the PLAN SNAPSHOT.
 *
 * Deliberately NOT from `workflow_versions`: the Version may since have been
 * superseded or archived, and re-reading it could apply a policy the run was
 * never authorized with. The snapshot is the frozen definition this run was
 * built from, which is why 040-D put policy inside the definition in the first
 * place.
 *
 * Fails closed through `resolveStepPolicy` when the snapshot predates the field.
 */
export async function resolveTaskPolicy(
  organizationId: string, planId: string, stepKey: string,
): Promise<{ mode: WorkflowExecutionMode; requiresApproval: boolean; source: 'authored' | 'legacy_default' }> {
  assertTenant(organizationId);
  const res = await ownedDbTable(PLANS_TABLE)
    .select('definition_snapshot')
    .eq('organization_id', organizationId)
    .eq('id', planId)
    .maybeSingle();
  if (res.error) translate(res.error, 'plan snapshot read failed');
  if (!res.data) fail('no such plan in this tenant', 'plan_not_found');

  const snapshot = (res.data as unknown as Row).definition_snapshot as
    { steps?: unknown[] } | null;
  const steps = Array.isArray(snapshot?.steps) ? snapshot!.steps : null;
  if (steps === null) fail('the plan snapshot carries no steps', 'malformed_snapshot');

  const authored = steps.find((s) => {
    const o = (s && typeof s === 'object' ? s : null) as Record<string, unknown> | null;
    return o !== null && str(o.key) === stepKey;
  });
  if (authored === undefined) {
    fail(`the plan snapshot has no step "${stepKey}"`, 'malformed_snapshot');
  }
  return resolveStepPolicy(authored);
}

// ---------------------------------------------------------------------------
// The handoff
// ---------------------------------------------------------------------------

/**
 * Hand one prepared execution task to the existing Outreach engine.
 *
 * IDEMPOTENT. A second call for the same execution task returns the FIRST
 * handoff and creates nothing: the database refuses a duplicate on
 * `outreach_bridge_handoffs_task_unique`, and that refusal — not a pre-check — is
 * what makes it safe. Two concurrent callers therefore produce one legacy task,
 * with the loser reading the winner's row.
 *
 * ATOMIC. The legacy task and the mapping are written by one function in one
 * transaction, so a mapping without its task is unreachable and a retry cannot
 * create a second task.
 *
 * It dispatches nothing and contacts nobody.
 */
export async function bridgeExecutionTask(input: {
  organizationId: string;
  executionTaskId: string;
}): Promise<{ handoff: OutreachBridgeHandoff; replayed: boolean }> {
  assertTenant(input.organizationId);
  if (typeof input.executionTaskId !== 'string' || !UUID.test(input.executionTaskId)) {
    fail('executionTaskId must be a uuid', 'invalid_task');
  }

  // Replay check FIRST, so a retry is cheap and returns the original handoff.
  // This is NOT the uniqueness guarantee — the constraint below is. Losing a
  // race here simply means the insert refuses and we re-read.
  const existing = await getHandoffForTask(input.organizationId, input.executionTaskId);
  if (existing !== null) return { handoff: existing, replayed: true };

  const task = await getExecutionTask(input.organizationId, input.executionTaskId);
  if (task === null) fail('no such execution task in this tenant', 'task_not_found');
  if (task.state !== 'prepared') {
    fail('that execution task is not in a preparable state', 'task_not_prepared');
  }

  // CHANNEL AVAILABILITY. A channel with no registered transport fails clearly
  // and is never downgraded to another channel — an unsupported channel that
  // silently became email would contact someone the workflow never authorized
  // contacting that way.
  if (resolveTransport(task.channel) === null) {
    fail(
      `no outreach engine serves the "${task.channel}" channel `
      + `(registered: ${supportedChannels().join(', ') || 'none'})`,
      'channel_unsupported',
    );
  }

  const step = await getProgressionStep(input.organizationId, task.planStepId);
  if (step === null) fail('the execution task has no resolvable plan step', 'invalid_linkage');

  const policy = await resolveTaskPolicy(input.organizationId, step.planId, step.stepKey);

  // PERSON RESOLUTION, through the one existing mechanism. No second resolver.
  const resolved = await resolveSubjectPersonId(input.organizationId, {
    kind: task.subjectKind,
    id: task.subjectId,
  });
  const personId = resolved.ok ? str(resolved.personId) : null;
  if (personId === null) {
    // FAIL CLOSED, before anything is written. The engine would refuse this task
    // anyway — `reserveQuota` answers `person_unresolved` rather than assuming
    // capacity — so creating a row here would only manufacture a task that can
    // never execute.
    fail(
      'the execution subject did not resolve to a canonical person; refusing rather than bridging',
      'person_unresolved',
    );
  }

  const res = await supabase.rpc(BRIDGE_FN, {
    p_organization_id: input.organizationId,
    p_execution_task_id: input.executionTaskId,
    p_person_id: personId,
    p_execution_mode: policy.mode,
    p_workflow_requires_approval: policy.requiresApproval,
    p_policy_source: policy.source,
    p_planner_version: BRIDGE_PLANNER_VERSION,
    p_translation_version: TRANSLATION_VERSION,
    p_governance_version: GOVERNANCE_VERSION,
    p_execution_runtime_version: EXECUTION_RUNTIME_VERSION,
  });

  if (res.error) {
    // A concurrent winner is not a failure: re-read and report the replay.
    const code = String((res.error as { code?: string }).code ?? '');
    const message = String((res.error as { message?: string }).message ?? '');
    if (code === '23505' && message.includes('outreach_bridge_handoffs_task_unique')) {
      const winner = await getHandoffForTask(input.organizationId, input.executionTaskId);
      if (winner !== null) return { handoff: winner, replayed: true };
    }
    translate(res.error, 'bridge handoff failed');
  }

  const created = await getHandoffForTask(input.organizationId, input.executionTaskId);
  if (created === null) fail('the handoff did not persist', 'bridge_error');
  return { handoff: created, replayed: false };
}

export const OUTREACH_BRIDGE_HANDOFFS_TABLE = HANDOFFS_TABLE;
export const BRIDGE_EXECUTION_TASK_RPC = BRIDGE_FN;
