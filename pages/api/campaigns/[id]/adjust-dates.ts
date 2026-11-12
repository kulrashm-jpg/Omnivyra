import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Campaign Date Adjustment API: RETIRED (e9 ruling, 2026-11-12).
 * POST /api/campaigns/[id]/adjust-dates answers 410 ROUTE_RETIRED and writes nothing.
 *
 * Why: schedulingService.adjustCampaignDates shifted every weekly, daily and scheduled-post row by
 * (new start - campaigns.start_date) but never updated campaigns.start_date, so EVERY call (even a
 * successful one) shifted the scheduled posts again; it shifted row by row with no transaction and
 * every PostgREST result unread, so a mid-loop failure left a mix and still answered 200; and it took
 * the acting user_id from the request body. No caller was found (app, extension, docs).
 *
 * Post-launch (logged by e9): an atomic RPC that shifts all rows AND sets campaigns.start_date in one
 * transaction on the locked campaign row, attributed to the principal (never the body). Rebuild this
 * route on it only if the owner wants "move campaign dates" back.
 */

import { NextApiRequest, NextApiResponse } from 'next';

async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    code: 'ROUTE_RETIRED',
    error: 'Adjusting campaign dates is not available. No dates were changed.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/adjust-dates' });
