/**
 * Orchestration, Follow-up E — operator warnings for unresolved uncertain communications.
 *
 * An `uncertain` engine request (WhatsApp, community) may already have reached the person:
 * the platform could not confirm what the provider did, and nothing resends it. When a
 * person ENDS a run that holds one, or ENROLS a person again who has one from an earlier
 * run, they are shown each such communication and must acknowledge it before the operation
 * completes; the acknowledgement is recorded durably (migration 20270129000002).
 *
 * ACKNOWLEDGEMENT IS NOT APPROVAL. It records only that the operator saw the possible prior
 * send. It authorizes no send, resolves nothing (the request stays `uncertain`; this module
 * never writes the ledger), marks nothing sent or delivered, and bypasses no check: consent,
 * suppression, opt-out, approval, frequency, tenant policy and the engine claim still decide
 * every later step.
 *
 * BINDING. The warning carries `acknowledgementKey`, a SHA-256 over the tenant, the
 * operation, the run it anchors on (end_run: the run being ended; reenrol: the person's
 * latest run), EVERY run of the person (reenrol: so any new run changes the key even when
 * two runs share a creation time, as rows written in one transaction do), the target
 * campaign and workflow (reenrol), the ACTING person, the sorted request ids and whether the
 * history was unreadable. The caller sends it back with the
 * operation; it is recomputed from the database at that moment and must match exactly. So
 * an acknowledgement is never global: another operation, another operator, a later run of
 * the person or a changed set of communications computes a different key and is warned
 * again. A stored row never authorizes anything by itself; only the key sent with THIS
 * request, matched against THIS moment's warning, lets the operation continue.
 *
 * IDEMPOTENT. A repeat of the same acknowledged operation converges on one row (UNIQUE on
 * the tenant and key; a concurrent duplicate is a 23505, read as already recorded).
 *
 * FAILS SAFE.
 *   - reenrol: a history that cannot be read refuses the enrolment (`refuse`), because
 *     starting a journey is the direction that could contact the person again.
 *   - end_run: a history that cannot be read is itself the warning (`warn`): the operator
 *     acknowledges that it could not be checked and the run ends. Refusing would keep the
 *     run alive, and a live run is the one that can still contact the person.
 *   - an acknowledgement that cannot be recorded refuses the operation (503): it never
 *     completes without its record.
 *
 * SCOPE. Ledger engines only. WS-3 email is Outreach's and is read only through the EM-2
 * contract (outreach_email_dispatch_states), which is approved but not built; email is not
 * warned about here. Non-contact channels (journeyPolicy NON_CONTACT_CHANNELS) are not
 * communications to the person and are not warned about. Tenant first on every read.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { NON_CONTACT_CHANNELS } from './journeyPolicy';
import { listSubjectExecutionInstances, type SubjectKind } from '../executionInstances/executionInstanceStore';

export const UNCERTAIN_ACKNOWLEDGEMENTS_TABLE = 'execution_uncertain_acknowledgements';

export type AcknowledgedOperation = 'end_run' | 'reenrol';

export type UncertaintyScope =
  | { readonly kind: 'run'; readonly executionInstanceId: string }
  | {
    readonly kind: 'subject';
    readonly subjectKind: string;
    readonly subjectId: string;
    readonly campaignId: string;
    readonly workflowId: string;
  };

/** One unresolved uncertain communication, as the operator is shown it. No personal data. */
export interface UncertainCommunication {
  readonly requestId: string;
  readonly executionTaskId: string;
  /** The run that holds it (for reenrol, the earlier run). */
  readonly executionInstanceId: string;
  readonly engine: string;
  readonly channel: string | null;
  /** When it was first queued (D-2 `queued_at`); null when the ledger has no readable time. */
  readonly queuedAt: string | null;
  /** The engine's own reference (a broadcast or community action id), when it has one. */
  readonly reference: string | null;
}

export interface UncertainCommunicationWarning {
  readonly operation: AcknowledgedOperation;
  /** end_run: the run being ended. reenrol: the person's latest run. */
  readonly executionInstanceId: string;
  readonly communications: readonly UncertainCommunication[];
  readonly historyUnreadable: boolean;
  readonly acknowledgementKey: string;
  readonly message: string;
  /** Said explicitly, so no client can present the acknowledgement as an approval. */
  readonly acknowledgementIsNotApproval: true;
}

