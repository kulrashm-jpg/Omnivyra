/**
 * LC-201 (W2) — Operational Core Service (entity-agnostic).
 *
 * THE single operational mutation layer for every lead-like entity. It owns status,
 * assignment, notes and tasks keyed by (company_id, entity_type, entity_id) and it
 * REUSES existing infrastructure — it never forks it:
 *   • persistence : `ownedDbTable` (same write seam + observability as the lead spine)
 *   • timeline    : the existing `lead_intelligence_events` (no duplicate timeline)
 *   • telemetry   : the canonical `trackEvent` dispatcher
 *   • state model : the pure `validateTransition` engine
 *
 * Every mutation is explainable by construction — it records the actor (changed_by /
 * assigned_by / author_id / created_by), the time, the reason, and appends a timeline
 * event carrying the same. Authorization is enforced by the API layer (enforceCompanyAccess)
 * and the actor is passed in; the service never trusts an unbounded caller.
 *
 * Human-before-AI: tasks carry an `origin` (human | ai_suggested | ai_executed) so a
 * future AI wave reuses this exact model without a parallel task engine.
 *
 * ALIAS-AWARE HISTORY (closure-B). One lead can be known by several persisted
 * keys: its canonical key, the durable signal view folded into it (signal
 * merge) and any canonical prospect absorbed into it (verified-identity
 * reconciliation). Notes / statuses / assignments / tasks saved under an OLD key
 * stay where they were written (nothing is re-keyed); a ref may carry
 * `aliasEntityIds`, and every READ then covers the canonical key AND its
 * aliases, while every WRITE goes to the canonical `entityId` only.
 * `resolveOperationalAliases` fills the aliases for `canonical_lead` refs from
 * the unified read service, tenant-scoped (the resolver only ever sees
 * `ref.companyId`, and every query is `.eq('company_id')`). It is fail-open: an
 * unresolvable key keeps the ref exactly as given.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { appendLeadEvent } from '../leadIntelligence/leadIntelligenceRepository';
import { trackEvent } from '../telemetry/telemetryDispatcher';
import { validateTransition, modelForEntity, type StateModelConfig } from '../../../lib/operations/operationalStateModel';
import type { CanonicalLeadSource } from '../../../lib/leadIntelligence';

export type OperationalEntityType = 'canonical_lead' | 'opportunity' | 'audience' | 'gtm_campaign';

export interface OperationalEntityRef {
  companyId: string;
  entityType: OperationalEntityType;
  /** The canonical key: every write lands here. */
  entityId: string;
  /** closure-B: other persisted keys of the SAME entity in the SAME tenant; reads cover them, writes never use them. */
  aliasEntityIds?: string[];
}
export interface Actor { userId: string | null }

export class OperationalError extends Error {
  constructor(public code: string, public httpStatus: number) { super(code); this.name = 'OperationalError'; }
}

const now = () => new Date().toISOString();
const S = 'operational_states', A = 'operational_assignments', N = 'operational_notes', T = 'operational_tasks';

/** Append an operational event to the canonical timeline. Fail-open (never blocks the mutation). */
async function recordTimeline(ref: OperationalEntityRef, eventType: string, actor: Actor, metadata: Record<string, unknown>): Promise<void> {
  try {
    if (ref.entityType === 'canonical_lead') {
      await appendLeadEvent(ref.companyId, ref.entityId, {
        origin: 'operations',
        source: 'other' as CanonicalLeadSource,
        entityId: actor.userId ?? null,
        eventType,
        occurredAt: now(),
        metadata: { ...metadata, actor: actor.userId ?? null },
      });
    }
    // Other entity types converge onto their own timeline in a later wave.
  } catch { /* fail-open */ }
  try {
    trackEvent({ type: `operations.${eventType}`, organizationId: ref.companyId, actorId: actor.userId ?? null, entityId: ref.entityId, metadata });
  } catch { /* fail-open telemetry */ }
}

const scope = <T>(q: T, ref: OperationalEntityRef): T =>
  (q as any).eq('company_id', ref.companyId).eq('entity_type', ref.entityType).eq('entity_id', ref.entityId);

/** The canonical key first, then its aliases (deduped). */
const keysOf = (ref: OperationalEntityRef): string[] =>
  [...new Set([ref.entityId, ...(ref.aliasEntityIds ?? [])].filter((k) => typeof k === 'string' && k.length > 0))];

const hasAliases = (ref: OperationalEntityRef): boolean => keysOf(ref).length > 1;

