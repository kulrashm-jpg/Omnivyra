import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { analyzeCollectionEvolution, acceptEvolutionRecommendation } from '../../../../backend/services/creator/designEvolutionService';
import { getCollectionCompanyId } from '../../../../backend/services/creator/collectionService';
import type { EvolutionRecommendation } from '../../../../lib/creator-templates/designEvolution';

/**
 * GET  /api/creator-templates/collection-evolution/[id]?company_id=  — analysis
 * POST /api/creator-templates/collection-evolution/[id]  { recommendation }
 *      — accept a recommendation → NEW collection version (existing versioning).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });

  // Authorize on the collection's OWNING company (never a client-supplied one).
  const companyId = await getCollectionCompanyId(id);
  if (!companyId) return res.status(404).json({ error: 'collection not found' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const analysis = await analyzeCollectionEvolution(id, companyId);
    return res.status(200).json({ analysis });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const rec = body.recommendation as EvolutionRecommendation | undefined;
    if (!rec || typeof rec.type !== 'string') return res.status(400).json({ error: 'recommendation required' });
    const updated = await acceptEvolutionRecommendation(id, rec);
    if (!updated) return res.status(200).json({ collection: null, applied: false, note: 'Guidance only — this recommendation needs a new template (the engine never creates templates automatically).' });
    return res.status(200).json({ collection: updated, applied: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
