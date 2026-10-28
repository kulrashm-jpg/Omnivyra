/**
 * PI-033 — the Execution Instance. THE writer.
 *
 * One module owns every write to `execution_instances`. A test asserts no other
 * non-test file reaches that table.
 *
 * ─── A ROW MEANS ONE THING ────────────────────────────────────────────────
 * "Workflow W, as published Version V, was invoked for Subject S in the context of
 *  Campaign C." It owns that run's lifecycle and nothing else.
 *
 * ─── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────
 * It creates no Plan, Step, Task, Message, Attempt or Outcome and names none of
 * them. It schedules nothing, dispatches nothing, advances no state on its own and
 * retries nothing. It consults no contact governance and confers NO permission to
 * contact anyone: `mayContact` and the dispatch chain remain authoritative and
 * untouched. 033 creates the identity boundary; later work crosses it.
 *
 * ─── CREATION GOES THROUGH AN RPC, AND THAT IS NOT OPTIONAL ───────────────
 * `create_execution_instance` resolves the current published Workflow Version and
 * inserts the instance in ONE transaction. Splitting those would open a window in
 * which another transaction publishes a new Version between the read and the
 * insert — and because the pin is immutable, the instance would permanently record
 * a Version that was never current, silently.
 *
 * The function also owns the two invariants no foreign key can express: that a
 * polymorphic `(subject_kind, subject_id)` subject belongs to this tenant, and
 * that a supplied Target agrees with the campaign and the subject prospect.
 *
 * ─── THE CALLER NAMES A WORKFLOW, NEVER A VERSION ─────────────────────────
 * There is deliberately no `workflowVersionId` input. A caller that could choose a
 * Version could pin a draft, a superseded one, or another workflow's — which is
 * exactly what 032's status invariant exists to prevent.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { supabase } from '../../db/supabaseClient';

export const EXECUTION_INSTANCES_TABLE = 'execution_instances';
export const CREATE_EXECUTION_INSTANCE_FN = 'create_execution_instance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 024's subject contract, unchanged. These are the only two kinds. */
export const SUBJECT_KINDS = ['lead', 'prospect'] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];

/** Occupied states hold the active-run slot. */
export const OCCUPIED_LIFECYCLE_STATES = ['created', 'queued', 'active', 'paused'] as const;
/** Terminal states release it. A terminal instance is never reopened. */
export const TERMINAL_LIFECYCLE_STATES = ['completed', 'cancelled', 'failed'] as const;
export const LIFECYCLE_STATES = [
  ...OCCUPIED_LIFECYCLE_STATES, ...TERMINAL_LIFECYCLE_STATES,
] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];

export const isOccupiedState = (s: LifecycleState): boolean =>
  (OCCUPIED_LIFECYCLE_STATES as readonly string[]).includes(s);
export const isTerminalState = (s: LifecycleState): boolean =>
  (TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(s);

export class ExecutionInstanceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ExecutionInstanceError';
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new ExecutionInstanceError(message, code);
}

function assertTenant(organizationId: string): void {
  if (!UUID.test(String(organizationId ?? '').trim())) {
    fail('organizationId must be a uuid — an execution is never tenant-less', 'tenant_required');
  }
}

