import { NextApiRequest, NextApiResponse } from 'next';
import { getAlgorithmicFormattingRules } from '@/backend/services/platformAlgorithmFormattingRules';
import { getDiscoverabilityTargets } from '@/backend/services/discoverabilityRules';

/**
 * GET /api/content/platform-rules?platform=linkedin
 * Returns display-only platform rules (formatting + discoverability) so the workspace
 * can show "Rules applied" transparency. Backend remains source of truth for application.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const platform = String((req.query.platform as string) || '').trim().toLowerCase();
  if (!platform) {
    return res.status(400).json({ error: 'platform query is required' });
  }
  try {
    const formatting = getAlgorithmicFormattingRules(platform);
    const discoverability = getDiscoverabilityTargets(platform);
    return res.status(200).json({
      platform,
      guidelines: formatting.guidelines ?? [],
      discoverability: {
        hashtagMin: discoverability.hashtagMin,
        hashtagMax: discoverability.hashtagMax,
        hashtagRecommended: discoverability.hashtagRecommended,
      },
    });
  } catch (e) {
    console.error('platform-rules error:', e);
    return res.status(500).json({ error: 'Failed to load platform rules' });
  }
}
