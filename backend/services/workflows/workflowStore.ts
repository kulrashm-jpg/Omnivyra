/**
 * PI-WORKFLOW-DEFINITION-032 — Workflow and Workflow Version. THE writer.
 *
 * One module owns every write to `workflows` and `workflow_versions`. A test
 * asserts no other non-test file reaches either table.
 *
 * ─── THE RATIFIED CONTRACT (032-DECISION) ─────────────────────────────────
 *   Workflow      stable reusable identity, lifecycle active | archived,
 *                 carrying NO authoring content.
 *   Version       draft -> published -> superseded | archived. Publication is an
 *                 explicit authorized action and the exact point content freezes.
 *   Multiplicity  at most ONE published Version per workflow.
 *   Selection     resolved once at Execution Instance creation, then pinned.
 *   Timing        `delay_after_previous_hours` per step. That is the whole
 *                 vocabulary; the runtime resolves actual timestamps.
 *
 * ─── BOTTLENECK 1: `getCurrentWorkflowVersion` USES THE STATUS PREDICATE ──
 * It filters `status = 'published'` and does NOT order, limit, or take a maximum.
 * `version` is a human-facing ordinal: a draft routinely carries a HIGHER ordinal
 * than the published row, and archiving the published row leaves the highest
 * ordinal belonging to a version that is not current at all. `MAX(version)` is
 * therefore wrong in states this module produces in normal use, not merely in
 * theory — and the database enforces the invariant the predicate relies on
 * through `uq_workflow_versions_one_published`.
 *
 * ─── BOTTLENECK 2: THERE IS NO "EDIT PUBLISHED" FUNCTION ──────────────────
 * `updateDraftVersion` is scoped to drafts by a predicate the database evaluates,
 * and the immutability guard refuses a published edit outright. Changing a
 * published process means publishing a NEW version.
 *
 * ─── BOTTLENECK 3: PUBLICATION GOES THROUGH AN RPC, DELIBERATELY ──────────
 * `publishWorkflowVersion` calls `publish_workflow_version`. It is the one write
 * here that is not a single statement, because publication must supersede the
 * outgoing version AND publish the incoming one. The partial unique index forces
 * supersession first, a superseded row is wholly immutable, and this runtime owns
 * no transaction helper — so two store statements could strand a workflow with no
 * current version and no way back. A function body is one transaction. That is
 * the entire reason for the RPC, and it is still this module that owns the call.
 *
 * ─── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────
 * It creates no Execution Instance, Plan, Step row, Task, Attempt or Outcome and
 * names none of them. It evaluates no eligibility, scores nothing, resolves no
 * person, consults no contact governance and sends nothing. Authoring a process
 * is not permission to contact anyone: `mayContact` and the dispatch chain remain
 * authoritative and untouched.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { supabase } from '../../db/supabaseClient';
import {
  validateChoiceGroup, validateConditions, validateEnrollment, validateFrequencyPolicy, validateObjective,
  validateWhatsAppSettings, JourneyPolicyError,
  type JourneyCondition, type JourneyEnrollment, type JourneyFrequencyPolicy,
  type JourneyObjective, type WhatsAppStepSettings,
} from '../orchestration/journeyPolicy';
import {
  SOCIAL_POST_CHANNEL, parseSocialPostSettings, type SocialPostStepSettings,
} from '../orchestration/socialPostStepContract';

export const WORKFLOWS_TABLE = 'workflows';
export const WORKFLOW_VERSIONS_TABLE = 'workflow_versions';
export const PUBLISH_WORKFLOW_VERSION_FN = 'publish_workflow_version';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORKFLOW_STATUSES = ['active', 'archived'] as const;
export type WorkflowStatus = typeof WORKFLOW_STATUSES[number];

export const WORKFLOW_VERSION_STATUSES = [
  'draft', 'published', 'superseded', 'archived',
] as const;
export type WorkflowVersionStatus = typeof WORKFLOW_VERSION_STATUSES[number];

/**
 * CHANNEL INTENT, not a transport. These are the nine the planner already
 * recognises plus `content`, matching `OutreachPlanStep.channel`.
 *
 * It is deliberately NOT narrowed to the two channels Outreach currently has
 * registered transports for: 032 recorded the 9-vs-2 gap as a deferred product
 * decision, and silently restricting authoring here would decide it. A step may
 * therefore name a channel that is not yet dispatchable; that is a materialization
 * concern, not an authoring error.
 *
 * `internal` (orchestration, 2026-10-28): a task for the tenant's own team — the
 * WS-3 internal transport, which contacts nobody. It is the one channel whose
 * engine executes end to end on main today, and it was previously unreachable
 * from a workflow because it was not authorable here.
 *
 * `content` is UNCHANGED: share a resource WITH this prospect (person-addressed).
 *
 * `social_post` (orchestration, 2026-10-28): a PUBLIC, tenant-wide social post —
 * NOT `content`. The step must name one already-released `scheduled_posts` row
 * (`social_post.scheduled_post_id`) and only AWAITS that post's publication by
 * the existing engine; it never creates, approves or triggers a post. See
 * orchestration/socialPostStepContract.ts. Appended last so no existing
 * channel's position or meaning changes.
 */
