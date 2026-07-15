import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { buildTrackingAssistResponse } from '../../../backend/services/googleAnalyticsExperienceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const websiteUrl = typeof req.body?.website_url === 'string' ? req.body.website_url.trim() : '';
  const platform = typeof req.body?.platform === 'string' ? req.body.platform.trim() : '';

  if (!websiteUrl || !platform) {
    return res.status(400).json({
      status: 'error',
      message: 'website_url and platform are required',
    });
  }

  return res.status(200).json(buildTrackingAssistResponse({
    website_url: websiteUrl,
    platform,
  }));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/tracking-assist' });
