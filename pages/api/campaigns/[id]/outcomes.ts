import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET  /api/campaigns/[id]/outcomes  — fetch or compute outcome score
 * POST /api/campaigns/[id]/outcomes  — trigger re-measurement
 *
 * Auth: requireAuth + requireCompanyAccess
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { measureOutcomeScore, getOutcomeSnapshot } from '../../../../backend/services/outcomeTrackingService';
import { ownerCompanyOfRow } from '../../../../backend/db/tenantTable';
import { requireAuth, requireCompanyAccess } from '../../../../backend/middleware/authMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const campaignId = req.query.id as string;
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID required' });

  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // Look up company ownership before checking access.
  // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the campaign (the same
  // campaigns.company_id as before; null for a missing, unreadable or company-less row: the same 404), and
  // requireCompanyAccess authorizes the caller for exactly that company before anything else runs.
  const companyId = await ownerCompanyOfRow('campaigns', campaignId, 'campaign outcomes: owner of the campaign');
  if (!companyId) return res.status(404).json({ error: 'Campaign not found' });

  const allowed = await requireCompanyAccess(auth.user.id, companyId, res);
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const snapshot = await getOutcomeSnapshot(campaignId);
      if (snapshot) return res.status(200).json(snapshot);

      const result = await measureOutcomeScore(campaignId, companyId);
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const result = await measureOutcomeScore(campaignId, companyId);
      return res.status(200).json(result);
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error('[campaigns/outcomes]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/outcomes' });
