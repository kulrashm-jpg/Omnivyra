import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

const ENGAGEMENT_LEADS_API_OVERRIDE = false as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (ENGAGEMENT_LEADS_API_OVERRIDE) {
    return res.status(500).json({
      error: 'Engagement lead workspace override is disabled. Lead management must stay in Active Leads.',
    });
  }

  return res.status(410).json({
    error: 'Engagement lead workspace has been removed. Use /api/leads/signals and Active Leads instead.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/leads' });
