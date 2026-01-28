import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getRecommendationAnalytics } from '../../../backend/services/recommendationAnalyticsService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can view recommendation analytics.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAdmin = await ensureSuperAdmin(req, res);
  if (!isAdmin) return;

  const { fromDate, toDate, campaignId, companyId } = req.query;
  try {
    const analytics = await getRecommendationAnalytics({
      fromDate: typeof fromDate === 'string' ? fromDate : undefined,
      toDate: typeof toDate === 'string' ? toDate : undefined,
      campaignId: typeof campaignId === 'string' ? campaignId : undefined,
      companyId: typeof companyId === 'string' ? companyId : undefined,
    });
    return res.status(200).json(analytics);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
}
