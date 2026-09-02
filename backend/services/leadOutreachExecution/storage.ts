/**
 * WS-3 Milestone-1 — durable storage for Lead Outreach Execution.
 *
 * PERSISTENCE ONLY. This module reads and writes rows. It does not dispatch,
 * translate, evaluate governance, enqueue, retry, or contact any external
 * system — none of those exist yet, and none may be added here.
 *
 * Tenant isolation reuses the existing model unchanged: every table access goes
 * through `ownedDbTable`, and EVERY query is company-scoped. There is no new
 * authorization framework and no new tenancy model. Route-level access control
 * remains `enforceCompanyAccess`'s job; this layer never widens it.
 *
 * IMMUTABILITY. The version fields and the five audit tables are protected by
 * database triggers, not by this module's discipline. That is deliberate: an
 * audit record a later bug can silently rewrite is not an audit record. This
 * layer therefore offers no update or delete surface for them at all — the
 * absence of those functions is part of the design.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type {
  BusinessOutcomeType,
  DeliveryStatus,
  NewOutreachTask,
  OutreachApproval,
  OutreachAttempt,
  OutreachDecision,
  OutreachDeliveryEvidence,
  OutreachOutcome,
  OutreachTask,
  OutreachTaskStatus,
} from './types';
import { isDeliveryStatus, isOutreachTaskStatus } from './lifecycle';

export const OUTREACH_TASKS_TABLE = 'outreach_tasks';
export const OUTREACH_APPROVALS_TABLE = 'outreach_approvals';
export const OUTREACH_ATTEMPTS_TABLE = 'outreach_attempts';
export const OUTREACH_DELIVERY_TABLE = 'outreach_delivery_evidence';
export const OUTREACH_OUTCOMES_TABLE = 'outreach_outcomes';
export const OUTREACH_DECISIONS_TABLE = 'outreach_decisions';

/** Uniform result. Callers get an error string, never a thrown exception. */
export type WriteResult<T> = { ok: boolean; data?: T; error?: string };

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Canonicalize a stored timestamp to ISO-8601.
 *
 * `timestamptz` round-trips as `2026-08-05 12:00:00+00`, not
 * `2026-08-05T12:00:00.000Z` — the same instant in a different representation.
 * The domain model declares these fields ISO-8601, so without this a consumer
 * comparing a read-back `materializedAt` against the plan's `generatedAt` by
 * string equality would get a false negative on values that are in fact equal.
 * Unparseable input is returned unchanged rather than discarded.
 */
const isoStr = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const errText = (e: unknown): string =>
  String((e as { message?: string } | null)?.message ?? e ?? 'unknown database error').slice(0, 300);

/**
 * Never throws — a transport failure is normalized into the same `{ error }`
 * shape PostgREST returns, matching the discipline WS-2 established for the
 * capture path.
 */
async function safeDb<T>(op: () => PromiseLike<{ data?: T; error?: unknown }>): Promise<{ data: T | null; error: unknown | null }> {
  try {
    const res = await op();
    return { data: (res?.data ?? null) as T | null, error: res?.error ?? null };
  } catch (e) {
    return { data: null, error: e ?? new Error('unknown database failure') };
  }
}

// ── mappers ─────────────────────────────────────────────────────────────────

