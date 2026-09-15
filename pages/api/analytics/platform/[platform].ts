import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Analytics API - Get platform performance
 * GET /api/analytics/platform/[platform]
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformPerformance } from '../../../../backend/services/analyticsService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): platform_performance rows are owned by
  // user_id. The route used to read ANY user's rows by a client-supplied
  // ?user_id with no authentication. The owner is now the authenticated
  // caller; a client-supplied user_id is ignored.
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { platform } = req.query;
    const { start_date, end_date } = req.query;

    if (!platform || typeof platform !== 'string') {
      return res.status(400).json({ error: 'platform is required' });
    }

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    const startDate = new Date(start_date as string);
    const endDate = new Date(end_date as string);

    const performance = await getPlatformPerformance(user.id, platform, startDate, endDate);

    res.status(200).json({
      success: true,
      data: performance,
    });
  } catch (error: any) {
    console.error('Platform analytics API error:', error);
    res.status(500).json({
      error: 'Failed to fetch platform performance',
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/platform/:platform' });
