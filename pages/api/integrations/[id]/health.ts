import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getIntegration } from '../../../../backend/services/integrationService';
import { runIntegrationHealthCheck } from '../../../../backend/services/integrationHealthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const integration = await getIntegration(id, companyId);
  if (!integration?.website_connection_id) return res.status(404).json({ error: 'Integration connection not found' });
  const result = await runIntegrationHealthCheck({ companyId, connectionId: integration.website_connection_id });
  return res.status(200).json(result);
}
