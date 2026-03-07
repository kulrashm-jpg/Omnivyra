import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { recordOutcome, getOutcomeHistory } from '../../../backend/services/outcomeTrackingEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const user = await resolveUserContext(req);
      const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? 100), 10) || 100));
      const outcomes = await getOutcomeHistory(companyId, { limit });
      return res.status(200).json({ outcomes });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch outcomes';
      console.error('[intelligence/outcomes]', message);
      return res.status(500).json({ error: message });
    }
  }

  if (req.method === 'POST') {
    try {
      const user = await resolveUserContext(req);
      const companyId = user?.defaultCompanyId ?? (req.body?.companyId as string);
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      const { recommendation_id, outcome_type, success_score } = req.body ?? {};
      const validTypes = ['content_published', 'campaign_created', 'feature_built', 'competitive_response', 'market_entry'];
      if (!outcome_type || !validTypes.includes(outcome_type)) {
        return res.status(400).json({ error: 'Valid outcome_type required' });
      }
      const result = await recordOutcome({
        company_id: companyId,
        recommendation_id: recommendation_id ?? null,
        outcome_type,
        success_score: typeof success_score === 'number' ? success_score : 0.5,
      });
      return res.status(200).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to record outcome';
      console.error('[intelligence/outcomes]', message);
      return res.status(500).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
