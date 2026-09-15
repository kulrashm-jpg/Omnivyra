import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import { withApiObservability } from '../../../backend/observability';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { requireCampaignAccess, resolveCampaignCompanyId } from '../../../backend/services/campaignAccessService';

/**
 * GET /api/campaigns/stage-availability-batch?campaignIds=id1,id2,id3
 * Returns stage availability for multiple campaigns.
 * Used by dashboard to show stage cards without N individual requests.
 *
 * HARDEN-002: the same 7 lookups per campaign used to run strictly
 * sequentially (7 × N awaits — the dashboard's slowest request). They now run
 * concurrently inside each campaign, with campaigns processed in small
 * concurrent batches. Identical queries, identical response shape.
 */

type CampaignAvailability = {
  stages: Record<string, boolean>;
  counts: Record<string, number>;
};

async function computeAvailability(campaignId: string): Promise<CampaignAvailability> {
  const countOf = async (build: () => PromiseLike<{ count: number | null }>): Promise<number> => {
    try {
      const { count } = await build();
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  const [blueprint, weekPlansCount, aiEnrichedCount, dailyPlansCount, contentReadyDailyPlansCount, scheduledPostsCount, publishedPostsCount] =
    await Promise.all([
      getUnifiedCampaignBlueprint(campaignId).catch(() => null),
      countOf(() => supabase
        .from('weekly_content_refinements')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)),
      countOf(() => supabase
        .from('weekly_content_refinements')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('ai_enhancement_applied', true)),
      countOf(() => supabase
        .from('daily_content_plans')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)),
      countOf(() => supabase
        .from('daily_content_plans')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .not('content', 'is', null)),
      countOf(() => supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)),
      countOf(() => supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'published')),
    ]);

  return {
    stages: {
      twelveWeekPlan: !!(blueprint?.weeks?.length),
      detailedWeekPlans: weekPlansCount > 0,
      aiEnrichedWeeks: aiEnrichedCount > 0,
      dailyPlans: dailyPlansCount > 0,
      schedule: scheduledPostsCount > 0,
    },
    counts: {
      weekPlans: weekPlansCount,
      aiEnrichedWeeks: aiEnrichedCount,
      dailyPlans: dailyPlansCount,
      contentReadyDailyPlans: contentReadyDailyPlansCount,
      scheduledPosts: scheduledPostsCount,
      publishedPosts: publishedPostsCount,
    },
  };
}

/**
 * ROUTE-AUTH-001 — may the (already authenticated) caller see this campaign?
 *
 * The owner comes from the canonical campaign → company seam
 * (resolveCampaignCompanyId, campaign_versions). The common case — the owner is
 * one of the caller's active companies — is exactly requireCampaignAccess's
 * membership fast path, decided here without a per-id auth round-trip. Any
 * other case (super admin, invited admin, campaign-role grant) is decided by
 * requireCampaignAccess itself; its per-id denial response is discarded
 * because a batch answers per campaign, and a denied id is simply omitted.
 */
async function callerMayViewCampaign(
  req: NextApiRequest,
  campaignId: string,
  callerCompanyIds: string[],
): Promise<boolean> {
  const ownerCompanyId = await resolveCampaignCompanyId(campaignId);
  if (!ownerCompanyId) return false;
  if (callerCompanyIds.includes(ownerCompanyId)) return true;
  const discard = {
    status() { return this; },
    json() { return this; },
    setHeader() { return this; },
  } as unknown as NextApiResponse;
  return (await requireCampaignAccess(req, discard, campaignId)) !== null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001: authenticate before reading anything about any campaign.
  const user = await resolveUserContext(req);
  if (!user?.userId || user.authenticated === false) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { campaignIds } = req.query;
  if (!campaignIds || typeof campaignIds !== 'string') {
    return res.status(400).json({ error: 'campaignIds query param required (comma-separated)' });
  }

  const ids = campaignIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return res.status(200).json({ availability: {} });
  }

  // Limit to avoid abuse
  const limitedIds = ids.slice(0, 50);

  try {
    const availability: Record<string, CampaignAvailability> = {};

    // Small concurrent batches: fast without bursting hundreds of parallel
    // queries at the database.
    const BATCH = 5;
    for (let i = 0; i < limitedIds.length; i += BATCH) {
      const batch = limitedIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (campaignId) => {
          // ROUTE-AUTH-001: a campaign the caller may not see is never computed
          // and never appears in the response (no per-id existence signal).
          let allowed = false;
          try {
            allowed = await callerMayViewCampaign(req, campaignId, user.companyIds || []);
          } catch (e) {
            console.warn(`stage-availability access check for ${campaignId}:`, e);
          }
          if (!allowed) return null;
          try {
            return { campaignId, result: await computeAvailability(campaignId) };
          } catch (e) {
            console.warn(`stage-availability for ${campaignId}:`, e);
            return { campaignId, result: { stages: {}, counts: {} } as CampaignAvailability };
          }
        })
      );
      for (const entry of results) {
        if (!entry) continue;
        availability[entry.campaignId] = entry.result;
      }
    }

    // HARDEN-002: short-lived private cache — refetched with an identical URL
    // on every dashboard remount; in-page mutations (expand-to-week-plans)
    // bust via the client `_v` version param.
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.setHeader('Vary', 'Authorization');
    return res.status(200).json({ availability });
  } catch (error) {
    console.error('stage-availability-batch error:', error);
    return res.status(500).json({
      error: 'Failed to load stage availability',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// HARDEN-002: measurement only (HARDEN-001 API metrics).
export default __createApiRoute(withApiObservability(handler, '/api/campaigns/stage-availability-batch'), { route: '/api/campaigns/stage-availability-batch' });
