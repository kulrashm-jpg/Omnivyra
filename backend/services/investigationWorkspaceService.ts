/**
 * Phase 7 — Investigation workspaces.
 *
 * Analyst-scoped collections of related opportunities, graph snapshots,
 * notes, escalations, executions. Bounded size (INVESTIGATION_MAX_ITEMS).
 * Realtime-synchronized via the Phase 6 publisher.
 *
 * Hard guarantees:
 *   • Tenant-scoped (organization_id FK CASCADE).
 *   • Bounded item count per workspace.
 *   • Audit-safe: every item carries `added_by` + `created_at`.
 *   • No autonomous workspace creator or item appender.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  InvestigationItemKind,
  InvestigationStatus,
  InvestigationWorkspace,
  InvestigationWorkspaceItem,
} from '../types/investigationWorkspace';
import {
  INVESTIGATION_ITEM_KINDS,
  INVESTIGATION_MAX_ITEMS,
} from '../types/investigationWorkspace';

export async function createWorkspace(input: {
  organizationId: string;
  title: string;
  description: string | null;
  createdBy: string | null;
}): Promise<InvestigationWorkspace> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) throw new Error('workspace_title_invalid');
  const { data, error } = await ownedDbTable('investigation_workspaces')
    .insert({
      organization_id: input.organizationId,
      title,
      description: input.description,
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`workspace_insert_failed:${error?.message ?? 'unknown'}`);
  return data as InvestigationWorkspace;
}

export async function listWorkspaces(
  organizationId: string,
  options?: { status?: InvestigationStatus; limit?: number },
): Promise<InvestigationWorkspace[]> {
  let q = ownedDbTable('investigation_workspaces')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`workspaces_list_failed:${error.message}`);
  return (data as InvestigationWorkspace[]) ?? [];
}

export async function updateWorkspaceStatus(args: {
  organizationId: string;
  workspaceId: string;
  status: InvestigationStatus;
}): Promise<InvestigationWorkspace | null> {
  const patch: Record<string, unknown> = { status: args.status };
  if (args.status === 'resolved' || args.status === 'archived') {
    patch.closed_at = new Date().toISOString();
  }
  const { data, error } = await ownedDbTable('investigation_workspaces')
    .update(patch)
    .eq('organization_id', args.organizationId)
    .eq('id', args.workspaceId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`workspace_status_failed:${error.message}`);
  return (data as InvestigationWorkspace | null) ?? null;
}

export async function addWorkspaceItem(input: {
  organizationId: string;
  workspaceId: string;
  itemKind: InvestigationItemKind;
  itemRef: string;
  body?: string | null;
  pinned?: boolean;
  addedBy: string | null;
  metadata?: Record<string, unknown>;
}): Promise<InvestigationWorkspaceItem> {
  if (!INVESTIGATION_ITEM_KINDS.includes(input.itemKind)) {
    throw new Error(`unknown_investigation_item_kind:${input.itemKind}`);
  }
  // Enforce bounded workspace size.
  const { count } = await ownedDbTable('investigation_workspace_items')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', input.workspaceId);
  if (Number(count ?? 0) >= INVESTIGATION_MAX_ITEMS) {
    throw new Error(`workspace_item_cap_reached:${INVESTIGATION_MAX_ITEMS}`);
  }
  const { data, error } = await ownedDbTable('investigation_workspace_items')
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      item_kind: input.itemKind,
      item_ref: input.itemRef,
      body: input.body ?? null,
      pinned: !!input.pinned,
      added_by: input.addedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`workspace_item_insert_failed:${error?.message ?? 'unknown'}`);
  return data as InvestigationWorkspaceItem;
}

export async function listWorkspaceItems(
  organizationId: string,
  workspaceId: string,
): Promise<InvestigationWorkspaceItem[]> {
  const { data, error } = await ownedDbTable('investigation_workspace_items')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`workspace_items_list_failed:${error.message}`);
  return (data as InvestigationWorkspaceItem[]) ?? [];
}

export async function removeWorkspaceItem(args: {
  organizationId: string;
  workspaceItemId: string;
}): Promise<boolean> {
  const { data, error } = await ownedDbTable('investigation_workspace_items')
    .delete()
    .eq('organization_id', args.organizationId)
    .eq('id', args.workspaceItemId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`workspace_item_remove_failed:${error.message}`);
  return Boolean(data);
}
