import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { evaluateWebsiteIntelligenceAlerts } from '../../../../backend/services/websiteIntelligenceAlertService';
import { ownedDbTable } from '../../../../backend/db/writeOwner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId =
    typeof req.query.website_id === 'string' ? req.query.website_id :
    typeof req.body?.website_id === 'string' ? req.body.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;

  if (req.method === 'POST') {
    const result = await evaluateWebsiteIntelligenceAlerts({ companyId, websiteId });
    return res.status(202).json(result);
  }
  if (req.method === 'GET') {
    let query = ownedDbTable('website_intelligence_alerts')
      .select('*')
      .eq('company_id', companyId)
      .order('last_seen_at', { ascending: false });
    if (websiteId) query = query.eq('website_id', websiteId);
    if (req.query.include_resolved !== 'true') query = query.in('status', ['open', 'acknowledged']);
    const { data, error } = await query.limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ alerts: data ?? [] });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