export const WORKFLOW_STEP_CHANNELS = [
  'email', 'linkedin', 'phone', 'whatsapp', 'sms',
  'github', 'discord', 'slack', 'community', 'content', 'internal',
  'social_post',
] as const;
export type WorkflowStepChannel = typeof WORKFLOW_STEP_CHANNELS[number];

/** The maximum relative delay a single step may express: 90 days in hours. */
const MAX_STEP_DELAY_HOURS = 24 * 90;

export class WorkflowError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new WorkflowError(message, code);
}

function assertTenant(organizationId: string): void {
  if (!UUID.test(String(organizationId ?? '').trim())) {
    fail('organizationId must be a uuid — a workflow is never tenant-less', 'tenant_required');
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

function optionalUuid(value: unknown, field: string, code: string): string | null {
  const v = str(value);
  if (v === null) return null;
  if (!UUID.test(v)) fail(`${field} must be a uuid when supplied`, code);
  return v;
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface Workflow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: WorkflowStatus;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * PI-040 — the ratified execution autonomy modes. Exactly three; no others are
 * authorized. Lowercase to match every other enumerated value in this
 * repository (`published`, `email`, `prepared`), not the prose casing.
 *
 *   human       AI may research, recommend, draft, personalize and analyse, but
 *               a human must explicitly approve before execution.
 *   assisted    AI may prepare content, action and execution; the user stays in
 *               control; whether approval is required depends on policy.
 *   autonomous  AI may prepare and execute within this authorized policy without
 *               per-action human approval.
 *
 * NONE of them grants permission to contact anyone. `mayContact` and the
 * governance chain remain independently authoritative.
 */
export const WORKFLOW_EXECUTION_MODES = ['human', 'assisted', 'autonomous'] as const;
export type WorkflowExecutionMode = typeof WORKFLOW_EXECUTION_MODES[number];

/** One authored step. `key` is durable WITHIN its version, never globally. */
export interface WorkflowStep {
  readonly key: string;
  readonly channel: WorkflowStepChannel;
  /** The WHOLE timing vocabulary: hours to wait after the previous step. */
  readonly delay_after_previous_hours: number;
  /** Optional authoring text. Personalization INSTRUCTIONS only, never data. */
  readonly instruction?: string;
  /**
   * PI-040 — the step's execution autonomy. REQUIRED on every newly authored
   * step: a Version must STATE the autonomy it was authorized with, never
   * acquire one by omission.
   *
   * It lives inside the definition because 036 snapshots the definition
   * VERBATIM into `execution_plans.definition_snapshot` — so policy authored
   * here is automatically version-pinned, frozen at publication and
   * reconstructable for a completed run, with no second snapshot and no second
   * publication-atomicity mechanism.
   */
  readonly execution_mode: WorkflowExecutionMode;
  /**
   * PI-040 — the WORKFLOW term of the ratified approval union
   * `required = Workflow OR Channel OR Governance`.
   *
   * Optional and ADDITIVE ONLY. Absent means this step adds no requirement of
   * its own; it can never remove one. `human` requires approval whatever this
   * says — see `workflowStepRequiresApproval`.
   */
  readonly requires_approval?: boolean;
  /**
   * Orchestration — the step applies to an individual only when every condition
   * holds against that person's facts at the moment the step becomes ready.
   * Otherwise the step is SKIPPED (the ratified advancing state): "no suitable
   * action for this person" is a decision, not a failure. Absent = always applies.
   */
  readonly when?: readonly JourneyCondition[];
  /** Orchestration — consecutive steps of a group are candidates; the first to act wins. */
  readonly choice_group?: string;
  /** Orchestration — engine settings, required for (and only allowed on) whatsapp steps. */
  readonly whatsapp?: WhatsAppStepSettings;
  /**
   * Orchestration — the approved publishing object a `social_post` step awaits.
   * Required on (and only allowed on) social_post steps. A REFERENCE, never data:
   * no copy, account, platform or time (those belong to the released post).
   */
  readonly social_post?: SocialPostStepSettings;
}

/**
 * The Workflow-policy term of the approval union, derived rather than stored
 * twice.
 *
 * MONOTONE BY CONSTRUCTION: it can only ever return true more often, never
 * less. `human` requires approval by definition, so an authored
 * `requires_approval: false` beside it is powerless — nothing may downgrade a
 * requirement another layer has already imposed.
 */
export function workflowStepRequiresApproval(
  step: { execution_mode: WorkflowExecutionMode; requires_approval?: boolean },
): boolean {
  return step.execution_mode === 'human' || step.requires_approval === true;
}

/**
 * The policy of a step read back from a SNAPSHOT, which may predate the field.
 *
 * FAILS CLOSED. A Version published before `execution_mode` existed carries no
 * authorized autonomy, and inferring one would invent authority that was never
 * granted — so it reads as `human` with approval required. `source` records
 * which happened, so a reader never has to guess whether `human` was authored
 * or defaulted.
 *
 * This default reaches ONLY such legacy Versions: the validator requires the
 * field on every newly authored step, so nothing new becomes `human` by
 * omission either.
 */
export function resolveStepPolicy(raw: unknown): {
  readonly mode: WorkflowExecutionMode;
  readonly requiresApproval: boolean;
  readonly source: 'authored' | 'legacy_default';
} {
  const obj = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  const mode = obj === null ? null : str(obj.execution_mode);
  if (mode === null || !WORKFLOW_EXECUTION_MODES.includes(mode as WorkflowExecutionMode)) {
    return { mode: 'human', requiresApproval: true, source: 'legacy_default' };
  }
  const m = mode as WorkflowExecutionMode;
  return {
    mode: m,
    requiresApproval: workflowStepRequiresApproval({
      execution_mode: m,
      requires_approval: obj !== null && obj.requires_approval === true,
    }),
    source: 'authored',
  };
}

export interface WorkflowDefinition {
  readonly steps: readonly WorkflowStep[];
  /** Orchestration — the business objective and its measurable success criterion. */
  readonly objective?: JourneyObjective;
  /** Orchestration — who may be enrolled under this version. */
  readonly enrollment?: JourneyEnrollment;
  /** Orchestration — per-individual contact frequency. */
  readonly policy?: JourneyFrequencyPolicy;
}

export interface WorkflowVersion {
  readonly id: string;
  readonly organizationId: string;
  readonly workflowId: string;
  /** A HUMAN-FACING ORDINAL. Never the source of truth for "current". */
  readonly version: number;
  readonly status: WorkflowVersionStatus;
  readonly definition: WorkflowDefinition;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
}

type Row = Record<string, unknown>;

const WORKFLOW_COLUMNS =
  'id, organization_id, name, description, status, created_by, created_at, updated_at';
const VERSION_COLUMNS =
  'id, organization_id, workflow_id, version, status, definition, created_by, '
  + 'created_at, updated_at, published_at, published_by';

const toWorkflow = (r: Row): Workflow => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  name: String(r.name),
  description: str(r.description),
  status: String(r.status) as WorkflowStatus,
  createdBy: str(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A stored definition, as written. The journey-policy parts were validated on
 * write and a published version is immutable, so they are read back verbatim —
 * dropping them (as this did until 2026-10-28) silently disabled enrollment
 * conditions, frequency policy and objectives. Versions authored before
 * orchestration simply have none.
 */
const toDefinition = (v: unknown): WorkflowDefinition => {
  const obj = isObject(v) ? v : {};
  const steps = Array.isArray(obj.steps) ? (obj.steps as WorkflowStep[]) : [];
  return {
    steps,
    ...(isObject(obj.objective) ? { objective: obj.objective as unknown as JourneyObjective } : {}),
    ...(isObject(obj.enrollment) ? { enrollment: obj.enrollment as unknown as JourneyEnrollment } : {}),
    ...(isObject(obj.policy) ? { policy: obj.policy as unknown as JourneyFrequencyPolicy } : {}),
  };
};

const toVersion = (r: Row): WorkflowVersion => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  workflowId: String(r.workflow_id),
  version: Number(r.version),
  status: String(r.status) as WorkflowVersionStatus,
  definition: toDefinition(r.definition),
  createdBy: str(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  publishedAt: str(r.published_at),
  publishedBy: str(r.published_by),
});

const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

/**
 * Translate the SQLSTATEs the schema deliberately raises.
 *
 * `23505` carries three different uniqueness failures and the constraint NAME is
 * what tells them apart — including the one that matters most, a second published
 * version, which a caller must be able to distinguish from a duplicate ordinal.
 */
function translate(error: unknown, context: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? 'unknown error');

  if (code === '23505') {
    if (message.includes('uq_workflow_versions_one_published')) {
      fail(
        `${context}: this workflow already has a published version — publish supersedes it, it does not add a second`,
        'already_published',
      );
    }
    if (message.includes('uq_workflow_versions_identity')) {
      fail(`${context}: that version number already exists for this workflow`, 'duplicate_version');
    }
    fail(`${context}: ${message}`, 'duplicate');
  }
  if (code === '23503') {
    if (message.includes('workflow_versions_workflow_tenant_fk')) {
      fail(`${context}: no such workflow in this tenant`, 'cross_tenant_workflow');
    }
    if (message.includes('organization_id_fkey')) {
      fail(`${context}: that organization does not exist`, 'unknown_tenant');
    }
    fail(`${context}: a referenced row does not belong to this tenant`, 'cross_tenant_reference');
  }
  if (code === '23514') {
    // Includes both guard triggers and every CHECK.
    fail(`${context}: ${message}`, 'contract_violation');
  }
  fail(`${context} (${code || 'no code'}): ${message}`, code || 'write_failed');
}

// ── Workflow ────────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  organizationId: string;
  name: string;
  description?: string | null;
  /** The VERIFIED acting user. Never read from a request body. */
  actorUserId?: string | null;
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
  assertTenant(input.organizationId);
  const name = str(input.name);
  if (name === null) fail('a workflow requires a name', 'name_required');
  if (name.length > 200) fail('name must be at most 200 characters', 'name_too_long');
  const description = str(input.description);
  if (description !== null && description.length > 2000) {
    fail('description must be at most 2000 characters', 'description_too_long');
  }

  const res = await ownedDbTable(WORKFLOWS_TABLE)
    .insert({
      organization_id: input.organizationId,
      name,
      description,
      created_by: optionalUuid(input.actorUserId, 'actorUserId', 'invalid_actor'),
    })
    .select(WORKFLOW_COLUMNS)
    .single();

  if (res.error) translate(res.error, 'workflow creation failed');
  return toWorkflow(res.data as unknown as Row);
}

/** One workflow, or null. Another tenant's is null, never an error. */
export async function getWorkflow(
  organizationId: string, workflowId: string,
): Promise<Workflow | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOWS_TABLE)
    .select(WORKFLOW_COLUMNS)
    .eq('organization_id', organizationId)   // tenant boundary — never optional, always first
    .eq('id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .maybeSingle();
  if (res.error) translate(res.error, 'workflow read failed');
  return res.data ? toWorkflow(res.data as unknown as Row) : null;
}

