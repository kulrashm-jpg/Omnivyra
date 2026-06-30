import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateWebsiteIntelligenceSignals, getWebsiteIntelligenceSignals } from '../../../backend/services/websiteIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId =
    typeof req.query.website_id === 'string' ? req.query.website_id :
    typeof req.body?.website_id === 'string' ? req.body.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  // BETA-012 (RULE 4): the service calls below throw on DB failure; without this guard an
  // error returned a raw HTML 500 with no JSON body. Return a meaningful error instead.
  if (req.method === 'POST') {
    try {
      const result = await generateWebsiteIntelligenceSignals({ companyId, websiteId });
      return res.status(202).json(result);
    } catch (err: any) {
      console.error('[website-intelligence/signals] POST error:', err?.message);
      return res.status(500).json({ error: 'Failed to generate website intelligence signals', code: 'SIGNALS_GENERATION_FAILED' });
    }
  }
  if (req.method === 'GET') {
    try {
      const signals = await getWebsiteIntelligenceSignals({ companyId, websiteId, includeResolved: req.query.include_resolved === 'true' });
      return res.status(200).json({ signals });
    } catch (err: any) {
      console.error('[website-intelligence/signals] GET error:', err?.message);
      return res.status(500).json({ error: 'Failed to load website intelligence signals', code: 'SIGNALS_LOAD_FAILED' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
