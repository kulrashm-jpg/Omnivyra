/**
 * The community journey link — the ONE writer of `community_action_journey_links`
 * (20261231000003).
 *
 * WHO CREATES A LINK, AND WHY A PERSON DOES
 *   A `community` journey step names a person; the community engine acts on a
 *   stored action (platform + action type + target post/thread + text). Nothing in
 *   the repository maps a canonical person (`unified_persons` / `canonical_leads`)
 *   to a community platform identity, post or thread: `community_ai_actions`'s
 *   only actor link is `discovered_user_id` → `community_ai_discovered_users`,
 *   which carries no person, and profile-URL identity resolution is deferred
 *   (socialContactResolution.ts). So no producer can honestly draft an action
 *   for a step — its target and text would be invented. The link is therefore an
 *   OPERATOR assertion: "this existing drafted action is what that step does",
 *   made through an authenticated, tenant-checked route
 *   (pages/api/execution-instances/[id]/community-link.ts).
 *
 * WHAT A LINK DOES NOT DO
 *   It approves nothing (approval stays the approve route's, APPROVE_ACTIONS), it
 *   executes nothing (the community adapter does, under the engine's own gates and
 *   the request ledger's claim), and it copies no action content.
 *
 * INVARIANTS
 *   tenant       task and action are read tenant-filtered here, and the database
 *                re-proves both through composite foreign keys and the guard.
 *   support      the adapter's own classifier (`classifyCommunityAction`, i.e.
 *                SUPPORTED_COMMUNITY_ACTIONS + mode/DM/text rules) must accept the
 *                action now; the adapter re-checks at execution time.
 *   uniqueness   one action per task, one task per action — the database's
 *                unique constraints are the arbiter, not these pre-checks.
 *   idempotency  linking the same (task, action) again returns the existing link
 *                (`replayed: true`); a concurrent loser reads the winner's row.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { getExecutionTask, type ExecutionTask } from '../executionPlans/executionPlanStore';
import {
  classifyCommunityAction,
  COMMUNITY_JOURNEY_LINKS_TABLE,
  defaultCommunityDeps,
  type CommunityActionRow,
} from './communityEngineAdapter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Action statuses a link may be made to: not yet executing, not ended. */
export const LINKABLE_ACTION_STATUSES = ['pending', 'approved'] as const;

export class CommunityJourneyLinkError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CommunityJourneyLinkError';
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new CommunityJourneyLinkError(message, code);
}

export interface CommunityJourneyLink {
  readonly id: string;
  readonly organizationId: string;
  readonly executionTaskId: string;
  readonly executionInstanceId: string;
  readonly communityActionId: string;
  readonly linkedBy: string | null;
  readonly createdAt: string | null;
}

type Row = Record<string, unknown>;
const LINK_COLUMNS = 'id, organization_id, execution_task_id, execution_instance_id, community_action_id, linked_by, created_at';

const toLink = (r: Row): CommunityJourneyLink => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  executionTaskId: String(r.execution_task_id),
  executionInstanceId: String(r.execution_instance_id),
  communityActionId: String(r.community_action_id),
  linkedBy: typeof r.linked_by === 'string' ? r.linked_by : null,
  createdAt: typeof r.created_at === 'string' ? r.created_at : null,
});

/** Database errors, by consequence. Guard messages are `cajl:<code>`. */
export function translateLinkError(error: unknown): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (code === '23505') {
    if (message.includes('community_action_journey_links_task_unique')) fail('that execution task is already linked', 'task_already_linked');
    if (message.includes('community_action_journey_links_action_unique')) fail('that community action is already linked to another execution task', 'action_already_linked');
    fail('that link already exists', 'already_exists');
  }
  if (code === '23503') fail('the task or action does not exist in this tenant', 'not_found');
  const m = /cajl:([a-z_]+)/.exec(message);
  if (m) fail(`refused by the link guard: ${m[1]}`, m[1]);
  fail('community journey link failed', 'link_error');
}

export interface LinkStoreDeps {
  readLinkByTask(organizationId: string, executionTaskId: string): Promise<CommunityJourneyLink | null>;
  listLinksByInstance(organizationId: string, executionInstanceId: string): Promise<CommunityJourneyLink[]>;
  readTask(organizationId: string, executionTaskId: string): Promise<ExecutionTask | null>;
  /** Tenant-filtered. null = none for this tenant; undefined = unreadable. */
  readAction(organizationId: string, actionId: string): Promise<CommunityActionRow | null | undefined>;
  /** Insert; returns the row or the database error. */
  insertLink(row: {
    organization_id: string; execution_task_id: string; execution_instance_id: string;
    community_action_id: string; linked_by: string | null;
  }): Promise<{ data: CommunityJourneyLink | null; error: unknown }>;
}