export async function listWorkflows(organizationId: string): Promise<readonly Workflow[]> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOWS_TABLE)
    .select(WORKFLOW_COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (res.error) translate(res.error, 'workflow listing failed');
  return rows(res.data).map(toWorkflow);
}

/**
 * Edit a workflow's metadata. It cannot touch status — archival is its own
 * operation — and there is no authoring content here to edit.
 */
export async function updateWorkflowMetadata(input: {
  organizationId: string;
  workflowId: string;
  name?: string;
  description?: string | null;
}): Promise<Workflow | null> {
  assertTenant(input.organizationId);
  const workflowId = assertUuid(input.workflowId, 'workflowId', 'invalid_workflow');

  const payload: Row = {};
  if (input.name !== undefined) {
    const name = str(input.name);
    if (name === null) fail('name cannot be blank', 'name_required');
    if (name.length > 200) fail('name must be at most 200 characters', 'name_too_long');
    payload.name = name;
  }
  if (input.description !== undefined) {
    const description = str(input.description);
    if (description !== null && description.length > 2000) {
      fail('description must be at most 2000 characters', 'description_too_long');
    }
    payload.description = description;
  }
  if (Object.keys(payload).length === 0) fail('nothing to update', 'empty_update');

  const res = await ownedDbTable(WORKFLOWS_TABLE)
    .update(payload)
    .eq('organization_id', input.organizationId)
    .eq('id', workflowId)
    .select(WORKFLOW_COLUMNS);
  if (res.error) translate(res.error, 'workflow update failed');
  const found = rows(res.data);
  return found.length ? toWorkflow(found[0]) : null;
}