function assertUuid(value: unknown, field: string, code: string): string {
  const v = String(value ?? '').trim();
  if (!UUID.test(v)) fail(`${field} must be a uuid`, code);
  return v;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

export interface ExecutionInstance {
  readonly id: string;
  readonly organizationId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  /** The PIN — resolved by status at creation, immutable thereafter. */
  readonly workflowVersionId: string;
  readonly targetId: string | null;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly lifecycleState: LifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Row = Record<string, unknown>;

const INSTANCE_COLUMNS =
  'id, organization_id, campaign_id, workflow_id, workflow_version_id, target_id, '
  + 'subject_kind, subject_id, lifecycle_state, created_at, updated_at';

const toInstance = (r: Row): ExecutionInstance => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  campaignId: String(r.campaign_id),
  workflowId: String(r.workflow_id),
  workflowVersionId: String(r.workflow_version_id),
  targetId: str(r.target_id),
  subjectKind: String(r.subject_kind) as SubjectKind,
  subjectId: String(r.subject_id),
  lifecycleState: String(r.lifecycle_state) as LifecycleState,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

/**
 * Translate the SQLSTATEs the schema deliberately raises.
 *
 * `23505` has one meaning here and it is the important one: an occupied instance
 * already exists for this campaign, workflow and subject. A caller must be able to
 * tell that apart from any other failure, because it is the ratified repeatability
 * rule refusing a second concurrent run rather than an error.
 */
function translate(error: unknown, context: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? 'unknown error');

  if (code === '23505' && message.includes('uq_execution_instances_active')) {
    fail(
      `${context}: this campaign already has an active run of that workflow for that subject — a new run may start once it reaches a terminal state`,
      'already_active',
    );
  }
  if (code === '23503') {
    if (message.includes('execution_instances_campaign_tenant_fk')) {
      fail(`${context}: no such campaign in this tenant`, 'cross_tenant_campaign');
    }
    if (message.includes('execution_instances_workflow_tenant_fk')) {
      fail(`${context}: no such workflow in this tenant`, 'cross_tenant_workflow');
    }
    if (message.includes('execution_instances_version_tenant_fk')) {
      fail(`${context}: no such workflow version in this tenant`, 'cross_tenant_version');
    }
    if (message.includes('execution_instances_target_tenant_fk')) {
      fail(`${context}: no such campaign target in this tenant`, 'cross_tenant_target');
    }
    if (message.includes('organization_id_fkey')) {
      fail(`${context}: that organization does not exist`, 'unknown_tenant');
    }
    fail(`${context}: a referenced row does not belong to this tenant`, 'cross_tenant_reference');
  }
  if (code === '23514') {
    fail(`${context}: ${message}`, 'contract_violation');
  }
  fail(`${context} (${code || 'no code'}): ${message}`, code || 'write_failed');
}

/** The function's own refusals, mapped to codes a caller can act on. */
function translateCreate(error: unknown): never {
  const message = String((error as { message?: string } | null)?.message ?? '');
  const map: ReadonlyArray<readonly [string, string, string]> = [
    ['ei_create:invalid_subject_kind', 'subjectKind must be lead | prospect', 'invalid_subject_kind'],
    ['ei_create:invalid_subject_id', 'subjectId must be a non-blank identifier', 'invalid_subject_id'],
    ['ei_create:campaign_not_found', 'no such campaign in this tenant', 'campaign_not_found'],
    ['ei_create:workflow_not_found', 'no such workflow in this tenant', 'workflow_not_found'],
    ['ei_create:workflow_not_active', 'an archived workflow cannot start a new run', 'workflow_not_active'],
    ['ei_create:no_published_version', 'that workflow has no published version to run', 'no_published_version'],
    ['ei_create:subject_not_found', 'no such subject in this tenant', 'subject_not_found'],
    ['ei_create:target_requires_prospect', 'a campaign target may only accompany a prospect subject', 'target_requires_prospect'],
    ['ei_create:target_mismatch', 'that target does not belong to this campaign and subject', 'target_mismatch'],
  ];
  for (const [marker, text, code] of map) {
    if (message.includes(marker)) fail(text, code);
  }
  translate(error, 'execution instance creation failed');
}

export interface CreateExecutionInstanceInput {
  organizationId: string;
  campaignId: string;
  /**
   * The WORKFLOW. There is deliberately no version input: the system resolves the
   * current published Version and pins it.
   */
  workflowId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  /** Optional. Required to be absent for a `lead` subject. */
  targetId?: string | null;
}

/**
 * Create one Execution Instance.
 *
 * ATOMIC, through `create_execution_instance`: version resolution, every
 * cross-entity validation, the active-uniqueness check and the insert all happen in
 * one transaction. A failure at any point leaves no row and no stranded slot.
 *
 * IT WRITES NOTHING ELSE. No campaign, workflow, version, target, subject,
 * membership or task row is created or modified.
 */
export async function createExecutionInstance(
  input: CreateExecutionInstanceInput,
): Promise<ExecutionInstance> {
  assertTenant(input.organizationId);
  const campaignId = assertUuid(input.campaignId, 'campaignId', 'invalid_campaign');
  const workflowId = assertUuid(input.workflowId, 'workflowId', 'invalid_workflow');

  if (!SUBJECT_KINDS.includes(input.subjectKind)) {
    fail(`subjectKind must be one of ${SUBJECT_KINDS.join(' | ')}`, 'invalid_subject_kind');
  }
  const subjectId = str(input.subjectId);
  if (subjectId === null) {
    fail('an execution instance requires a subjectId', 'invalid_subject_id');
  }

  const targetId = str(input.targetId);
  if (targetId !== null && !UUID.test(targetId)) {
    fail('targetId must be a uuid when supplied', 'invalid_target');
  }
  // Refused here as well as by the CHECK and the function: a caller learns before
  // the wire, and the database still owns the guarantee.
  if (targetId !== null && input.subjectKind !== 'prospect') {
    fail('a campaign target may only accompany a prospect subject', 'target_requires_prospect');
  }

  const res = await supabase.rpc(CREATE_EXECUTION_INSTANCE_FN, {
    p_organization_id: input.organizationId,
    p_campaign_id: campaignId,
    p_workflow_id: workflowId,
    p_subject_kind: input.subjectKind,
    p_subject_id: subjectId,
    p_target_id: targetId,
  });

  if (res.error) translateCreate(res.error);

  const newId = typeof res.data === 'string'
    ? res.data
    : str((rows(res.data)[0] ?? {}).create_execution_instance);
  if (newId === null || !UUID.test(String(newId))) {
    fail('the execution instance could not be read back after creation', 'creation_unreadable');
  }

  const created = await getExecutionInstance(input.organizationId, String(newId));
  if (!created) fail('the execution instance could not be read back', 'creation_unreadable');
  return created;
}

/** One instance, or null. Another tenant's is null, never an error. */
export async function getExecutionInstance(
  organizationId: string, instanceId: string,
): Promise<ExecutionInstance | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select(INSTANCE_COLUMNS)
    .eq('organization_id', organizationId)   // tenant boundary — never optional, always first
    .eq('id', assertUuid(instanceId, 'instanceId', 'invalid_instance'))
    .maybeSingle();
  if (res.error) translate(res.error, 'instance read failed');
  return res.data ? toInstance(res.data as unknown as Row) : null;
}