export function rowToOutreachTask(row: unknown): OutreachTask | null {
  const r = obj(row);
  const companyId = str(r.company_id);
  const leadId = str(r.lead_id);
  const planTaskId = str(r.plan_task_id);
  if (!companyId || !leadId || !planTaskId) return null;

  const status = isOutreachTaskStatus(r.status) ? r.status : 'pending';
  const delivery = isDeliveryStatus(r.delivery_status) ? r.delivery_status : null;

  return {
    id: str(r.id),
    companyId,
    leadId,
    planTaskId,
    // A3 / Contract 12. Absent on a row read before the migration applied, and
    // legitimately null on an unanchored task — both map to null, which the
    // anchor resolver treats identically: fall through to the lead.
    personId: str(r.person_id),
    taskOrder: num(r.task_order),
    kind: str(r.kind),
    action: str(r.action),
    channel: str(r.channel),
    dependsOnPlanTaskId: str(r.depends_on_plan_task_id),
    estimatedDelayHours: num(r.estimated_delay_hours),
    confidence: num(r.confidence),
    explanation: str(r.explanation),
    status,
    deliveryStatus: delivery,
    requiresApproval: r.requires_approval === true,
    plannerVersion: str(r.planner_version) ?? '',
    translationVersion: str(r.translation_version) ?? '',
    governanceVersion: str(r.governance_version) ?? '',
    executionRuntimeVersion: str(r.execution_runtime_version) ?? '',
    materializedAt: isoStr(r.materialized_at) ?? '',
    createdAt: isoStr(r.created_at),
    updatedAt: isoStr(r.updated_at),
  };
}

const taskToRow = (t: NewOutreachTask): Row => ({
  company_id: t.companyId,
  lead_id: t.leadId,
  plan_task_id: t.planTaskId,
  // A3 / Contract 12. Optional at materialisation: a WS-2 plan carries a lead,
  // not a canonical person. The composite foreign key refuses a value from
  // another tenant, so no pre-check is written here — between a check and the
  // insert the world can change, and a foreign key cannot.
  person_id: t.personId ?? null,
  task_order: t.taskOrder ?? null,
  kind: t.kind ?? null,
  action: t.action ?? null,
  channel: t.channel ?? null,
  depends_on_plan_task_id: t.dependsOnPlanTaskId ?? null,
  estimated_delay_hours: t.estimatedDelayHours ?? null,
  confidence: t.confidence ?? null,
  explanation: t.explanation ?? null,
  status: t.status ?? 'pending',
  delivery_status: t.deliveryStatus ?? null,
  requires_approval: t.requiresApproval === true,
  planner_version: t.plannerVersion,
  translation_version: t.translationVersion,
  governance_version: t.governanceVersion,
  execution_runtime_version: t.executionRuntimeVersion,
  materialized_at: t.materializedAt,
});

// ── tasks ───────────────────────────────────────────────────────────────────

/**
 * Persist a materialised task.
 *
 * Idempotent by construction: `(company_id, lead_id, plan_task_id)` is unique,
 * so a repeated materialisation of the same logical task is REJECTED by the
 * database rather than creating a duplicate. Callers receive
 * `duplicate: true` — an expected outcome when a regenerated plan revisits a
 * task that already exists, not a failure.
 */
export async function insertOutreachTask(task: NewOutreachTask): Promise<WriteResult<OutreachTask> & { duplicate?: boolean }> {
  const res = await safeDb<Row>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE).insert(taskToRow(task)).select('*').single(),
  );
  if (res.error) {
    const code = String((res.error as { code?: string }).code ?? '');
    if (code === '23505') return { ok: false, duplicate: true, error: 'task already materialised' };
    return { ok: false, error: errText(res.error) };
  }
  const mapped = rowToOutreachTask(res.data);
  return mapped ? { ok: true, data: mapped } : { ok: false, error: 'insert returned an unusable row' };
}

/** Read one task by its idempotency identity. Company-scoped. */
export async function getOutreachTask(companyId: string, leadId: string, planTaskId: string): Promise<OutreachTask | null> {
  const res = await safeDb<Row>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('lead_id', leadId)
      .eq('plan_task_id', planTaskId)
      .maybeSingle(),
  );
  return res.error ? null : rowToOutreachTask(res.data);
}

/** List a lead's tasks. Company-scoped; deterministic order. */
export async function listOutreachTasksForLead(companyId: string, leadId: string): Promise<OutreachTask[]> {
  const res = await safeDb<Row[]>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('lead_id', leadId)
      .order('task_order', { ascending: true })
      .order('plan_task_id', { ascending: true }),
  );
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data.map(rowToOutreachTask).filter((t): t is OutreachTask => t !== null);
}

