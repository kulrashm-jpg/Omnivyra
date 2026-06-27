import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import {
  getCollectionDetail,
  editCollection,
  addTemplateToCollection,
  removeTemplateFromCollection,
  reorderCollection,
  deleteCollection,
  getCollectionCompanyId,
} from '../../../../backend/services/creator/collectionService';

/**
 * GET    /api/creator-templates/collections/[id]   — collection + members + validation
 * PATCH  /api/creator-templates/collections/[id]   — { op: 'edit'|'add'|'remove'|'reorder', ... }
 * DELETE /api/creator-templates/collections/[id]
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });

  // Canonical authorization: resolve the resource's OWNING company, then enforce
  // access on it — never trust a client-supplied company_id, never execute first.
  const companyId = await getCollectionCompanyId(id);
  if (!companyId) return res.status(404).json({ error: 'collection not found' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const detail = await getCollectionDetail(id);
    if (!detail) return res.status(404).json({ error: 'collection not found' });
    return res.status(200).json(detail);
  }

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as Record<string, unknown>;
    const op = String(body.op || 'edit');
    let updated = null;
    if (op === 'add' && typeof body.template_id === 'string') updated = await addTemplateToCollection(id, body.template_id);
    else if (op === 'remove' && typeof body.template_id === 'string') updated = await removeTemplateFromCollection(id, body.template_id);
    else if (op === 'reorder' && Array.isArray(body.ordered_ids)) updated = await reorderCollection(id, body.ordered_ids.filter((x): x is string => typeof x === 'string'));
    else updated = await editCollection(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      brandStyle: typeof body.brand_style === 'string' ? body.brand_style : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((x): x is string => typeof x === 'string') : undefined,
      coverTemplateId: typeof body.cover_template_id === 'string' ? body.cover_template_id : undefined,
    });
    if (!updated) return res.status(503).json({ error: 'Could not update collection.' });
    return res.status(200).json({ collection: updated });
  }

  if (req.method === 'DELETE') {
    const ok = await deleteCollection(id);
    return res.status(ok ? 200 : 503).json({ ok });
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
