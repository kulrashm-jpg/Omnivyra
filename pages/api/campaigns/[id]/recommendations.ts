import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getCampaignById } from '../../../../backend/db/campaignStore';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { getUnifiedCampaignBlueprint } from '../../../../backend/services/campaignBlueprintService';
import {
  generateCampaignRecommendations,
  fetchRecommendationWeeks,
} from '../../../../backend/services/campaignRecommendationExtensionService';
import { formatForUserOutput } from '../../../../backend/utils/refineUserFacingResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  // TENANT (e9, BLOCKING): the company came from campaign_versions / campaigns (reads unchecked) and,
  // failing those, from the request BODY or QUERY, and the caller was authorized against it without
  // binding the campaign (requireCampaignId:false). POST then wrote recommendation weeks for the
  // campaign, so a member of A could target B's company-less campaign with their own company. The
  // campaign is now bound by requireCampaignAccess (company resolved server-side, membership proven,
  // lookup failure refused); a body/query companyId is only a claim that must MATCH.
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;
  const claimedCompanyId =
    typeof req.body?.companyId === 'string' ? req.body.companyId.trim()
      : typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (claimedCompanyId && claimedCompanyId !== access.companyId) {
    return res.status(403).json({ code: 'CAMPAIGN_NOT_IN_COMPANY', error: 'Campaign does not belong to the given company' });
  }
  const companyId = access.companyId;

  if (req.method === 'GET') {
    try {
      const { sessionId, status } = req.query;
      let resolvedSessionId: string | undefined = typeof sessionId === 'string' ? sessionId : undefined;

      // Fetch committed plan for base week structure
      const blueprint = await getUnifiedCampaignBlueprint(campaignId);
      const rawWeeks = blueprint?.weeks ?? [];
      // Normalize week_number for consistent matching (handles string/number from JSON/DB)
      const committedWeeks = rawWeeks.map((w: any) => ({
        ...w,
        week_number: Number(w.week_number ?? w.week ?? 0),
      }));
      const camp = await getCampaignById<{ duration_weeks?: number }>(campaignId, 'duration_weeks');
      const resolved = (blueprint as any)?.duration_weeks ?? camp?.duration_weeks ?? committedWeeks.length;
      const durationWeeks = resolved && resolved > 0 ? resolved : 12;

      // Fetch recommendations — use latest session if none specified to avoid duplicate weeks
      let recs = await fetchRecommendationWeeks({
        campaignId,
        sessionId: resolvedSessionId,
        status: (status as 'pending' | 'agreed' | 'applied') || 'pending',
      });

      if (recs.length > 0 && !resolvedSessionId) {
        const latestSessionId = recs[recs.length - 1]?.session_id || recs[0]?.session_id;
        if (latestSessionId) {
          resolvedSessionId = latestSessionId;
          recs = await fetchRecommendationWeeks({
            campaignId,
            sessionId: resolvedSessionId,
            status: (status as 'pending' | 'agreed' | 'applied') || 'pending',
          });
        }
      }

      const recByWeek = new Map(recs.map((r: any) => [r.week_number, r]));

      const response = {
        recommendations: recs,
        sessionId: resolvedSessionId ? resolvedSessionId : (recs[0]?.session_id ?? null),
        committedWeeks,
        durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : 12,
        recByWeek: Object.fromEntries(recByWeek),
      };
      const refined = await formatForUserOutput(response);
      return res.status(200).json(refined);
    } catch (error: any) {
      console.error('Error fetching recommendations:', error);
      return res.status(500).json({ error: error?.message || 'Failed to fetch recommendations' });
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await generateCampaignRecommendations({ campaignId, companyId });
      const response = { sessionId: result.sessionId, weeks: result.weeks };
      const refined = await formatForUserOutput(response);
      return res.status(200).json(refined);
    } catch (error: any) {
      console.error('Error generating recommendations:', error);
      return res.status(500).json({ error: error?.message || 'Failed to generate recommendations' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/recommendations' });
