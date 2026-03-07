import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { recordFeedback, getFeedbackForCompany } from '../../../backend/services/recommendationFeedbackEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const user = await resolveUserContext(req);
      const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? 100), 10) || 100));
      const feedback = await getFeedbackForCompany(companyId, { limit });
      return res.status(200).json({ feedback });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch feedback';
      console.error('[intelligence/feedback]', message);
      return res.status(500).json({ error: message });
    }
  }

  if (req.method === 'POST') {
    try {
      const user = await resolveUserContext(req);
      const companyId = user?.defaultCompanyId ?? (req.body?.companyId as string);
      const userId = user?.userId ?? (req.body?.user_id as string);
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      if (!userId) {
        return res.status(400).json({ error: 'user_id required' });
      }
      const { recommendation_id, feedback_type } = req.body ?? {};
      const validTypes = ['accepted', 'ignored', 'executed', 'successful', 'failed'];
      if (!recommendation_id || !feedback_type || !validTypes.includes(feedback_type)) {
        return res.status(400).json({ error: 'Valid recommendation_id and feedback_type required' });
      }
      const result = await recordFeedback({
        company_id: companyId,
        recommendation_id,
        user_id: userId,
        feedback_type: feedback_type as 'accepted' | 'ignored' | 'executed' | 'successful' | 'failed',
      });
      return res.status(200).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to record feedback';
      console.error('[intelligence/feedback]', message);
      return res.status(500).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