/**
 * Archive or reactivate a workflow.
 *
 * Archiving prevents new Version authoring and new invocation. It does NOT
 * invalidate existing Versions or any Execution Instance that referenced them,
 * and it deletes nothing — there is deliberately no delete, matching
 * `prospect_lists` and `prospect_campaigns`, neither of which has one.
 *
 * Both directions are permitted because that is what the existing active/archived
 * pattern does: `setProspectListStatus` and `setProspectCampaignStatus` both take
 * a status rather than being one-way. Nothing in the repository establishes
 * archival as terminal, so the smallest consistent choice is symmetry.
 */
export async function setWorkflowStatus(
  organizationId: string, workflowId: string, status: WorkflowStatus,
): Promise<Workflow | null> {
  assertTenant(organizationId);
  if (!WORKFLOW_STATUSES.includes(status)) {
    fail(`status must be one of ${WORKFLOW_STATUSES.join(' | ')}`, 'invalid_status');
  }
  const res = await ownedDbTable(WORKFLOWS_TABLE)
    .update({ status })
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .select(WORKFLOW_COLUMNS);
  if (res.error) translate(res.error, 'workflow status change failed');
  const found = rows(res.data);
  return found.length ? toWorkflow(found[0]) : null;
}

// ── Definition validation ───────────────────────────────────────────────────

