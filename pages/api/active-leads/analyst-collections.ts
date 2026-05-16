/**
 * Phase 9 — Analyst collections + saved views endpoint.
 *
 *   GET    ?companyId=...&viewKind=...&ownerOnly=1
 *   GET    ?companyId=...&collectionId=...&items=1
 *
 *   POST   { companyId, action:'upsert_view', id?, viewKind, name, description?, filterPayload?, shared?, metadata? }
 *   POST   { companyId, action:'delete_view', id }
 *   POST   { companyId, action:'add_item', collectionId, itemKind, itemRef, body?, metadata? }
 *   POST   { companyId, action:'remove_item', itemId }
 *
 * Auth: enforceCompanyAccess. No extra capability requirement — analysts
 * curate their own workspace.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  addCollectionItem,
  deleteSavedView,
  listCollectionItems,
  listSavedViews,
  removeCollectionItem,
  upsertSavedView,
} from '../../../backend/services/analystCollectionService';
import {
  COLLECTION_ITEM_KINDS,
  SAVED_VIEW_KINDS,
  type CollectionItemKind,
  type SavedViewKind,
} from '../../../backend/types/analystCollection';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.collectionId && req.query.items) {
      const items = await listCollectionItems(companyId, String(req.query.collectionId));
      return res.status(200).json({ items, total: items.length });
    }
    const viewKind = typeof req.query.viewKind === 'string' && SAVED_VIEW_KINDS.includes(req.query.viewKind as SavedViewKind) ? (req.query.viewKind as SavedViewKind) : undefined;
    const ownerOnly = req.query.ownerOnly ? ctx.userId : undefined;
    const items = await listSavedViews(companyId, { viewKind, ownerUserId: ownerOnly });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[analyst-collections GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load collections' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_view', 'delete_view', 'add_item', 'remove_item'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ upsert_view|delete_view|add_item|remove_item required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (action === 'upsert_view') {
      const view = await upsertSavedView({
        organizationId: companyId,
        id: typeof body.id === 'string' ? body.id : undefined,
        viewKind: SAVED_VIEW_KINDS.includes(body.viewKind as SavedViewKind) ? (body.viewKind as SavedViewKind) : 'filter',
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
        filterPayload: (body.filterPayload as Record<string, unknown>) ?? {},
        ownerUserId: ctx.userId,
        shared: Boolean(body.shared),
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, view });
    }
    if (action === 'delete_view') {
      await deleteSavedView(companyId, String(body.id ?? ''));
      return res.status(200).json({ ok: true });
    }
    if (action === 'add_item') {
      const item = await addCollectionItem({
        organizationId: companyId,
        collectionId: String(body.collectionId ?? ''),
        itemKind: COLLECTION_ITEM_KINDS.includes(body.itemKind as CollectionItemKind) ? (body.itemKind as CollectionItemKind) : 'note',
        itemRef: String(body.itemRef ?? ''),
        body: typeof body.body === 'string' ? body.body : null,
        addedBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, item });
    }
    await removeCollectionItem(companyId, String(body.itemId ?? ''));
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[analyst-collections POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'collection_failed' });
  }
}
