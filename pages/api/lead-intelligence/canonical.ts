import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { buildLeadIntelligenceSnapshot, buildLeadPresentationModel } from '../../../backend/services/leadIntelligence/leadIntelligenceSnapshotAdapter';

/**
 * GET /api/lead-intelligence/canonical — the single Lead Intelligence read surface
 * composed entirely through the Platform Intelligence Framework (Consumer #2). Returns the
 * lead snapshot + the platform presentation model. The repository/adapter owns all
 * composition; this route only authorises + delegates.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const snapshot = await buildLeadIntelligenceSnapshot(companyId);
    return res.status(200).json({ snapshot, presentation: buildLeadPresentationModel(snapshot) });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load lead intelligence' });
  }
}