/** READ scope: the canonical key AND its aliases, same tenant, same entity type. */
const scopeRead = <T>(q: T, ref: OperationalEntityRef): T =>
  hasAliases(ref)
    ? (q as any).eq('company_id', ref.companyId).eq('entity_type', ref.entityType).in('entity_id', keysOf(ref))
    : scope(q, ref);

/**
 * One row out of several keys' rows: the canonical key's row when it has one
 * (it is the current state), else the most recent by `at`.
 */
function pickEffective(rows: Array<Record<string, unknown>>, ref: OperationalEntityRef, at: string): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const own = rows.find((r) => r.entity_id === ref.entityId);
  if (own) return own;
  return [...rows].sort((a, b) => String(b[at] ?? '').localeCompare(String(a[at] ?? '')))[0];
}

/** Resolves persisted lead keys to { canonical key, alias keys } in ONE tenant. */
export type LeadKeyAliasResolver = (companyId: string, keys: string[]) => Promise<Map<string, { leadKey: string; aliasKeys: string[] }>>;

const defaultLeadKeyAliasResolver: LeadKeyAliasResolver = async (companyId, keys) => {
  const { resolveLeadKeyAliases } = await import('../leadIntelligence/leadIntelligenceReadService');
  return resolveLeadKeyAliases(companyId, keys);
};

/**
 * closure-B: canonicalise `canonical_lead` refs — `entityId` becomes the lead's
 * canonical key and `aliasEntityIds` its other persisted keys (the key the
 * caller passed is always kept among them). ONE resolution per company for any
 * number of refs. Other entity types, unresolvable keys and any resolver failure
 * leave the ref unchanged. Never crosses tenants: each company's keys are
 * resolved with that company only.
 */
export async function resolveOperationalAliases(
  refs: OperationalEntityRef[],
  resolve: LeadKeyAliasResolver = defaultLeadKeyAliasResolver,
): Promise<OperationalEntityRef[]> {
  const byCompany = new Map<string, string[]>();
  for (const r of refs) {
    if (r.entityType !== 'canonical_lead' || !r.companyId || !r.entityId) continue;
    const list = byCompany.get(r.companyId);
    if (list) list.push(r.entityId); else byCompany.set(r.companyId, [r.entityId]);
  }
  const resolved = new Map<string, { leadKey: string; aliasKeys: string[] }>();
  for (const [companyId, keys] of byCompany) {
    try {
      const m = await resolve(companyId, keys);
      for (const [k, v] of m) resolved.set(`${companyId}|${k}`, v);
    } catch { /* fail-open: refs of this company stay as given */ }
  }
  return refs.map((r) => {
    const hit = r.entityType === 'canonical_lead' ? resolved.get(`${r.companyId}|${r.entityId}`) : undefined;
    if (!hit || !hit.leadKey) return r;
    const aliases = [...new Set([...(r.aliasEntityIds ?? []), ...hit.aliasKeys, r.entityId])].filter((k) => k !== hit.leadKey).sort();
    return { ...r, entityId: hit.leadKey, aliasEntityIds: aliases };
  });
}

/* ── Status / lifecycle ─────────────────────────────────────────────────────── */

export async function getStatus(ref: OperationalEntityRef): Promise<{ status: string; changed_at: string } | null> {
  if (hasAliases(ref)) {
    const { data } = await scopeRead(ownedDbTable(S).select('status, changed_at, entity_id'), ref).limit(50);
    const row = pickEffective(Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [], ref, 'changed_at');
    return row ? { status: String(row.status), changed_at: String(row.changed_at) } : null;
  }
  const { data } = await scope(ownedDbTable(S).select('status, changed_at'), ref).maybeSingle();
  return data ? { status: String((data as any).status), changed_at: String((data as any).changed_at) } : null;
}

export async function setStatus(ref: OperationalEntityRef, actor: Actor, status: string, reason?: string, config?: StateModelConfig): Promise<{ status: string; previous: string | null }> {
  const current = await getStatus(ref);
  const previous = current?.status ?? null;
  const check = validateTransition(previous, status, config ?? modelForEntity(ref.entityType));
  if (!check.ok) throw new OperationalError(`invalid_transition:${check.reason}`, 409);

  const { error } = await ownedDbTable(S).upsert({
    company_id: ref.companyId, entity_type: ref.entityType, entity_id: ref.entityId,
    status, previous_status: previous, reason: reason ?? null, changed_by: actor.userId ?? null,
    changed_at: now(), updated_at: now(),
  }, { onConflict: 'company_id,entity_type,entity_id' }).select('id').maybeSingle();
  if (error) throw new OperationalError('status_write_failed', 500);

  await recordTimeline(ref, 'status_changed', actor, { from: previous, to: status, reason: reason ?? null });
  return { status, previous };
}