/**
 * Validate an authored definition. The database validates it again at publication
 * — this exists so a caller learns before the wire, not so the database can trust
 * the caller.
 */
export function validateWorkflowDefinition(definition: unknown): WorkflowDefinition {
  const obj = (definition && typeof definition === 'object' ? definition : null) as
    Record<string, unknown> | null;
  if (obj === null || Array.isArray(obj)) {
    fail('definition must be an object with a steps array', 'invalid_definition');
  }
  if (!Array.isArray(obj.steps)) {
    fail('definition.steps must be an array', 'invalid_definition');
  }

  const steps: WorkflowStep[] = [];
  const seen = new Set<string>();
  const closedChoiceGroups = new Set<string>();
  let openChoiceGroup: string | null = null;
  for (const raw of obj.steps as unknown[]) {
    const s = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
    if (s === null || Array.isArray(s)) fail('every step must be an object', 'invalid_step');

    const key = str(s.key);
    if (key === null) fail('every step requires a non-blank key', 'invalid_step_key');
    if (key.length > 120) fail('a step key must be at most 120 characters', 'invalid_step_key');
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      fail('a step key is 1-120 chars of [A-Za-z0-9._-]', 'invalid_step_key');
    }
    // Unique WITHIN this version. Across versions a key may legitimately repeat:
    // v1's `intro` and v2's `intro` are different immutable definitions.
    if (seen.has(key)) fail(`duplicate step key "${key}" in one version`, 'duplicate_step_key');
    seen.add(key);

    const channel = str(s.channel);
    if (channel === null || !WORKFLOW_STEP_CHANNELS.includes(channel as WorkflowStepChannel)) {
      fail(
        `step "${key}" channel must be one of ${WORKFLOW_STEP_CHANNELS.join(' | ')}`,
        'invalid_step_channel',
      );
    }

    const delay = s.delay_after_previous_hours;
    if (typeof delay !== 'number' || !Number.isFinite(delay)) {
      fail(`step "${key}" requires a numeric delay_after_previous_hours`, 'invalid_step_delay');
    }
    if (delay < 0) {
      fail(`step "${key}" delay_after_previous_hours must not be negative`, 'invalid_step_delay');
    }
    if (delay > MAX_STEP_DELAY_HOURS) {
      fail(
        `step "${key}" delay_after_previous_hours must be at most ${MAX_STEP_DELAY_HOURS}`,
        'invalid_step_delay',
      );
    }

    const instruction = str(s.instruction);
    if (instruction !== null && instruction.length > 2000) {
      fail(`step "${key}" instruction must be at most 2000 characters`, 'invalid_step_instruction');
    }

    // PI-040 — the autonomy a step was AUTHORIZED with is required, not inferred.
    // A step that omits it would otherwise acquire a mode by omission, which the
    // ratified contract forbids in both directions: no silent `human` and no
    // silent `autonomous`. Versions published BEFORE this field existed are a
    // separate case and are read through `resolveStepPolicy`, which fails closed.
    const executionMode = str(s.execution_mode);
    if (executionMode === null) {
      fail(
        `step "${key}" requires execution_mode (${WORKFLOW_EXECUTION_MODES.join(' | ')})`,
        'missing_step_execution_mode',
      );
    }
    if (!WORKFLOW_EXECUTION_MODES.includes(executionMode as WorkflowExecutionMode)) {
      fail(
        `step "${key}" execution_mode must be one of ${WORKFLOW_EXECUTION_MODES.join(' | ')}`,
        'invalid_step_execution_mode',
      );
    }
    // Additive only. A non-boolean is refused rather than coerced, because a
    // truthy string would silently create an approval requirement nobody authored
    // and a falsy one would read as an attempt to remove it.
    if (s.requires_approval !== undefined && typeof s.requires_approval !== 'boolean') {
      fail(`step "${key}" requires_approval must be a boolean`, 'invalid_step_requires_approval');
    }

    // Orchestration: per-individual applicability and engine settings.
    const when = asWorkflowError(() => validateConditions(s.when, `step "${key}" when`));
    const choiceGroup = asWorkflowError(() => validateChoiceGroup(s.choice_group, key));
    // Non-adjacent members would let unrelated steps run between the candidates.
    if (choiceGroup !== undefined && closedChoiceGroups.has(choiceGroup)) {
      fail(`choice_group "${choiceGroup}" must be consecutive steps`, 'invalid_choice_group');
    }
    if (openChoiceGroup !== null && openChoiceGroup !== choiceGroup) closedChoiceGroups.add(openChoiceGroup);
    openChoiceGroup = choiceGroup ?? null;
    if (s.whatsapp !== undefined && channel !== 'whatsapp') {
      fail(`step "${key}" whatsapp settings are only allowed on a whatsapp step`, 'invalid_step_engine_settings');
    }
    const whatsapp = channel === 'whatsapp'
      ? asWorkflowError(() => validateWhatsAppSettings(s.whatsapp, key))
      : null;

    // Orchestration: a social_post step references one approved publishing object
    // and carries no authoring text (an instruction could be mistaken for copy).
    if (s.social_post !== undefined && channel !== SOCIAL_POST_CHANNEL) {
      fail(`step "${key}" social_post settings are only allowed on a social_post step`, 'invalid_step_engine_settings');
    }
    let socialPost: SocialPostStepSettings | null = null;
    if (channel === SOCIAL_POST_CHANNEL) {
      if (instruction !== null) {
        fail(`step "${key}" a social_post step takes no instruction: it publishes nothing of its own`, 'invalid_step_instruction');
      }
      const parsed = parseSocialPostSettings(s.social_post, key);
      if (parsed.ok === false) fail(parsed.message, parsed.code);
      socialPost = parsed.settings;
    }

    steps.push({
      key,
      channel: channel as WorkflowStepChannel,
      delay_after_previous_hours: delay,
      ...(instruction === null ? {} : { instruction }),
      execution_mode: executionMode as WorkflowExecutionMode,
      ...(s.requires_approval === true ? { requires_approval: true } : {}),
      ...(when.length > 0 ? { when } : {}),
      ...(choiceGroup === undefined ? {} : { choice_group: choiceGroup }),
      ...(whatsapp === null ? {} : { whatsapp }),
      ...(socialPost === null ? {} : { social_post: socialPost }),
    });
  }

  const objective = asWorkflowError(() => validateObjective(obj.objective));
  const enrollment = asWorkflowError(() => validateEnrollment(obj.enrollment));
  const policy = asWorkflowError(() => validateFrequencyPolicy(obj.policy));
  return {
    steps,
    ...(objective === undefined ? {} : { objective }),
    ...(enrollment === undefined ? {} : { enrollment }),
    ...(policy === undefined ? {} : { policy }),
  };
}