export const defaultLinkStoreDeps: LinkStoreDeps = {
  async readLinkByTask(organizationId, executionTaskId) {
    const res = await ownedDbTable(COMMUNITY_JOURNEY_LINKS_TABLE)
      .select(LINK_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('execution_task_id', executionTaskId)
      .maybeSingle();
    if (res.error) translateLinkError(res.error);
    return res.data ? toLink(res.data as unknown as Row) : null;
  },
  async listLinksByInstance(organizationId, executionInstanceId) {
    const res = await ownedDbTable(COMMUNITY_JOURNEY_LINKS_TABLE)
      .select(LINK_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('execution_instance_id', executionInstanceId)
      .order('created_at', { ascending: true });
    if (res.error) translateLinkError(res.error);
    return (Array.isArray(res.data) ? res.data as unknown as Row[] : []).map(toLink);
  },
  readTask: getExecutionTask,
  readAction: (org, id) => defaultCommunityDeps.readAction(org, id),
  async insertLink(row) {
    const res = await ownedDbTable(COMMUNITY_JOURNEY_LINKS_TABLE).insert(row).select(LINK_COLUMNS).single();
    return { data: res.data ? toLink(res.data as unknown as Row) : null, error: res.error ?? null };
  },
};

function assertUuid(v: unknown, name: string, code: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) fail(`${name} must be a uuid`, code);
  return v;
}

export async function getLinkForTask(
  organizationId: string, executionTaskId: string, deps: LinkStoreDeps = defaultLinkStoreDeps,
): Promise<CommunityJourneyLink | null> {
  assertUuid(organizationId, 'organizationId', 'invalid_org');
  assertUuid(executionTaskId, 'executionTaskId', 'invalid_task');
  return deps.readLinkByTask(organizationId, executionTaskId);
}

export async function listInstanceLinks(
  organizationId: string, executionInstanceId: string, deps: LinkStoreDeps = defaultLinkStoreDeps,
): Promise<CommunityJourneyLink[]> {
  assertUuid(organizationId, 'organizationId', 'invalid_org');
  assertUuid(executionInstanceId, 'executionInstanceId', 'invalid_instance');
  return deps.listLinksByInstance(organizationId, executionInstanceId);
}

/**
 * Link one prepared `community` execution task to one existing, tenant-owned,
 * supported, not-yet-executing community action. Idempotent; never approves or
 * executes anything.
 */
export async function linkCommunityAction(
  input: {
    organizationId: string;
    executionInstanceId: string;
    executionTaskId: string;
    communityActionId: string;
    linkedBy: string | null;
  },
  deps: LinkStoreDeps = defaultLinkStoreDeps,
): Promise<{ link: CommunityJourneyLink; replayed: boolean }> {
  const org = assertUuid(input.organizationId, 'organizationId', 'invalid_org');
  const instanceId = assertUuid(input.executionInstanceId, 'executionInstanceId', 'invalid_instance');
  const taskId = assertUuid(input.executionTaskId, 'executionTaskId', 'invalid_task');
  const actionId = assertUuid(input.communityActionId, 'communityActionId', 'invalid_action');

  const replay = (link: CommunityJourneyLink): { link: CommunityJourneyLink; replayed: boolean } => {
    if (link.executionInstanceId !== instanceId) fail('no such execution task for this run', 'task_not_found');
    if (link.communityActionId !== actionId) fail('that execution task is already linked to a different community action', 'task_already_linked');
    return { link, replayed: true };
  };

  // Replay first (cheap retry). NOT the uniqueness guarantee — the constraint is.
  const existing = await deps.readLinkByTask(org, taskId);
  if (existing !== null) return replay(existing);

  const task = await deps.readTask(org, taskId);
  if (task === null || task.executionInstanceId !== instanceId) fail('no such execution task for this run', 'task_not_found');
  if (task.channel !== 'community') fail('only a community-channel step can execute a community action', 'task_not_community');
  if (task.state !== 'prepared') fail('that execution task is not prepared', 'task_not_prepared');

  const action = await deps.readAction(org, actionId);
  if (action === undefined) fail('the community action could not be read', 'action_unreadable');
  if (action === null) fail('no such community action in this tenant', 'action_not_found');
  if (action.organization_id !== org || action.tenant_id !== org) fail('that community action belongs to another tenant', 'cross_tenant');

  const support = classifyCommunityAction(action);
  if (support.supported === false) fail(`${support.code}: ${support.reason}`, 'unsupported_action');
  const status = String(action.status ?? '');
  if (!(LINKABLE_ACTION_STATUSES as readonly string[]).includes(status)) {
    fail(`a community action in "${status || 'no'}" status cannot be linked; only pending or approved actions`, 'action_not_linkable');
  }

  const ins = await deps.insertLink({
    organization_id: org,
    execution_task_id: taskId,
    execution_instance_id: instanceId,
    community_action_id: actionId,
    linked_by: typeof input.linkedBy === 'string' && input.linkedBy.trim() !== '' ? input.linkedBy.trim().slice(0, 200) : null,
  });
  if (ins.error) {
    const code = String((ins.error as { code?: string }).code ?? '');
    const message = String((ins.error as { message?: string }).message ?? '');
    if (code === '23505' && message.includes('community_action_journey_links_task_unique')) {
      const winner = await deps.readLinkByTask(org, taskId);
      if (winner !== null) return replay(winner);
    }
    translateLinkError(ins.error);
  }
  if (!ins.data) fail('the link did not persist', 'link_error');
  return { link: ins.data, replayed: false };
}
