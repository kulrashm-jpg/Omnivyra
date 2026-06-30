import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getWebsiteSnapshot } from '../../../backend/services/websiteIntelligence/websiteIntelligenceRepository';

/**
 * GET /api/website-intelligence/canonical — the single read surface for the
 * canonical Website Intelligence Repository. Returns the full website intelligence
 * snapshot (health, readiness, tracking, signals, integrations, diagnostics, domain,
 * modules + freshness, recommendations, validation, summary). The repository owns all
 * composition; this route only authorises + delegates.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const snapshot = await getWebsiteSnapshot(companyId, websiteId);
    return res.status(200).json({ snapshot });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load website intelligence' });
  }
}