/** Journey-policy validation errors surface as WorkflowError, the store's one error type. */
function asWorkflowError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof JourneyPolicyError) fail(e.message, e.code);
    throw e;
  }
}

// ── Version ─────────────────────────────────────────────────────────────────

/**
 * Create a draft Version.
 *
 * The ordinal is `max(version) + 1` for the workflow — which is the ONE place a
 * numeric maximum is legitimate, because it is allocating a human-facing label and
 * not resolving which version is current. A concurrent allocation collides on
 * `uq_workflow_versions_identity` and is reported as `duplicate_version`.
 *
 * Refused for an archived workflow: archival prevents new authoring.
 */
export async function createDraftVersion(input: {
  organizationId: string;
  workflowId: string;
  definition?: unknown;
  actorUserId?: string | null;
}): Promise<WorkflowVersion> {
  assertTenant(input.organizationId);
  const workflowId = assertUuid(input.workflowId, 'workflowId', 'invalid_workflow');

  const workflow = await getWorkflow(input.organizationId, workflowId);
  if (!workflow) fail('no such workflow in this tenant', 'workflow_not_found');
  if (workflow.status !== 'active') {
    fail('an archived workflow cannot author a new version', 'workflow_not_active');
  }

  const definition = input.definition === undefined
    ? { steps: [] }
    : validateWorkflowDefinition(input.definition);

  const existing = await listWorkflowVersions(input.organizationId, workflowId);
  const nextOrdinal = existing.reduce((m, v) => (v.version > m ? v.version : m), 0) + 1;

  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .insert({
      organization_id: input.organizationId,
      workflow_id: workflowId,
      version: nextOrdinal,
      definition,
      created_by: optionalUuid(input.actorUserId, 'actorUserId', 'invalid_actor'),
    })
    .select(VERSION_COLUMNS)
    .single();

  if (res.error) translate(res.error, 'draft version creation failed');
  return toVersion(res.data as unknown as Row);
}

