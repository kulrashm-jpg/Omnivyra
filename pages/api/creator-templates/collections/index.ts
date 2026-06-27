import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { listCollections, createCollectionRecord, duplicateCollectionRecord, getCollectionCompanyId } from '../../../../backend/services/creator/collectionService';

/**
 * GET  /api/creator-templates/collections?company_id=        — list collections
 * POST /api/creator-templates/collections                    — create (empty /
 *      from template_ids) or duplicate (duplicate_of)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  if (req.method === 'GET') {
    const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(200).json({ collections: [] });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    const collections = await listCollections({ companyId });
    return res.status(200).json({ collections });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    if (typeof body.duplicate_of === 'string' && body.duplicate_of) {
      // The source collection must belong to the authorized company (no cross-tenant copy).
      const sourceCompanyId = await getCollectionCompanyId(body.duplicate_of);
      if (!sourceCompanyId) return res.status(404).json({ error: 'source collection not found' });
      if (sourceCompanyId !== companyId) return res.status(403).json({ error: 'cross-tenant duplication denied' });
      const dup = await duplicateCollectionRecord({ id: body.duplicate_of, companyId, ownerUserId: user.userId });
      if (!dup) return res.status(503).json({ error: 'Could not duplicate collection.' });
      return res.status(201).json({ collection: dup });
    }

    const created = await createCollectionRecord({
      companyId,
      ownerUserId: user.userId,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      brandStyle: typeof body.brand_style === 'string' ? body.brand_style : undefined,
      templateIds: Array.isArray(body.template_ids) ? body.template_ids.filter((x): x is string => typeof x === 'string') : undefined,
      teamId: typeof body.team_id === 'string' ? body.team_id : null,
    });
    if (!created) return res.status(503).json({ error: 'Could not create collection (storage unavailable).' });
    return res.status(201).json({ collection: created });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
