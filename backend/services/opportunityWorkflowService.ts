/**
 * Phase 6 — Analyst workflow service.
 *
 * Assignments, notes, tags, dispositions — all tenant-scoped and
 * audit-safe. No autonomous actor mutates these tables; every write is
 * triggered by an explicit user API call.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  deriveOpportunitySnooze,
  isSnoozeTerminalState,
  OpportunitySnoozeRefusedError,
  snoozeHistory,
  snoozeRefusalFromDbError,
  validateSnoozeDeadline,
  type OpportunitySnoozeState,
} from '../../lib/prospectOpportunity/snooze';
import { readCurrentLifecycleState } from './opportunityLifecycleService';
import type {
  AssignmentRole,
  Disposition,
  NoteVisibility,
  OpportunityAssignment,
  OpportunityDisposition,
  OpportunityNote,
  OpportunityTag,
} from '../types/opportunityWorkflow';

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/**
 * Bounded retries of the close-then-insert below when a concurrent assignment
 * wins the race. Each retry closes the winner's row and inserts again, so the
 * outcome equals the same two calls made one after the other (last writer
 * wins), and the database never holds two active rows for one (item, role).
 */
const MAX_ASSIGN_ATTEMPTS = 3;

/**
 * Assign a user to an opportunity in a role, replacing the active assignment
 * in that role.
 *
 * One active assignment per (item, role) is a DATABASE fact since
 * 20270108000000 (`uq_opp_assignment_one_active`, partial on
 * `unassigned_at IS NULL`). Before that the close-then-insert pair was not
 * atomic: two concurrent calls could both close nothing and both insert,
 * leaving two active owners. Now the losing insert raises 23505 and is
 * retried (close the winner, insert again) instead of leaving a duplicate.
 *
 * Tenant: the composite FK `opp_assignments_item_tenant_fk` rejects an item of
 * another tenant with 23503.
 */
export async function assignOpportunity(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  assignedToUserId: string;
  assignedByUserId: string | null;
  role: AssignmentRole;
}): Promise<OpportunityAssignment> {
  for (let attempt = 1; ; attempt += 1) {
    // Close out any prior active assignment in the same role.
    const { error: closeError } = await ownedDbTable('opportunity_assignments')
      .update({ unassigned_at: new Date().toISOString() })
      .eq('organization_id', args.organizationId)
      .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
      .eq('role', args.role)
      .is('unassigned_at', null);
    if (closeError) throw new Error(`assignment_close_failed:${closeError.message}`);

    const { data, error } = await ownedDbTable('opportunity_assignments')
      .insert({
        organization_id: args.organizationId,
        opportunity_feed_item_id: args.opportunityFeedItemId,
        assigned_to_user_id: args.assignedToUserId,
        assigned_by_user_id: args.assignedByUserId,
        role: args.role,
      })
      .select('*')
      .single();
    if (!error && data) return data as OpportunityAssignment;
    if (error?.code === '23505') {
      // A concurrent assignment in the same role became active between our
      // close and our insert.
      if (attempt < MAX_ASSIGN_ATTEMPTS) continue;
      throw new Error(`assignment_conflict:${error.message}`);
    }
    throw new Error(`assignment_insert_failed:${error?.message ?? 'unknown'}`);
  }
}

