/**
 * POST /api/insight/content-ideas
 * Generates content ideas from a strategic insight using AI.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { generateContentIdeas } from '../../../backend/services/insightContentService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};
    const insight = body.insight ?? body;

    if (!insight || typeof insight !== 'object') {
      return res.status(400).json({ error: 'insight object is required' });
    }

    const contentIdeas = await generateContentIdeas({
      title: insight.title ?? '',
      summary: insight.summary ?? '',
      insight_type: insight.insight_type,
      recommended_action: insight.recommended_action,
      supporting_signals: insight.supporting_signals,
    });

    return res.status(200).json({ contentIdeas });
  } catch (err) {
    console.error('[insight/content-ideas]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate content ideas',
    });
  }
}