/* ── Assignment / ownership ─────────────────────────────────────────────────── */

export async function getAssignment(ref: OperationalEntityRef): Promise<{ assignee_id: string | null; assigned_at: string } | null> {
  if (hasAliases(ref)) {
    const { data } = await scopeRead(ownedDbTable(A).select('assignee_id, assigned_at, entity_id').eq('active', true), ref).limit(50);
    const row = pickEffective(Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [], ref, 'assigned_at');
    return row ? { assignee_id: (row.assignee_id as string | null) ?? null, assigned_at: String(row.assigned_at) } : null;
  }
  const { data } = await scope(ownedDbTable(A).select('assignee_id, assigned_at').eq('active', true), ref).maybeSingle();
  return data ? { assignee_id: (data as any).assignee_id ?? null, assigned_at: String((data as any).assigned_at) } : null;
}

/** Assign (or reassign) — deactivates the prior active row, inserts a new active one. */
export async function assign(ref: OperationalEntityRef, actor: Actor, assigneeId: string): Promise<void> {
  if (!assigneeId) throw new OperationalError('assignee_required', 400);
  await deactivateActiveAssignment(ref);
  const { error } = await ownedDbTable(A).insert({
    company_id: ref.companyId, entity_type: ref.entityType, entity_id: ref.entityId,
    assignee_id: assigneeId, assigned_by: actor.userId ?? null, active: true, assigned_at: now(),
  });
  if (error) throw new OperationalError('assign_write_failed', 500);
  await recordTimeline(ref, 'assignment_changed', actor, { assignee: assigneeId });
}

export async function unassign(ref: OperationalEntityRef, actor: Actor, reason?: string): Promise<void> {
  await deactivateActiveAssignment(ref);
  await ownedDbTable(A).insert({
    company_id: ref.companyId, entity_type: ref.entityType, entity_id: ref.entityId,
    assignee_id: null, assigned_by: actor.userId ?? null, active: false, assigned_at: now(), unassigned_at: now(),
    metadata: reason ? { reason } : {},
  });
  await recordTimeline(ref, 'assignment_changed', actor, { assignee: null, reason: reason ?? null });
}

async function deactivateActiveAssignment(ref: OperationalEntityRef): Promise<void> {
  // Covers the aliases too: one lead has at most ONE active assignment, whichever key it was made under.
  await scopeRead(ownedDbTable(A).update({ active: false, unassigned_at: now() }).eq('active', true), ref);
}