export type AcknowledgementCheck =
  | { readonly ok: true; readonly acknowledged: null }
  | { readonly ok: true; readonly acknowledged: { readonly id: string | null; readonly repeated: boolean } }
  | { readonly ok: false; readonly status: 409; readonly code: 'uncertain_communication_unacknowledged' | 'acknowledgement_stale'; readonly error: string; readonly warning: UncertainCommunicationWarning }
  | { readonly ok: false; readonly status: 503; readonly code: 'uncertainty_history_unreadable' | 'acknowledgement_unrecorded'; readonly error: string }
  | { readonly ok: false; readonly status: 403; readonly code: 'acknowledging_person_unknown'; readonly error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TASKS = 1000;

class HistoryUnreadable extends Error {
  readonly code = 'uncertainty_history_unreadable';
}
const unreadable = (what: string) => new HistoryUnreadable(`${what} could not be read`);

const readableTime = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v)) ? v : null;

interface History {
  /** The run the warning anchors on; null when the person has no run at all (reenrol). */
  readonly anchorInstanceId: string | null;
  /** end_run: the run itself. reenrol: every run of the person (bound into the key). */
  readonly runIds: readonly string[];
  readonly communications: UncertainCommunication[];
}

/** The tasks in scope, tenant first; contact channels only. */
async function tasksInScope(organizationId: string, scope: UncertaintyScope): Promise<Map<string, { channel: string; executionInstanceId: string }>> {
  let q = ownedDbTable('execution_tasks')
    .select('id, channel, execution_instance_id')
    .eq('organization_id', organizationId);                      // TENANT FIRST
  q = scope.kind === 'run'
    ? q.eq('execution_instance_id', scope.executionInstanceId)
    : q.eq('subject_kind', scope.subjectKind).eq('subject_id', scope.subjectId);
  const res = await q.limit(MAX_TASKS);
  if (res.error || !Array.isArray(res.data)) throw unreadable('the tasks in scope');
  if (res.data.length >= MAX_TASKS) throw unreadable('the tasks in scope (too many to read whole)');
  const out = new Map<string, { channel: string; executionInstanceId: string }>();
  for (const t of res.data as Array<Record<string, unknown>>) {
    if (typeof t.id !== 'string' || typeof t.execution_instance_id !== 'string') throw unreadable('a task in scope');
    const channel = String(t.channel ?? '');
    if ((NON_CONTACT_CHANNELS as readonly string[]).includes(channel)) continue;
    out.set(t.id, { channel, executionInstanceId: t.execution_instance_id });
  }
  return out;
}

/** The person's latest run in this tenant (reenrol's anchor), or null when there is none. */
const MAX_RUNS = 1000;

/** Every run of the person in this tenant, newest first (reenrol's anchor is the first). */
async function runsOfSubject(organizationId: string, subjectKind: string, subjectId: string): Promise<string[]> {
  // The instance store owns execution_instances (PI-033); it throws on a failed read, tenant first.
  const runs = await listSubjectExecutionInstances(organizationId, subjectKind as SubjectKind, subjectId, { limit: MAX_RUNS });
  if (runs.length >= MAX_RUNS) throw unreadable('the person\'s runs (too many to read whole)');
  return runs.map((r) => {
    if (typeof r.id !== 'string' || r.id === '') throw unreadable('a run of the person');
    return r.id;
  });
}

