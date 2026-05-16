/**
 * Phase 9 — Analyst collections, saved views, bookmarks.
 *
 * `saved_intelligence_views` is the single home for analyst-curated
 * artefacts: search queries, filter presets, bookmarks (single-item),
 * collections (multi-item), and investigation templates. Multi-item
 * collections aggregate `analyst_collection_items` rows.
 *
 * Hard guarantees:
 *   • No autonomous mutation — every write requires an owner_user_id
 *     (system-emitted templates can pass null but must be flagged
 *     shared=true).
 *   • Tenant-first reads.
 *   • Item references are typed via CollectionItemKind so callers can
 *     route to the canonical detail view for each kind.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type AnalystCollectionItem,
  type CollectionItemKind,
  type SavedIntelligenceView,
  type SavedViewKind,
} from '../types/analystCollection';

export type UpsertSavedViewInput = {
  organizationId: string;
  id?: string;
  viewKind: SavedViewKind;
  name: string;
  description?: string | null;
  filterPayload?: Record<string, unknown>;
  ownerUserId: string | null;
  shared?: boolean;
  metadata?: Record<string, unknown>;
};

export async function upsertSavedView(input: UpsertSavedViewInput): Promise<SavedIntelligenceView> {
  const name = (input.name ?? '').trim().slice(0, 120);
  if (name.length === 0) throw new Error('saved_view_name_required');

  if (input.id) {
    const upd = await ownedDbTable('saved_intelligence_views')
      .update({
        view_kind: input.viewKind,
        name,
        description: input.description ?? null,
        filter_payload: input.filterPayload ?? {},
        owner_user_id: input.ownerUserId,
        shared: input.shared ?? false,
        metadata: input.metadata ?? {},
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`saved_view_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as SavedIntelligenceView;
  }

  const ins = await ownedDbTable('saved_intelligence_views')
    .insert({
      organization_id: input.organizationId,
      view_kind: input.viewKind,
      name,
      description: input.description ?? null,
      filter_payload: input.filterPayload ?? {},
      owner_user_id: input.ownerUserId,
      shared: input.shared ?? false,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`saved_view_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as SavedIntelligenceView;
}

export async function deleteSavedView(organizationId: string, id: string): Promise<void> {
  const { error } = await ownedDbTable('saved_intelligence_views')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', id);
  if (error) throw new Error(`saved_view_delete_failed:${error.message}`);
}

export async function listSavedViews(
  organizationId: string,
  options?: { viewKind?: SavedViewKind; ownerUserId?: string; limit?: number },
): Promise<SavedIntelligenceView[]> {
  let q = ownedDbTable('saved_intelligence_views')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.viewKind) q = q.eq('view_kind', options.viewKind);
  if (options?.ownerUserId) q = q.or(`owner_user_id.eq.${options.ownerUserId},shared.eq.true`);
  const { data } = await q;
  return (data as SavedIntelligenceView[]) ?? [];
}

export type AddCollectionItemInput = {
  organizationId: string;
  collectionId: string;
  itemKind: CollectionItemKind;
  itemRef: string;
  body?: string | null;
  addedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function addCollectionItem(input: AddCollectionItemInput): Promise<AnalystCollectionItem> {
  // Guard: collection must exist + belong to org.
  const { data: view } = await ownedDbTable('saved_intelligence_views')
    .select('id, view_kind')
    .eq('organization_id', input.organizationId)
    .eq('id', input.collectionId)
    .maybeSingle();
  if (!view) throw new Error(`collection_not_found:${input.collectionId}`);

  const ins = await ownedDbTable('analyst_collection_items')
    .insert({
      organization_id: input.organizationId,
      collection_id: input.collectionId,
      item_kind: input.itemKind,
      item_ref: input.itemRef,
      body: input.body ?? null,
      added_by: input.addedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`collection_item_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as AnalystCollectionItem;
}

export async function removeCollectionItem(
  organizationId: string,
  itemId: string,
): Promise<void> {
  const { error } = await ownedDbTable('analyst_collection_items')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', itemId);
  if (error) throw new Error(`collection_item_delete_failed:${error.message}`);
}

export async function listCollectionItems(
  organizationId: string,
  collectionId: string,
  options?: { limit?: number },
): Promise<AnalystCollectionItem[]> {
  const { data } = await ownedDbTable('analyst_collection_items')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: false })
    .limit(Math.min(1000, Math.max(1, options?.limit ?? 200)));
  return (data as AnalystCollectionItem[]) ?? [];
}