/**
 * Edit a draft's definition.
 *
 * SCOPED TO DRAFTS BY A PREDICATE THE DATABASE EVALUATES — `.eq('status','draft')`
 * — so a published version matches nothing and `null` comes back rather than an
 * edit being attempted and refused. The immutability guard refuses it too; this is
 * the polite layer, not the enforcing one.
 */
export async function updateDraftVersion(input: {
  organizationId: string;
  versionId: string;
  definition: unknown;
}): Promise<WorkflowVersion | null> {
  assertTenant(input.organizationId);
  const versionId = assertUuid(input.versionId, 'versionId', 'invalid_version');
  const definition = validateWorkflowDefinition(input.definition);

  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .update({ definition })
    .eq('organization_id', input.organizationId)
    .eq('id', versionId)
    .eq('status', 'draft')                 // only a draft is editable
    .select(VERSION_COLUMNS);

  if (res.error) translate(res.error, 'draft version update failed');
  const found = rows(res.data);
  return found.length ? toVersion(found[0]) : null;
}

/** One version, or null. */
export async function getWorkflowVersion(
  organizationId: string, versionId: string,
): Promise<WorkflowVersion | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(versionId, 'versionId', 'invalid_version'))
    .maybeSingle();
  if (res.error) translate(res.error, 'version read failed');
  return res.data ? toVersion(res.data as unknown as Row) : null;
}

/** Every version of a workflow, highest ordinal first. Ordering is for humans. */
export async function listWorkflowVersions(
  organizationId: string, workflowId: string,
): Promise<readonly WorkflowVersion[]> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('workflow_id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .order('version', { ascending: false });
  if (res.error) translate(res.error, 'version listing failed');
  return rows(res.data).map(toVersion);
}

/**
 * THE CURRENT VERSION — BOTTLENECK 1.
 *
 * `status = 'published'` is the entire definition of current, and the only
 * authoritative way to obtain it. This function does NOT order by `version`, does
 * NOT take a maximum, does NOT look at `created_at` and does NOT read the last
 * row inserted.
 *
 * Those alternatives are not merely less principled, they are WRONG in states
 * this module produces routinely:
 *
 *   publish v1, then author v2       -> MAX(version) returns the DRAFT v2
 *   publish v2, then archive v2      -> MAX(version) returns an ARCHIVED version
 *                                       when there is no current version at all
 *
 * `maybeSingle` is safe because `uq_workflow_versions_one_published` makes a
 * second published row unrepresentable; if that index were ever dropped this read
 * would start erroring rather than silently picking one, which is the right
 * failure.
 */
