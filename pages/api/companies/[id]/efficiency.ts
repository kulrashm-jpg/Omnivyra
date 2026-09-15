import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET  /api/companies/[id]/efficiency  — full efficiency report
 * POST /api/companies/[id]/efficiency  — trigger optimization run
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { optimizeCreditEfficiency } from '../../../../backend/services/creditEfficiencyEngine';
import { getCompanyOutcomeStats } from '../../../../backend/services/outcomeTrackingService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = req.query.id as string;
  if (!companyId) return res.status(400).json({ error: 'Company ID required' });

  // ROUTE-AUTH-001 (STEP 3AH-85): the path company id was used with no
  // authentication for both the read and the optimization run (which writes
  // the company's efficiency tier). Caller must be a member of that company.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    if (req.method === 'GET') {
      const stats = await getCompanyOutcomeStats(companyId);
      return res.status(200).json(stats);
    }

    if (req.method === 'POST') {
      const report = await optimizeCreditEfficiency(companyId);
      return res.status(200).json(report);
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error('[companies/efficiency]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/companies/:id/efficiency' });