async function readHistory(organizationId: string, scope: UncertaintyScope): Promise<History> {
  const runIds = scope.kind === 'run'
    ? [scope.executionInstanceId]
    : await runsOfSubject(organizationId, scope.subjectKind, scope.subjectId);
  const anchorInstanceId = runIds[0] ?? null;
  if (anchorInstanceId === null) return { anchorInstanceId: null, runIds, communications: [] };

  const tasks = await tasksInScope(organizationId, scope);
  if (tasks.size === 0) return { anchorInstanceId, runIds, communications: [] };
  const res = await ownedDbTable('execution_engine_requests')
    .select('id, execution_task_id, engine, queued_at, external_ref')
    .eq('organization_id', organizationId)                       // TENANT FIRST
    .in('execution_task_id', [...tasks.keys()])
    .eq('state', 'uncertain');
  if (res.error || !Array.isArray(res.data)) throw unreadable('the engine request ledger');
  const communications: UncertainCommunication[] = [];
  for (const r of res.data as Array<Record<string, unknown>>) {
    const task = typeof r.execution_task_id === 'string' ? tasks.get(r.execution_task_id) : undefined;
    if (typeof r.id !== 'string' || task === undefined) throw unreadable('an uncertain request');
    communications.push({
      requestId: r.id,
      executionTaskId: String(r.execution_task_id),
      executionInstanceId: task.executionInstanceId,
      engine: String(r.engine ?? 'unknown'),
      channel: task.channel === '' ? null : task.channel,
      queuedAt: readableTime(r.queued_at),
      reference: typeof r.external_ref === 'string' && r.external_ref !== '' ? r.external_ref : null,
    });
  }
  communications.sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));
  return { anchorInstanceId, runIds, communications };
}

export function acknowledgementKeyFor(input: {
  organizationId: string;
  operation: AcknowledgedOperation;
  anchorInstanceId: string;
  runIds: readonly string[];
  campaignId: string | null;
  workflowId: string | null;
  actorUserId: string;
  requestIds: readonly string[];
  historyUnreadable: boolean;
}): string {
  const material = JSON.stringify([
    'orch.uncertain_ack.v1',
    input.organizationId,
    input.operation,
    input.anchorInstanceId,
    [...input.runIds].sort(),
    input.campaignId,
    input.workflowId,
    input.actorUserId.toLowerCase(),
    [...input.requestIds].sort(),
    input.historyUnreadable,
  ]);
  return createHash('sha256').update(material).digest('hex');
}

const MESSAGES: Readonly<Record<AcknowledgedOperation, string>> = {
  end_run:
    'This run holds a communication whose outcome could not be confirmed: it may already have been sent to the person. '
    + 'Ending the run does not resolve it, and it is never resent automatically. Another journey could contact the person again '
    + 'and create a duplicate. Acknowledging records that you have seen this; it approves nothing, sends nothing and resolves nothing.',
  reenrol:
    'An earlier run sent this person a communication whose outcome could not be confirmed: it may already have been sent. '
    + 'Enrolling them again could contact them a second time. Acknowledging records that you have seen this; it approves '
    + 'nothing, and consent, suppression, opt-out, approval, frequency and every other check still apply to the new run.',
};
const UNREADABLE_MESSAGE =
  'The history of uncertain communications for this run could not be read, so a possible earlier send cannot be ruled out. '
  + 'Acknowledging records that you ended the run without that check; it approves nothing and resolves nothing.';

/**
 * Checks for unresolved uncertain communications before `operation`, and, when the caller
 * sends the matching key, records the acknowledgement durably. `ok: true` means the
 * operation may continue (nothing to warn about, or acknowledged and recorded); every other
 * answer means it must not.
 *
 * `record: false` previews (a dry run): it warns and never writes.
 */
