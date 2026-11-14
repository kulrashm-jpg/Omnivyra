import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/reject-preemption
 * Rejects a pending preemption request.
 * Sets status = REJECTED, rejected_at = NOW(). No campaign change.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownerOfChildRow } from '../../../backend/db/tenantTable';
import { rejectPreemptionRequest, PreemptionValidationError } from '../../../backend/services/CampaignPreemptionService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { requestId, companyId } = req.body || {};

    if (!requestId || !companyId) {
      return res.status(400).json({
        error: 'requestId and companyId are required',
      });
    }

    // S2 derive-then-authorize (ownerOfChildRow, R10): the request row (a child of its initiator campaign) yields ONLY
    // that campaign id (null for a missing / unreadable / company-less request: the same 404). The campaign is bound
    // to the caller's authorized company right below, before anything else; the row itself was never read further.
    const requestOwner = await ownerOfChildRow('campaign_preemption_requests', String(requestId), 'reject preemption: initiator campaign of the request');
    if (!requestOwner) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: requestOwner.parentId,
      requireCampaignId: true,
    });
    if (!access) return;

    // companyId: the company enforceCompanyAccess just authorized for the request's initiator campaign (it returns
    // null - and we exit above - otherwise). Passed through, never re-derived.
    await rejectPreemptionRequest(requestId, String(companyId));

    return res.status(200).json({
      status: 'REJECTED',
      requestId,
    });
  } catch (err: unknown) {
    if (err instanceof PreemptionValidationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        rejected: true,
      });
    }
    console.error('[reject-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/reject-preemption' });
