import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { createAiCollection } from '../../../../backend/services/creator/aiCollectionService';

/**
 * POST /api/creator-templates/collections/ai  { prompt, company_id }
 *
 * Generates a Collection (Design System): one template per asset family sharing
 * a brand style (via the AI Template Creator), grouped into a collection.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const result = await createAiCollection({ prompt, companyId, ownerUserId: user.userId });
  if (!result.collection) return res.status(503).json({ error: 'Could not create collection (storage unavailable).' });
  return res.status(201).json(result);
}
