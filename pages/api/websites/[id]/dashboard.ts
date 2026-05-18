import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { assertWebsiteCompanyAccess } from '../../../../backend/services/websiteService';
import { ownedDbTable } from '../../../../backend/db/writeOwner';
import { getWebsiteHealthSummary } from '../../../../backend/services/integrationHealthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.id === 'string' ? req.query.id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!websiteId) return res.status(400).json({ error: 'website id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const website = await assertWebsiteCompanyAccess(companyId, websiteId);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const [forms, blogs, jobs, analytics, health] = await Promise.all([
    ownedDbTable('forms').select('id, name, created_at').eq('company_id', companyId).eq('website_id', websiteId).limit(20),
    ownedDbTable('blogs').select('id, title, status, published_at, updated_at').eq('company_id', companyId).eq('website_id', websiteId).order('updated_at', { ascending: false }).limit(20),
    ownedDbTable('publishing_jobs').select('*').eq('company_id', companyId).eq('website_id', websiteId).order('created_at', { ascending: false }).limit(20),
    ownedDbTable('website_analytics_daily').select('*').eq('website_id', websiteId).order('day', { ascending: false }).limit(14),
    getWebsiteHealthSummary(companyId, websiteId),
  ]);

  return res.status(200).json({
    website,
    forms: forms.data ?? [],
    blogs: blogs.data ?? [],
    publishing_jobs: jobs.data ?? [],
    analytics: analytics.data ?? [],
    health,
  });
}
