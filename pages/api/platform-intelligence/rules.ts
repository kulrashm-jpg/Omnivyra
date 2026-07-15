import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformRules } from '../../../backend/services/platformIntelligenceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const platformKey = String(req.query.platformKey || '').trim();
    if (!platformKey) {
      return res.status(400).json({ error: 'platformKey is required' });
    }

    const bundle = await getPlatformRules(platformKey);
    if (!bundle) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    return res.status(200).json(bundle);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load platform rules' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/platform-intelligence/rules' });
