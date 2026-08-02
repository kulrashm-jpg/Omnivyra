import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/companies/[id]/learnings?limit=<n>
 * Returns campaign learnings with decay-adjusted ranking for a company.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getEffectiveLearnings } from '../../../../backend/services/learningDecayService';
import { resolveCompanyAccess } from '../../../../backend/services/contentArchitectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const companyId = req.query.id as string;
  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const learnings = await getEffectiveLearnings(companyId, { limit });
    return res.status(200).json(learnings);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/companies/:id/learnings' });