/**
 * Record a task's CURRENT state.
 *
 * Deliberately narrow: only `status` and `deliveryStatus` are writable. There
 * is no path here to alter identity or provenance — and the database rejects it
 * anyway. This function performs no transition logic and enforces no ordering;
 * legality is `lifecycle.isTransitionAllowed`'s job and executing transitions
 * belongs to a later milestone.
 */
export async function setOutreachTaskState(
  companyId: string,
  taskId: string,
  next: { status?: OutreachTaskStatus; deliveryStatus?: DeliveryStatus | null },
): Promise<WriteResult<null>> {
  const patch: Row = { updated_at: new Date().toISOString() };
  if (next.status !== undefined) patch.status = next.status;
  if (next.deliveryStatus !== undefined) patch.delivery_status = next.deliveryStatus;

  const res = await safeDb(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE).update(patch).eq('company_id', companyId).eq('id', taskId),
  );
  return res.error ? { ok: false, error: errText(res.error) } : { ok: true };
}

/**
 * A3 / Contract 12 — anchor a task to a canonical person, or unanchor it.
 *
 * The ONLY write path to `outreach_tasks.person_id`, deliberately separate from
 * `setOutreachTaskState`: state is lifecycle and moves constantly, identity is a
 * different kind of fact and should not be settable as a side effect of a status
 * change.
 *
 * TENANT SAFETY IS THE DATABASE'S, NOT A PRE-CHECK'S. `company_id` scopes the
 * row being updated, and `outreach_tasks_person_tenant_fk` refuses a person from
 * another tenant with `23503` — reported here as the tenant error it is rather
 * than as a raw SQLSTATE. A SELECT-then-UPDATE would be a race, not a guard:
 * between the check and the write the person could move or vanish, and a
 * composite foreign key cannot.
 *
 * `changed: false` is a legitimate outcome — no such task for this tenant — and
 * is NOT reported as an error, matching `transitionOutreachTaskState`.
 *
 * Passing `null` unanchors, which is legal by design: identity resolution can
 * be withdrawn as well as asserted, and the task must remain usable either way.
 */
export async function setOutreachTaskPersonId(
  companyId: string,
  taskId: string,
  personId: string | null,
): Promise<WriteResult<null> & { changed: boolean }> {
  const res = await safeDb<Row[]>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE)
      .update({ person_id: personId, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('id', taskId)
      .select('id'),
  );
  if (res.error) {
    const code = String((res.error as { code?: string }).code ?? '');
    if (code === '23503') {
      return { ok: false, changed: false, error: 'no such person in this tenant — a task may only anchor to its own tenant’s person' };
    }
    return { ok: false, changed: false, error: errText(res.error) };
  }
  const changed = Array.isArray(res.data) ? res.data.length > 0 : false;
  return { ok: true, changed };
}

/**
 * Compare-and-set on a task's status. WS-3 M3.
 *
 * The ONLY race-free way to move a task between states. A read-then-write would
 * let two approvers both observe `awaiting_approval` and both proceed; here the
 * `status = expected` predicate is evaluated by the database, so exactly one
 * caller can win and the loser is told the state it actually found.
 *
 * `changed: false` is a legitimate, expected outcome — a lost race or a
 * repeated decision — and is NOT reported as an error.
 */
export async function transitionOutreachTaskState(
  companyId: string,
  taskId: string,
  from: OutreachTaskStatus,
  to: OutreachTaskStatus,
): Promise<WriteResult<null> & { changed: boolean }> {
  const res = await safeDb<Row[]>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE)
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('id', taskId)
      .eq('status', from)
      .select('id'),
  );
  if (res.error) return { ok: false, changed: false, error: errText(res.error) };
  const changed = Array.isArray(res.data) ? res.data.length > 0 : false;
  return { ok: true, changed };
}