/** Every run of one campaign, most recent first. History is never collapsed. */
export async function listCampaignExecutionInstances(
  organizationId: string, campaignId: string, options: { limit?: number } = {},
): Promise<readonly ExecutionInstance[]> {
  assertTenant(organizationId);
  const id = assertUuid(campaignId, 'campaignId', 'invalid_campaign');
  const limit = options.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    fail('limit must be an integer between 1 and 1000', 'invalid_limit');
  }
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select(INSTANCE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) translate(res.error, 'campaign instance listing failed');
  return rows(res.data).map(toInstance);
}

/**
 * Every run for one subject, across campaigns and workflows.
 *
 * The attribution read: one person may legitimately be the subject of several
 * concurrent runs under different campaigns and workflows, which is exactly what
 * the campaign-scoped uniqueness rule permits.
 */
export async function listSubjectExecutionInstances(
  organizationId: string, subjectKind: SubjectKind, subjectId: string,
  options: { limit?: number } = {},
): Promise<readonly ExecutionInstance[]> {
  assertTenant(organizationId);
  if (!SUBJECT_KINDS.includes(subjectKind)) {
    fail(`subjectKind must be one of ${SUBJECT_KINDS.join(' | ')}`, 'invalid_subject_kind');
  }
  const sid = str(subjectId);
  if (sid === null) fail('subjectId is required', 'invalid_subject_id');
  const limit = options.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    fail('limit must be an integer between 1 and 1000', 'invalid_limit');
  }
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select(INSTANCE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('subject_kind', subjectKind)
    .eq('subject_id', sid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) translate(res.error, 'subject instance listing failed');
  return rows(res.data).map(toInstance);
}

/**
 * The OCCUPIED instance for a campaign, workflow and subject, or null.
 *
 * Resolved by the occupancy predicate, which is the same set the partial unique
 * index constrains — so this read and that invariant can never disagree.
 */