export async function listAssignmentsForUser(companyId: string, userId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await ownedDbTable(A).select('*').eq('company_id', companyId).eq('assignee_id', userId).eq('active', true).limit(500);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/* ── Notes ──────────────────────────────────────────────────────────────────── */

export interface NoteInput { body: string; bodyFormat?: 'markdown' | 'plain' | 'html'; mentions?: string[]; pinned?: boolean }

export async function addNote(ref: OperationalEntityRef, actor: Actor, input: NoteInput): Promise<{ id: string }> {
  if (!input.body?.trim()) throw new OperationalError('note_body_required', 400);
  const { data, error } = await ownedDbTable(N).insert({
    company_id: ref.companyId, entity_type: ref.entityType, entity_id: ref.entityId,
    author_id: actor.userId ?? null, body: input.body.trim(), body_format: input.bodyFormat ?? 'markdown',
    mentions: input.mentions ?? [], pinned: input.pinned ?? false,
  }).select('id').maybeSingle();
  if (error || !data) throw new OperationalError('note_write_failed', 500);
  await recordTimeline(ref, 'note_added', actor, { noteId: (data as any).id, mentions: input.mentions ?? [] });
  return { id: String((data as any).id) };
}

export async function listNotes(ref: OperationalEntityRef): Promise<Array<Record<string, unknown>>> {
  const { data } = await scopeRead(ownedDbTable(N).select('*').is('deleted_at', null), ref).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(500);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export async function setNotePinned(companyId: string, noteId: string, actor: Actor, pinned: boolean): Promise<void> {
  await ownedDbTable(N).update({ pinned, updated_at: now() }).eq('company_id', companyId).eq('id', noteId);
}

export async function deleteNote(companyId: string, noteId: string, actor: Actor): Promise<void> {
  await ownedDbTable(N).update({ deleted_at: now(), updated_at: now() }).eq('company_id', companyId).eq('id', noteId);
}

/* ── Tasks ──────────────────────────────────────────────────────────────────── */

export type TaskType = 'call' | 'email' | 'meeting' | 'research' | 'follow_up' | 'review';
export interface TaskInput { taskType?: TaskType; title: string; description?: string; ownerId?: string | null; dueAt?: string | null; priority?: 'low' | 'medium' | 'high' | 'urgent'; origin?: 'human' | 'ai_suggested' | 'ai_executed' }

export async function createTask(ref: OperationalEntityRef, actor: Actor, input: TaskInput): Promise<{ id: string }> {
  if (!input.title?.trim()) throw new OperationalError('task_title_required', 400);
  const { data, error } = await ownedDbTable(T).insert({
    company_id: ref.companyId, entity_type: ref.entityType, entity_id: ref.entityId,
    task_type: input.taskType ?? 'follow_up', title: input.title.trim(), description: input.description ?? null,
    owner_id: input.ownerId ?? actor.userId ?? null, due_at: input.dueAt ?? null,
    priority: input.priority ?? 'medium', status: 'open', origin: input.origin ?? 'human', created_by: actor.userId ?? null,
  }).select('id').maybeSingle();
  if (error || !data) throw new OperationalError('task_write_failed', 500);
  await recordTimeline(ref, 'task_created', actor, { taskId: (data as any).id, taskType: input.taskType ?? 'follow_up', priority: input.priority ?? 'medium' });
  return { id: String((data as any).id) };
}

export async function updateTask(companyId: string, taskId: string, actor: Actor, patch: Partial<{ status: string; title: string; description: string; ownerId: string | null; dueAt: string | null; priority: string }>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: now() };
  if (patch.status) { row.status = patch.status; if (patch.status === 'done') row.completed_at = now(); }
  if (patch.title != null) row.title = patch.title;
  if (patch.description != null) row.description = patch.description;
  if (patch.ownerId !== undefined) row.owner_id = patch.ownerId;
  if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
  if (patch.priority) row.priority = patch.priority;
  const { error } = await ownedDbTable(T).update(row).eq('company_id', companyId).eq('id', taskId);
  if (error) throw new OperationalError('task_update_failed', 500);
  try { trackEvent({ type: 'operations.task_updated', organizationId: companyId, actorId: actor.userId ?? null, entityId: taskId, metadata: { patch: Object.keys(row) } }); } catch { /* fail-open */ }
}

export async function listTasks(ref: OperationalEntityRef): Promise<Array<Record<string, unknown>>> {
  const { data } = await scopeRead(ownedDbTable(T).select('*'), ref).order('created_at', { ascending: false }).limit(500);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/* ── Operational overlay (read) — surfaces the operational layer for the workspace ── */

export async function getOperationalOverlay(ref: OperationalEntityRef): Promise<{
  status: string | null; assignee: string | null; notes: Array<Record<string, unknown>>; tasks: Array<Record<string, unknown>>;
}> {
  const [status, assignment, notes, tasks] = await Promise.all([getStatus(ref), getAssignment(ref), listNotes(ref), listTasks(ref)]);
  return { status: status?.status ?? null, assignee: assignment?.assignee_id ?? null, notes, tasks };
}

/* ── Bulk operations (safe, audited, per-item; partial failures reported) ──────── */

export interface BulkResult { total: number; ok: number; failed: Array<{ entityId: string; error: string }> }

async function runBulk(entities: OperationalEntityRef[], op: (ref: OperationalEntityRef) => Promise<unknown>): Promise<BulkResult> {
  const out: BulkResult = { total: entities.length, ok: 0, failed: [] };
  for (const ref of entities) {
    try { await op(ref); out.ok++; } catch (e) { out.failed.push({ entityId: ref.entityId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}

export const bulkSetStatus = (entities: OperationalEntityRef[], actor: Actor, status: string, reason?: string) => runBulk(entities, (r) => setStatus(r, actor, status, reason));
export const bulkAssign = (entities: OperationalEntityRef[], actor: Actor, assigneeId: string) => runBulk(entities, (r) => assign(r, actor, assigneeId));
export const bulkArchive = (entities: OperationalEntityRef[], actor: Actor, reason?: string) => runBulk(entities, (r) => setStatus(r, actor, 'archived', reason));
export const bulkCreateTask = (entities: OperationalEntityRef[], actor: Actor, input: TaskInput) => runBulk(entities, (r) => createTask(r, actor, input));
