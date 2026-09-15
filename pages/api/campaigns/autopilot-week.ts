import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { runAutopilotForWeek, persistAutopilotSchedule } from '../../../backend/services/autopilotExecutionPipeline';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

/** The campaign a week payload claims: week.campaignId / week.campaign_id / its first item's campaign_id. */
function claimedCampaignId(week: Record<string, unknown>): string | null {
  const items = Array.isArray(week.daily_execution_items)
    ? (week.daily_execution_items as Array<Record<string, unknown>>)
    : [];
  const firstItem = items[0] || {};
  return (
    (typeof week.campaignId === 'string' && week.campaignId) ||
    (typeof week.campaign_id === 'string' && week.campaign_id) ||
    (typeof firstItem.campaign_id === 'string' && firstItem.campaign_id) ||
    null
  );
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001: this route runs LLM content generation and persists the
  // schedule onto the campaign's daily plans. Authenticate first.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const { week, options } = req.body || {};
    if (!week || typeof week !== 'object') {
      return res.status(400).json({ error: 'week is required' });
    }

    // ROUTE-AUTH-001: bind the campaign the payload names BEFORE generation,
    // and persist only against that bound campaign. A payload that names no
    // campaign is compute-only (persistAutopilotSchedule skips it).
    const requestedCampaignId = claimedCampaignId(week as Record<string, unknown>);
    let campaignId: string | null = null;
    if (requestedCampaignId) {
      const access = await requireCampaignAccess(req, res, requestedCampaignId);
      if (!access) return;
      campaignId = access.campaignId;
    }

    const timezone = typeof options?.timezone === 'string' ? options.timezone : 'UTC';
    const result = await runAutopilotForWeek(week, { timezone });

    // Persist the scheduling decision exactly once via the canonical write
    // boundary so the schedule survives reload (the pipeline itself is pure
    // compute). Campaign is the one bound above; week from the payload or items.
    const items = Array.isArray((result.week as { daily_execution_items?: unknown })?.daily_execution_items)
      ? (result.week as { daily_execution_items: Array<Record<string, unknown>> }).daily_execution_items
      : [];
    const firstItem = items[0] || {};
    const weekNumberRaw =
      (week as { weekNumber?: unknown }).weekNumber ??
      (week as { week_number?: unknown }).week_number ??
      firstItem.week_number;
    const weekNumber = Number(weekNumberRaw);

    // Items the pipeline produced may name a campaign the input did not; that
    // campaign is bound the same way before anything is persisted against it.
    if (!campaignId && typeof firstItem.campaign_id === 'string' && firstItem.campaign_id) {
      const access = await requireCampaignAccess(req, res, firstItem.campaign_id);
      if (!access) return;
      campaignId = access.campaignId;
    }

    const { persisted } = await persistAutopilotSchedule(items as never, { campaignId, weekNumber });

    return res.status(200).json({
      success: true,
      week: result.week,
      summary: result.summary,
      persisted,
    });
  } catch (error) {
    console.error('[autopilot-week] failed', error);
    return res.status(500).json({
      error: 'Failed to run autopilot week',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/autopilot-week' });
