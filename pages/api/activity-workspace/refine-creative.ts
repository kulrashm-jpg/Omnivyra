import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/activity-workspace/refine-creative
 * { company_id, activity_id }
 *
 * Renders a refinement of this activity's creative and records it as a new
 * version of the same asset. The campaign's original stays version 1.
 *
 * It takes NO references in its body, deliberately. The accepted references
 * already live against the activity's composition, and the render resolves them
 * through the one resolver — so there is no way for a caller to smuggle in a
 * reference that never passed routing, tenancy and lifecycle checks.
 *
 * The stock-image control on the same card is untouched and unaware of this.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import { resolveUserContext } from '@/backend/services/userContextService';
import { refineActivityCreative } from '@/backend/services/creator/activityCreativeRefinementService';

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A person-facing sentence for each way refinement can decline. */
const MESSAGES: Record<string, string> = {
  activity_not_found: 'That activity could not be found.',
  not_refinable: 'This activity does not have a generated image to refine yet.',
  render_failed: 'The refinement could not be generated. Your original is unchanged — please try again.',
  asset_unavailable: 'The refinement was generated but could not be saved. Your original is unchanged.',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = str(req.body?.company_id);
  const activityId = str(req.body?.activity_id);
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!activityId) return res.status(400).json({ error: 'activity_id required' });

  // The same gate the rest of the workspace uses. The company must be one this
  // session is actually allowed to act for.
  if (isContentArchitectSession(req)) {
    if (checkContentArchitectAccess(req, res, companyId) === null) return;
  } else {
    const access = await enforceCompanyAccess({ req, res, companyId, requireCampaignId: false });
    if (!access) return;
  }

  const user = await resolveUserContext(req);
  const result = await refineActivityCreative({
    companyId,
    userId: user?.userId ?? null,
    activityId,
  });

  if (!result.ok) {
    /*
     * A foreign or missing activity is 404 for the same reason the read route
     * uses 404: anything else confirms which ids exist under another tenant.
     * Everything else is 422 — the request was understood and legitimate, the
     * refinement simply did not happen, and the original is untouched.
     */
    const status = result.reason === 'activity_not_found' ? 404 : 422;
    return res.status(status).json({
      error: MESSAGES[result.reason ?? ''] ?? 'The refinement could not be completed.',
      reason: result.reason,
      // Stated explicitly so no client has to infer it from a failure.
      original_preserved: true,
    });
  }

  return res.status(200).json({
    activity_id: result.activityId,
    creator_asset_id: result.creatorAssetId,
    composition_id: result.compositionId,
    version: result.version,
    original_version: result.originalVersion,
    urls: result.urls,
  });
}

export default __createApiRoute(handler, { route: '/api/activity-workspace/refine-creative' });