export async function getCurrentWorkflowVersion(
  organizationId: string, workflowId: string,
): Promise<WorkflowVersion | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('workflow_id', assertUuid(workflowId, 'workflowId', 'invalid_workflow'))
    .eq('status', 'published')             // THE STATUS PREDICATE. Never MAX(version).
    .maybeSingle();
  if (res.error) translate(res.error, 'current version read failed');
  return res.data ? toVersion(res.data as unknown as Row) : null;
}

export interface PublishResult {
  readonly version: WorkflowVersion;
  /** The version this publication superseded, when there was one. */
  readonly supersededVersionId: string | null;
}

/**
 * Publish a draft — the one atomic transition, through the RPC.
 *
 * See the module header for why this is a function and not two statements. The
 * database validates the workflow is active, the version belongs to the tenant and
 * is a draft, and the definition is structurally sound, then supersedes and
 * publishes inside one transaction.
 */
export async function publishWorkflowVersion(input: {
  organizationId: string;
  versionId: string;
  /** Required. The VERIFIED acting user; publication is always attributed. */
  actorUserId: string;
}): Promise<PublishResult> {
  assertTenant(input.organizationId);
  const versionId = assertUuid(input.versionId, 'versionId', 'invalid_version');
  const actorUserId = assertUuid(input.actorUserId, 'actorUserId', 'actor_required');

  const res = await supabase.rpc(PUBLISH_WORKFLOW_VERSION_FN, {
    p_organization_id: input.organizationId,
    p_version_id: versionId,
    p_published_by: actorUserId,
  });

  if (res.error) {
    const message = String((res.error as { message?: string }).message ?? '');
    if (message.includes('wf_publish:version_not_found')) {
      fail('no such workflow version in this tenant', 'version_not_found');
    }
    if (message.includes('wf_publish:workflow_not_active')) {
      fail('an archived workflow cannot publish a version', 'workflow_not_active');
    }
    if (message.includes('wf_publish:not_draft')) {
      fail('only a draft can be published', 'not_draft');
    }
    if (message.includes('wf_publish:no_steps')) {
      fail('a published version requires at least one step', 'no_steps');
    }
    if (message.includes('wf_publish:duplicate_step_key')) {
      fail('step keys must be unique within a version', 'duplicate_step_key');
    }
    if (message.includes('wf_publish:invalid_step')) {
      fail('every step requires a key, a known channel and a non-negative delay', 'invalid_step');
    }
    if (message.includes('wf_publish:actor_required')) {
      fail('publication requires an authenticated actor', 'actor_required');
    }
    translate(res.error, 'publication failed');
  }

  const returned = rows(res.data);
  const supersededVersionId = returned.length ? str(returned[0].out_superseded_id) : null;

  const version = await getWorkflowVersion(input.organizationId, versionId);
  if (!version) fail('the published version could not be read back', 'version_not_found');
  return { version, supersededVersionId };
}

/**
 * Archive a published version without replacing it.
 *
 * Scoped to `status = 'published'` by a database predicate: a draft is deleted by
 * being abandoned, and a superseded version is already terminal. After this the
 * workflow has NO current version, which is a legitimate state — authoring and
 * publishing a new one is how it gets another.
 */
export async function archiveWorkflowVersion(
  organizationId: string, versionId: string,
): Promise<WorkflowVersion | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(WORKFLOW_VERSIONS_TABLE)
    .update({ status: 'archived' })
    .eq('organization_id', organizationId)
    .eq('id', assertUuid(versionId, 'versionId', 'invalid_version'))
    .eq('status', 'published')
    .select(VERSION_COLUMNS);
  if (res.error) translate(res.error, 'version archival failed');
  const found = rows(res.data);
  return found.length ? toVersion(found[0]) : null;
}

/*
 * THERE IS DELIBERATELY NO DELETE, AND NO "EDIT PUBLISHED".
 *
 * No delete: archival preserves the record, matching every adjacent PI resource —
 * `prospect_campaigns`, `prospect_lists` and `prospect_icps` have no DELETE route
 * either. The only deletion path is a tenant cascade from `companies`, which must
 * remain possible and needs no function here. A Version referenced by a future
 * Execution Instance is protected by that referrer's `ON DELETE NO ACTION` key,
 * not by a trigger: the immutability guard is BEFORE UPDATE and cannot see a
 * DELETE at all.
 *
 * No edit-published: the database refuses it, and a function here that attempted
 * it would only produce a stack trace at a later line. Changing a published
 * process means publishing a new version.
 */