/** Read one task by its primary id. Company-scoped. */
export async function getOutreachTaskById(companyId: string, taskId: string): Promise<OutreachTask | null> {
  const res = await safeDb<Row>(() =>
    ownedDbTable(OUTREACH_TASKS_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('id', taskId)
      .maybeSingle(),
  );
  return res.error ? null : rowToOutreachTask(res.data);
}

// ── append-only audit writers ───────────────────────────────────────────────
//
// Each appends one immutable row. There is intentionally NO update or delete
// counterpart anywhere in this module.

export async function appendApproval(record: Omit<OutreachApproval, 'id'>): Promise<WriteResult<null>> {
  const res = await safeDb(() =>
    ownedDbTable(OUTREACH_APPROVALS_TABLE).insert({
      company_id: record.companyId,
      task_id: record.taskId,
      decision: record.decision,
      approver_user_id: record.approverUserId ?? null,
      reason: record.reason ?? null,
      notes: record.notes ?? null,
      missing_information: record.missingInformation ?? [],
      decided_at: record.decidedAt,
    }),
  );
  return res.error ? { ok: false, error: errText(res.error) } : { ok: true };
}

/**
 * Append one dispatch attempt.
 *
 * Returns the created row's id: WS-3 M5A ties delivery evidence and the
 * internal work item to the exact attempt that produced them, so "why does this
 * record exist" is always answerable.
 */
export async function appendAttempt(record: Omit<OutreachAttempt, 'id'>): Promise<WriteResult<{ id: string | null }>> {
  const res = await safeDb<Row>(() =>
    ownedDbTable(OUTREACH_ATTEMPTS_TABLE)
      .insert({
        company_id: record.companyId,
        task_id: record.taskId,
        attempt_number: record.attemptNumber,
        channel: record.channel ?? null,
        transport: record.transport ?? null,
        governance_version: record.governanceVersion ?? null,
        execution_runtime_version: record.executionRuntimeVersion ?? null,
        limiter_layer: record.limiterLayer ?? null,
        idempotency_key: record.idempotencyKey ?? null,
        outcome: record.outcome ?? null,
        error: record.error ?? null,
        started_at: record.startedAt,
        completed_at: record.completedAt ?? null,
      })
      .select('id')
      .single(),
  );
  if (res.error) return { ok: false, error: errText(res.error) };
  return { ok: true, data: { id: str((res.data as Row | null)?.id) } };
}

/**
 * Append one delivery fact.
 *
 * WS-3 M7 gave this table the same two idempotency keys the outcome table
 * already had — a logical key and a provider-event key — because `delivered`
 * and `bounced` arrive over the same at-least-once webhook as the business
 * outcomes. A rejected duplicate is therefore `ok: true, duplicate: true`: the
 * fact IS recorded, it simply was already recorded. Callers written before M7
 * only inspect `ok` and keep working unchanged.
 */
export async function appendDeliveryEvidence(
  record: Omit<OutreachDeliveryEvidence, 'id'>,
): Promise<WriteResult<null> & { duplicate?: boolean }> {
  const res = await safeDb(() =>
    ownedDbTable(OUTREACH_DELIVERY_TABLE).insert({
      company_id: record.companyId,
      task_id: record.taskId,
      attempt_id: record.attemptId ?? null,
      delivery_status: record.deliveryStatus,
      provider: record.provider ?? null,
      provider_message_id: record.providerMessageId ?? null,
      source: record.source ?? null,
      provider_event_id: record.providerEventId ?? null,
      transport_response: record.transportResponse ?? {},
      observed_at: record.observedAt,
    }),
  );
  if (res.error) {
    const code = String((res.error as { code?: string }).code ?? '');
    if (code === '23505') return { ok: true, duplicate: true };
    return { ok: false, error: errText(res.error) };
  }
  return { ok: true };
}

/**
 * Append a business outcome.
 *
 * `(company_id, task_id, outcome_type, occurred_at)` is unique — the feedback
 * contract's idempotency key — so an at-least-once emission cannot record the
 * same outcome twice. A duplicate is reported as `duplicate: true`, which is a
 * normal outcome of at-least-once delivery rather than an error.
 */
export async function appendOutcome(record: Omit<OutreachOutcome, 'id'>): Promise<WriteResult<null> & { duplicate?: boolean }> {
  const res = await safeDb(() =>
    ownedDbTable(OUTREACH_OUTCOMES_TABLE).insert({
      company_id: record.companyId,
      task_id: record.taskId,
      outcome_type: record.outcomeType,
      derived: record.derived === true,
      evidence: record.evidence ?? {},
      occurred_at: record.occurredAt,
      source: record.source ?? null,
      provider: record.provider ?? null,
      provider_event_id: record.providerEventId ?? null,
      metadata: record.metadata ?? {},
    }),
  );
  if (res.error) {
    const code = String((res.error as { code?: string }).code ?? '');
    if (code === '23505') return { ok: true, duplicate: true };
    return { ok: false, error: errText(res.error) };
  }
  return { ok: true };
}

export async function appendDecision(record: Omit<OutreachDecision, 'id'>): Promise<WriteResult<null>> {
  const res = await safeDb(() =>
    ownedDbTable(OUTREACH_DECISIONS_TABLE).insert({
      company_id: record.companyId,
      task_id: record.taskId ?? null,
      gate: record.gate,
      decision: record.decision,
      reason: record.reason ?? null,
      scope: record.scope ?? null,
      limiter_layer: record.limiterLayer ?? null,
      governance_version: record.governanceVersion ?? null,
      // A3 / Contract 13 — the identity this decision was actually evaluated
      // against. `identityDegraded` is what makes a target-only evaluation
      // visible; without it an allowed decision taken with full identity and one
      // taken with none are indistinguishable in the log. `undefined` is written
      // as null so a caller that predates A3 records "unknown" rather than
      // asserting "not degraded", which would be a claim it never made.
      person_id: record.personId ?? null,
      identity_anchor: record.identityAnchor ?? null,
      identity_degraded: record.identityDegraded ?? null,
      decided_at: record.decidedAt,
    }),
  );
  return res.error ? { ok: false, error: errText(res.error) } : { ok: true };
}

// ── append-only readers ─────────────────────────────────────────────────────

const listFor = async (table: string, companyId: string, taskId: string, orderCol: string): Promise<Row[]> => {
  const res = await safeDb<Row[]>(() =>
    ownedDbTable(table)
      .select('*')
      .eq('company_id', companyId)
      .eq('task_id', taskId)
      .order(orderCol, { ascending: true }),
  );
  return res.error || !Array.isArray(res.data) ? [] : res.data;
};

export const listApprovals = (companyId: string, taskId: string) => listFor(OUTREACH_APPROVALS_TABLE, companyId, taskId, 'decided_at');
export const listAttempts = (companyId: string, taskId: string) => listFor(OUTREACH_ATTEMPTS_TABLE, companyId, taskId, 'attempt_number');
export const listDeliveryEvidence = (companyId: string, taskId: string) => listFor(OUTREACH_DELIVERY_TABLE, companyId, taskId, 'observed_at');
export const listOutcomes = (companyId: string, taskId: string) => listFor(OUTREACH_OUTCOMES_TABLE, companyId, taskId, 'occurred_at');
export const listDecisions = (companyId: string, taskId: string) => listFor(OUTREACH_DECISIONS_TABLE, companyId, taskId, 'decided_at');

/** Outcome types recorded for a task, deduped and sorted. */
export async function outcomeTypesFor(companyId: string, taskId: string): Promise<BusinessOutcomeType[]> {
  const rows = await listOutcomes(companyId, taskId);
  return [...new Set(rows.map((r) => String(obj(r).outcome_type)))].sort() as BusinessOutcomeType[];
}