export async function checkUncertainAcknowledgement(input: {
  organizationId: string;
  operation: AcknowledgedOperation;
  scope: UncertaintyScope;
  actorUserId: unknown;
  acknowledgementKey: unknown;
  onUnreadable: 'warn' | 'refuse';
  record?: boolean;
}): Promise<AcknowledgementCheck> {
  let history: History;
  let historyUnreadable = false;
  try {
    history = await readHistory(input.organizationId, input.scope);
  } catch {
    // Any failure to read is an unreadable history: never read as "nothing to warn about".
    if (input.onUnreadable === 'refuse' || input.scope.kind !== 'run') {
      return {
        ok: false, status: 503, code: 'uncertainty_history_unreadable',
        error: 'the person\'s uncertain communications could not be checked; nothing was done (fail closed)',
      };
    }
    historyUnreadable = true;
    history = { anchorInstanceId: input.scope.executionInstanceId, runIds: [input.scope.executionInstanceId], communications: [] };
  }
  if (!historyUnreadable && history.communications.length === 0) return { ok: true, acknowledged: null };
  const anchorInstanceId = history.anchorInstanceId as string;

  const actor = typeof input.actorUserId === 'string' && UUID.test(input.actorUserId) ? input.actorUserId : null;
  const campaignId = input.scope.kind === 'subject' ? input.scope.campaignId : null;
  const workflowId = input.scope.kind === 'subject' ? input.scope.workflowId : null;
  // Without a known person there is nothing to bind to: warn with a key no one can send.
  const acknowledgementKey = actor === null ? '' : acknowledgementKeyFor({
    organizationId: input.organizationId,
    operation: input.operation,
    anchorInstanceId,
    runIds: history.runIds,
    campaignId,
    workflowId,
    actorUserId: actor,
    requestIds: history.communications.map((c) => c.requestId),
    historyUnreadable,
  });
  const warning: UncertainCommunicationWarning = {
    operation: input.operation,
    executionInstanceId: anchorInstanceId,
    communications: history.communications,
    historyUnreadable,
    acknowledgementKey,
    message: historyUnreadable ? UNREADABLE_MESSAGE : MESSAGES[input.operation],
    acknowledgementIsNotApproval: true,
  };

  const sent = typeof input.acknowledgementKey === 'string' ? input.acknowledgementKey.trim().toLowerCase() : null;
  if (sent === null || sent === '') {
    return { ok: false, status: 409, code: 'uncertain_communication_unacknowledged', error: 'a possible earlier send must be acknowledged first; nothing was done', warning };
  }
  if (actor === null) {
    return { ok: false, status: 403, code: 'acknowledging_person_unknown', error: 'only an authenticated person can acknowledge; nothing was done' };
  }
  if (sent !== acknowledgementKey) {
    return { ok: false, status: 409, code: 'acknowledgement_stale', error: 'the acknowledgement does not match this operation as it stands now; review the current warning; nothing was done', warning };
  }
  if (input.record === false) return { ok: true, acknowledged: { id: null, repeated: false } };

  let inserted: { data: unknown; error: unknown };
  try {
    inserted = await ownedDbTable(UNCERTAIN_ACKNOWLEDGEMENTS_TABLE)
      .insert({
        organization_id: input.organizationId,
        operation: input.operation,
        execution_instance_id: anchorInstanceId,
        campaign_id: campaignId,
        workflow_id: workflowId,
        actor_user_id: actor,
        communications: history.communications,
        history_unreadable: historyUnreadable,
        acknowledgement_key: acknowledgementKey,
      })
      .select('id') as unknown as { data: unknown; error: unknown };
  } catch (e) {
    inserted = { data: null, error: e };
  }
  if (!inserted.error) {
    const row = Array.isArray(inserted.data) ? inserted.data[0] as Record<string, unknown> | undefined : undefined;
    return { ok: true, acknowledged: { id: typeof row?.id === 'string' ? row.id : null, repeated: false } };
  }
  if ((inserted.error as { code?: unknown }).code === '23505') {
    // The same acknowledgement, already recorded (a retry, or a concurrent duplicate): confirm it.
    const existing = await ownedDbTable(UNCERTAIN_ACKNOWLEDGEMENTS_TABLE)
      .select('id')
      .eq('organization_id', input.organizationId)               // TENANT FIRST
      .eq('acknowledgement_key', acknowledgementKey)
      .limit(1);
    const row = !existing.error && Array.isArray(existing.data) ? existing.data[0] as Record<string, unknown> | undefined : undefined;
    if (row !== undefined && typeof row.id === 'string') return { ok: true, acknowledged: { id: row.id, repeated: true } };
  }
  return { ok: false, status: 503, code: 'acknowledgement_unrecorded', error: 'the acknowledgement could not be recorded; nothing was done' };
}

/** The HTTP answer for a check that stops the operation. */
export function acknowledgementRefusalBody(check: Exclude<AcknowledgementCheck, { ok: true }>): Record<string, unknown> {
  return 'warning' in check
    ? { error: check.error, code: check.code, warning: check.warning }
    : { error: check.error, code: check.code };
}