export async function getOccupiedExecutionInstance(
  organizationId: string, campaignId: string, workflowId: string,
  subjectKind: SubjectKind, subjectId: string,
): Promise<ExecutionInstance | null> {
  assertTenant(organizationId);
  const sid = str(subjectId);
  if (sid === null) fail('subjectId is required', 'invalid_subject_id');
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select(INSTANCE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('campaign_id', assertUuid(campaignId, 'campaignId', 'invalid_campaign'))
    .eq('workflow_id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .eq('subject_kind', subjectKind)
    .eq('subject_id', sid)
    .in('lifecycle_state', [...OCCUPIED_LIFECYCLE_STATES])
    .maybeSingle();
  if (res.error) translate(res.error, 'occupied instance read failed');
  return res.data ? toInstance(res.data as unknown as Row) : null;
}

/**
 * Move an instance's lifecycle state.
 *
 * ─── THE TRANSITION RULE, AND WHY IT IS THIS NARROW ───────────────────────
 * An occupied instance may move to any other state. A TERMINAL instance may move
 * nowhere — re-entry is a NEW instance, which is the ratified retry semantic.
 *
 * Nothing finer is enforced, deliberately. The ratified contract fixes the seven
 * states and the occupied/terminal split; it does NOT fix a transition graph among
 * the occupied states, and inventing one here would be deciding a product question
 * this workstream was not given. The 033 report records that as a deferred decision.
 *
 * The database enforces the no-reopening half independently, so this is the polite
 * layer, not the load-bearing one.
 *
 * It advances nothing by itself: there is no scheduler and no automatic transition.
 */
export async function setExecutionInstanceState(input: {
  organizationId: string;
  instanceId: string;
  lifecycleState: LifecycleState;
}): Promise<ExecutionInstance | null> {
  assertTenant(input.organizationId);
  const instanceId = assertUuid(input.instanceId, 'instanceId', 'invalid_instance');
  if (!LIFECYCLE_STATES.includes(input.lifecycleState)) {
    fail(`lifecycleState must be one of ${LIFECYCLE_STATES.join(' | ')}`, 'invalid_state');
  }

  const current = await getExecutionInstance(input.organizationId, instanceId);
  if (!current) return null;
  if (isTerminalState(current.lifecycleState)) {
    if (current.lifecycleState === input.lifecycleState) return current;   // idempotent no-op
    fail(
      `instance is ${current.lifecycleState} and terminal — a terminal run may not be reopened, create a new instance`,
      'terminal_instance',
    );
  }

  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .update({ lifecycle_state: input.lifecycleState })
    .eq('organization_id', input.organizationId)
    .eq('id', instanceId)
    .select(INSTANCE_COLUMNS);
  if (res.error) translate(res.error, 'lifecycle transition failed');
  const found = rows(res.data);
  return found.length ? toInstance(found[0]) : null;
}

/*
 * THERE IS DELIBERATELY NO DELETE, AND NO IDENTITY EDIT.
 *
 * No delete: an Execution Instance is the historical record of a run, and deleting
 * one destroys the only evidence that it happened. The sole deletion paths are the
 * tenant cascade from `companies` and the subject's own erasure, neither of which
 * needs a function here. Every historical reference — campaign, workflow, version,
 * target — uses ON DELETE NO ACTION, so none of them can vanish beneath an
 * instance and none can be nulled out from under it.
 *
 * No identity edit: the database refuses it, and a function here that attempted one
 * would only produce a stack trace at a later line. A retry is a NEW instance.
 */

/**
 * Orchestration — the ids of a tenant's runs in `states`, oldest first, at most
 * `limit + 1` (one extra, so a caller can tell "exactly limit" from "more remain").
 *
 * The progression sweeper's discovery read. It lives HERE so this store stays the
 * one module that names the table; the sweeper passes the states it progresses
 * (never `paused`), so a pause is a real pause.
 */
export async function listExecutionInstanceIdsInStates(
  organizationId: string,
  states: readonly LifecycleState[],
  limit: number,
): Promise<string[]> {
  assertTenant(organizationId);
  if (states.length === 0) return [];
  for (const s of states) {
    if (!(LIFECYCLE_STATES as readonly string[]).includes(s)) fail(`unknown lifecycle state ${s}`, 'invalid_lifecycle_state');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('limit must be an integer between 1 and 1000', 'invalid_limit');
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select('id')
    .eq('organization_id', organizationId)
    .in('lifecycle_state', [...states])
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (res.error) translate(res.error, 'instance discovery failed');
  return rows(res.data).map((r) => String(r.id));
}

/**
 * Orchestration — a workflow's runs (every version, every lifecycle state), newest
 * first, at most `limit`. The journey report's read; read-only.
 */
export async function listWorkflowExecutionInstances(
  organizationId: string, workflowId: string, limit: number = 500,
): Promise<readonly ExecutionInstance[]> {
  assertTenant(organizationId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('limit must be an integer between 1 and 1000', 'invalid_limit');
  const res = await ownedDbTable(EXECUTION_INSTANCES_TABLE)
    .select(INSTANCE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('workflow_id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) translate(res.error, 'workflow instance listing failed');
  return rows(res.data).map(toInstance);
}
