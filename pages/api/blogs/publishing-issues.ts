import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/blogs/publishing-issues?company_id=
 *
 * The company's dead-lettered CMS publishing jobs, one per blog, with the evidence an operator needs
 * to decide whether to retry (the CMS, the last attempt's answer and time, whether the post may
 * already be live). Company-scoped read; an unreadable queue is a 500, never "no issues".
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { listPublishingIssues } from '../../../backend/services/publishingJobService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const issues = await listPublishingIssues(companyId);
    return res.status(200).json({ issues });
  } catch (err) {
    console.error('[blogs/publishing-issues] read failed', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Could not load publishing issues. Please try again.' });
  }
}

export default __createApiRoute(handler, { route: '/api/blogs/publishing-issues' });
