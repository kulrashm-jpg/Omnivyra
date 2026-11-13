import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { assessVirality } from '../../../../../backend/services/viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from '../../../../../backend/services/viralitySnapshotBuilder';
import { requireCampaignAccess } from '../../../../../backend/services/campaignAccessService';
import { wirePhase2Route } from '../../../../../backend/services/billing/phase2RouteWiring';
import { billedRouteHttpError } from '../../../../../backend/services/billing/billedRouteHttpError';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: enforce caller has access to this campaign's company.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  try {
    const { snapshot, snapshot_hash } = await buildCampaignSnapshotWithHash(id);
    // e1 2026-11-13 (C75, BLOCKING money): a virality assessment is a PAID insight (featureRegistry: the 5
    // viralityDiagnostic / Comparisons / OverallSummary operations map to insight_generation, requires_credit_hold).
    // It ran uncharged. Now one billed unit per request: hold the prescribed maximum, settle the ACTUAL usage of all
    // its AI calls, release the rest (wirePhase2Route, token-metered). Dark until enforcement is on.
    const assessment = await wirePhase2Route({
      surface:        'campaigns.virality.assess',
      organizationId: access.companyId,
      userId:         access.userId,
      action:         'insight_generation',
      referenceType:  'virality_assessment',
      referenceId:    `virality:${id}:${snapshot_hash}`,
      run: () => assessVirality(id, {
        snapshot,
        snapshot_hash,
        organizationId: access.companyId,
      }),
    });
    return res.status(200).json(assessment);
  } catch (error: any) {
    { const billedErr = billedRouteHttpError(error); if (billedErr) return res.status(billedErr.status).json(billedErr.body); }
    console.error('Error in virality assess API:', error);
    return res.status(500).json({ error: 'Failed to assess virality' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/virality/assess' });