export async function unassignOpportunity(args: {
  organizationId: string;
  assignmentId: string;
}): Promise<OpportunityAssignment | null> {
  const { data, error } = await ownedDbTable('opportunity_assignments')
    .update({ unassigned_at: new Date().toISOString() })
    .eq('organization_id', args.organizationId)
    .eq('id', args.assignmentId)
    .is('unassigned_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`unassignment_failed:${error.message}`);
  return (data as OpportunityAssignment | null) ?? null;
}

export async function listAssignmentsForOpportunity(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityAssignment[]> {
  const { data, error } = await ownedDbTable('opportunity_assignments')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`assignment_list_failed:${error.message}`);
  return (data as OpportunityAssignment[]) ?? [];
}

export async function listAssignmentsForUser(
  organizationId: string,
  userId: string,
): Promise<OpportunityAssignment[]> {
  const { data, error } = await ownedDbTable('opportunity_assignments')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('assigned_to_user_id', userId)
    .is('unassigned_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`assignment_list_user_failed:${error.message}`);
  return (data as OpportunityAssignment[]) ?? [];
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addOpportunityNote(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  authorUserId: string | null;
  body: string;
  visibility: NoteVisibility;
  metadata?: Record<string, unknown>;
}): Promise<OpportunityNote> {
  const body = (args.body ?? '').trim();
  if (body.length === 0) throw new Error('note_body_required');
  const { data, error } = await ownedDbTable('opportunity_notes')
    .insert({
      organization_id: args.organizationId,
      opportunity_feed_item_id: args.opportunityFeedItemId,
      author_user_id: args.authorUserId,
      body,
      visibility: args.visibility,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`note_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OpportunityNote;
}

export async function listOpportunityNotes(
  organizationId: string,
  opportunityFeedItemId: string,
  options?: { visibility?: NoteVisibility; limit?: number },
): Promise<OpportunityNote[]> {
  let q = ownedDbTable('opportunity_notes')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.visibility) q = q.eq('visibility', options.visibility);
  const { data, error } = await q;
  if (error) throw new Error(`note_list_failed:${error.message}`);
  return (data as OpportunityNote[]) ?? [];
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function addOpportunityTag(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  tag: string;
  createdBy: string | null;
}): Promise<OpportunityTag | null> {
  const tag = args.tag.trim().toLowerCase().slice(0, 64);
  if (!tag) throw new Error('tag_required');
  const { data, error } = await ownedDbTable('opportunity_tags')
    .insert({
      organization_id: args.organizationId,
      opportunity_feed_item_id: args.opportunityFeedItemId,
      tag,
      created_by: args.createdBy,
    })
    .select('*')
    .single();
  if (error) {
    // 23505 race — tag already exists. Return existing.
    if (error.code === '23505') {
      const { data: existing } = await ownedDbTable('opportunity_tags')
        .select('*')
        .eq('organization_id', args.organizationId)
        .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
        .eq('tag', tag)
        .maybeSingle();
      return (existing as OpportunityTag | null) ?? null;
    }
    throw new Error(`tag_insert_failed:${error.message}`);
  }
  return (data as OpportunityTag) ?? null;
}

export async function removeOpportunityTag(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  tag: string;
}): Promise<boolean> {
  const tag = args.tag.trim().toLowerCase().slice(0, 64);
  const { error, data } = await ownedDbTable('opportunity_tags')
    .delete()
    .eq('organization_id', args.organizationId)
    .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
    .eq('tag', tag)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`tag_delete_failed:${error.message}`);
  return Boolean(data);
}

export async function listTagsForOpportunity(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityTag[]> {
  const { data, error } = await ownedDbTable('opportunity_tags')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`tag_list_failed:${error.message}`);
  return (data as OpportunityTag[]) ?? [];
}

// ---------------------------------------------------------------------------
// Dispositions
// ---------------------------------------------------------------------------

export async function setOpportunityDisposition(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  disposition: Disposition;
  reason: string | null;
  setByUserId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<OpportunityDisposition> {
  const { data, error } = await ownedDbTable('opportunity_dispositions')
    .insert({
      organization_id: args.organizationId,
      opportunity_feed_item_id: args.opportunityFeedItemId,
      disposition: args.disposition,
      reason: args.reason,
      set_by_user_id: args.setByUserId,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`disposition_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OpportunityDisposition;
}

export async function listDispositionsForOpportunity(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityDisposition[]> {
  const { data, error } = await ownedDbTable('opportunity_dispositions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`disposition_list_failed:${error.message}`);
  return (data as OpportunityDisposition[]) ?? [];
}

// ---------------------------------------------------------------------------
// Snooze (opportunity-level; owner decision 2026-10-30)
// ---------------------------------------------------------------------------
//
// Carrier: `opportunity_dispositions.snoozed_until` (20270108000000). A snooze
// is a `revisit_later` disposition with a deadline; the rules for reading it
// live in lib/prospectOpportunity/snooze.ts. Snooze is per opportunity (feed
// item), never per prospect, and never touches the lifecycle status. Every
// write is an INSERT, so the disposition rows are the snooze history.
// Tenant: the composite FK `opp_dispositions_item_tenant_fk` rejects a snooze
// of another tenant's item with 23503.
//
// Terminal (closure-D, 20270109000003): a snooze is refused when the
// opportunity's current lifecycle state is converted, dismissed or archived
// (SNOOZE_TERMINAL_LIFECYCLE_STATES). Checked here first, then enforced by the
// database guard `trg_opp_disposition_snooze_guard`; both surface as
// OpportunitySnoozeRefusedError('terminal'). No lifecycle history ("missing")
// is not terminal — the same answer the guard gives. An UNREADABLE lifecycle
// is refused here (fail closed) with reason 'lifecycle_unreadable'.
// Dispositions are append-only in the database since 20270109000003.

export async function snoozeOpportunity(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  /** ISO instant; must be strictly after `now`. */
  until: string;
  setByUserId: string | null;
  reason: string | null;
  /** Injected clock for deterministic callers; defaults to the current time. */
  now?: string;
  metadata?: Record<string, unknown>;
}): Promise<OpportunityDisposition> {
  const until = validateSnoozeDeadline(args.until, args.now ?? new Date().toISOString());
  const lifecycle = await readCurrentLifecycleState(args.organizationId, args.opportunityFeedItemId);
  if (lifecycle.kind === 'unreadable') {
    throw new OpportunitySnoozeRefusedError('lifecycle_unreadable', null, 'application', `${lifecycle.reason}:${lifecycle.detail}`);
  }
  if (lifecycle.kind === 'present' && isSnoozeTerminalState(lifecycle.state)) {
    throw new OpportunitySnoozeRefusedError('terminal', lifecycle.state, 'application');
  }
  const { data, error } = await ownedDbTable('opportunity_dispositions')
    .insert({
      organization_id: args.organizationId,
      opportunity_feed_item_id: args.opportunityFeedItemId,
      disposition: 'revisit_later' as Disposition,
      reason: args.reason,
      set_by_user_id: args.setByUserId,
      snoozed_until: until,
      metadata: { ...(args.metadata ?? {}), snooze_action: 'snooze' },
    })
    .select('*')
    .single();
  if (error) {
    // The database guard is the authority when a terminal transition raced the read above.
    const refused = snoozeRefusalFromDbError(error);
    if (refused) throw refused;
  }
  if (error || !data) throw new Error(`snooze_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OpportunityDisposition;
}

/** Current snooze of ONE opportunity, evaluated at `asOf` (default: now). */
export async function readOpportunitySnooze(
  organizationId: string,
  opportunityFeedItemId: string,
  asOf?: string,
): Promise<OpportunitySnoozeState> {
  const rows = await listDispositionsForOpportunity(organizationId, opportunityFeedItemId);
  return deriveOpportunitySnooze(rows, { organizationId, opportunityFeedItemId }, asOf ?? new Date().toISOString());
}

/**
 * End an ACTIVE snooze early. Appends an untimed `revisit_later` row (the
 * opportunity is due for revisit now) that supersedes the snooze; the snooze
 * row itself is never modified. Returns null, and writes nothing, when the
 * opportunity is not actively snoozed (already expired, superseded, or never
 * snoozed), so repeating it is harmless.
 */
export async function unsnoozeOpportunity(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  setByUserId: string | null;
  reason: string | null;
  now?: string;
}): Promise<OpportunityDisposition | null> {
  const current = await readOpportunitySnooze(args.organizationId, args.opportunityFeedItemId, args.now);
  if (current.kind !== 'active') return null;
  return setOpportunityDisposition({
    organizationId: args.organizationId,
    opportunityFeedItemId: args.opportunityFeedItemId,
    disposition: 'revisit_later',
    reason: args.reason,
    setByUserId: args.setByUserId,
    metadata: { snooze_action: 'unsnooze', ended_snooze_disposition_id: current.dispositionId },
  });
}

/** Every revisit_later row of one opportunity, oldest first (snooze history). */
export async function listOpportunitySnoozeHistory(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityDisposition[]> {
  const rows = await listDispositionsForOpportunity(organizationId, opportunityFeedItemId);
  return snoozeHistory(rows, { organizationId, opportunityFeedItemId });
}

/**
 * Opportunities of one tenant whose snooze has EXPIRED at `asOf` and has not
 * been superseded: the "due for revisit" list. Candidates come from the
 * partial index `idx_opp_dispositions_snooze_expiry`; each is then re-derived
 * from its full disposition history so a later disposition wins.
 */
export async function listExpiredOpportunitySnoozes(
  organizationId: string,
  asOf: string,
): Promise<Array<{ opportunityFeedItemId: string; snooze: OpportunitySnoozeState }>> {
  const { data: candidates, error } = await ownedDbTable('opportunity_dispositions')
    .select('opportunity_feed_item_id')
    .eq('organization_id', organizationId)
    .lte('snoozed_until', asOf);
  if (error) throw new Error(`snooze_expired_list_failed:${error.message}`);
  const ids = Array.from(new Set(((candidates ?? []) as Array<{ opportunity_feed_item_id: string }>)
    .map((r) => r.opportunity_feed_item_id))).sort();
  if (ids.length === 0) return [];

  const { data: rows, error: rowsError } = await ownedDbTable('opportunity_dispositions')
    .select('*')
    .eq('organization_id', organizationId)
    .in('opportunity_feed_item_id', ids);
  if (rowsError) throw new Error(`snooze_expired_rows_failed:${rowsError.message}`);
  const all = (rows as OpportunityDisposition[]) ?? [];

  const out: Array<{ opportunityFeedItemId: string; snooze: OpportunitySnoozeState }> = [];
  for (const id of ids) {
    const snooze = deriveOpportunitySnooze(all, { organizationId, opportunityFeedItemId: id }, asOf);
    if (snooze.kind === 'expired') out.push({ opportunityFeedItemId: id, snooze });
  }
  return out;
}
