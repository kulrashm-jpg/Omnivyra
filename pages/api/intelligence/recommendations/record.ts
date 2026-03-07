import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { persistRecommendation } from '../../../../backend/services/recommendationPersistenceService';

/**
 * POST /api/intelligence/recommendations/record
 * Persist a recommendation for outcome/feedback linking. Returns persisted record with id.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.body?.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const { recommendation_type, action_summary, supporting_signals, confidence_score } = req.body ?? {};
    const validTypes = ['content_opportunity', 'product_opportunity', 'marketing_opportunity', 'competitive_opportunity'];
    if (!recommendation_type || !validTypes.includes(recommendation_type)) {
      return res.status(400).json({ error: 'Valid recommendation_type required' });
    }
    const persisted = await persistRecommendation(companyId, {
      recommendation_type,
      action_summary: action_summary ?? null,
      supporting_signals: Array.isArray(supporting_signals) ? supporting_signals : [],
      confidence_score: typeof confidence_score === 'number' ? confidence_score : 0.5,
    });
    return res.status(200).json({ recommendation: persisted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to record recommendation';
    console.error('[intelligence/recommendations/record]', message);
    return res.status(500).json({ error: message });
  }
}
