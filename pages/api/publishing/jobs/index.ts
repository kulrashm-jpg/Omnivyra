import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { ownedDbTable } from '../../../../backend/db/writeOwner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : undefined;
  let query = ownedDbTable('publishing_jobs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ jobs: data ?? [] });
}
