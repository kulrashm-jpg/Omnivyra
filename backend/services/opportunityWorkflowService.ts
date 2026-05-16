/**
 * Phase 6 — Analyst workflow service.
 *
 * Assignments, notes, tags, dispositions — all tenant-scoped and
 * audit-safe. No autonomous actor mutates these tables; every write is
 * triggered by an explicit user API call.
 */

import { ownedDbTable } from '../db/writeOwner';
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

export async function assignOpportunity(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  assignedToUserId: string;
  assignedByUserId: string | null;
  role: AssignmentRole;
}): Promise<OpportunityAssignment> {
  // Close out any prior active assignment in the same role.
  await ownedDbTable('opportunity_assignments')
    .update({ unassigned_at: new Date().toISOString() })
    .eq('organization_id', args.organizationId)
    .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
    .eq('role', args.role)
    .is('unassigned_at', null);

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
  if (error || !data) throw new Error(`assignment_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OpportunityAssignment;
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
