import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { ownedDbTable } from '../../../../backend/db/writeOwner';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  let query = ownedDbTable('reconciliation_jobs').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ jobs: data ?? [] });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/publishing/reconcile/jobs' });
