import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getEnrichedLeadProfile } from '../../../backend/services/leadIntelligence/leadIntelligenceReadService';

/**
 * GET /api/lead-intelligence/profile?company_id=&key= — fully-hydrated Lead
 * Intelligence profile for one unified lead (identity, journey, content/campaign
 * intelligence, opportunity/marketpulse/engagement signals, attribution, timeline,
 * AI summary, recommended next action). Repository-only; tenant-scoped. Additive.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  const key = String(req.query.key || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!key) return res.status(400).json({ error: 'key required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const profile = await getEnrichedLeadProfile(companyId, key);
  if (!profile) return res.status(404).json({ error: 'lead not found' });
  return res.status(200).json(profile);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/lead-intelligence/profile' });
