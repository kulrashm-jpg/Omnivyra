import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/activity-workspace/creative?company_id&activity_id
 *
 * The AI creative belonging to one generated activity, plus the composition
 * identity its refinements attach to.
 *
 * WHY A SEPARATE ROUTE
 * --------------------
 * `resolve.ts` answers "what is this whole workspace?" and is already large.
 * This answers one narrow question a card asks about itself, and is read by the
 * refinement panel alone. Folding it into the workspace payload would make
 * every workspace load pay for something only one card needs.
 *
 * It creates nothing. The activity already names its creative — the generation
 * worker recorded it — so this reads a relationship rather than establishing
 * one, and the composition identity it returns is derived, not minted.
 *
 * The stock-image path is untouched: this route knows nothing about it.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import {
  resolveActivityCreative,
  activityCreativeIsRefinable,
} from '@/backend/services/creator/activityCreativeService';

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = str(req.query.company_id);
  const activityId = str(req.query.activity_id);
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!activityId) return res.status(400).json({ error: 'activity_id required' });

  // The SAME access gate the rest of the workspace uses. The company is taken
  // from the authenticated session's allowed set, never from the query alone.
  if (isContentArchitectSession(req)) {
    if (checkContentArchitectAccess(req, res, companyId) === null) return;
  } else {
    const access = await enforceCompanyAccess({ req, res, companyId, requireCampaignId: false });
    if (!access) return;
  }

  const creative = await resolveActivityCreative({ companyId, activityId });
  /*
   * 404 rather than 403 for a foreign activity.
   *
   * The service already refuses to distinguish "not yours" from "does not
   * exist"; saying so here too keeps the endpoint from confirming which
   * activity ids belong to another tenant.
   */
  if (!creative) return res.status(404).json({ error: 'Activity not found' });

  /*
   * The template's own slots, resolved through the ONE canonical resolver.
   *
   * Without these the attachment panel offers no usages at all — it reads
   * absent slots as "this design accepts nothing" — so a user could upload and
   * then have nothing to attach it to. The activity already records which
   * template it was generated from; this is simply asking that template what it
   * accepts, exactly as Content Creator does.
   *
   * Best-effort: an unresolvable id yields no slots, and the panel then
   * correctly says this design takes no images rather than guessing.
   */
  const templateSlots = await (async () => {
    if (!creative.templateId) return null;
    try {
      const { getTemplateById } = await import('@/lib/creator-templates');
      const { registerCuratedSystemTemplates } = await import('@/lib/creator-outcomes/curatedSystemTemplatesFull');
      registerCuratedSystemTemplates();
      return getTemplateById(creative.templateId)?.assetSlots ?? null;
    } catch { return null; }
  })();

  return res.status(200).json({
    activity_id: creative.activityId,
    creator_asset_id: creative.creatorAssetId,
    asset_type: creative.assetType,
    template_id: creative.templateId,
    // What this design accepts. The panel offers only these.
    template_slots: templateSlots,
    urls: creative.urls,
    content_status: creative.contentStatus,
    // Which render the urls above are: 1 = the campaign's own, higher = a refinement.
    current_version: creative.currentVersion,
    is_refined: creative.isRefined,
    // What a refinement attaches to. Durable, activity-specific, server-derived.
    composition_type: creative.compositionType,
    composition_id: creative.compositionId,
    refinable: activityCreativeIsRefinable(creative),
  });
}

export default __createApiRoute(handler, { route: '/api/activity-workspace/creative' });
