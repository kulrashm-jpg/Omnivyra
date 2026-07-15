import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { aggregateWebsiteAnalytics } from '../../../backend/services/websiteAnalyticsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.ANALYTICS_WORKER_SECRET;
  if (expected) {
    const provided = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : '';
    if (provided !== expected) return res.status(401).json({ error: 'Invalid worker secret' });
  }
  const result = await aggregateWebsiteAnalytics({
    websiteId: typeof req.body?.website_id === 'string' ? req.body.website_id : undefined,
    day: typeof req.body?.day === 'string' ? req.body.day : undefined,
  });
  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-analytics/aggregate' });
