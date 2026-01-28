import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getAuditByRecommendationId } from '../../../../backend/services/recommendationAuditService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can view recommendation audit logs.',
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

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  try {
    const audit = await getAuditByRecommendationId(id);
    return res.status(200).json({ audit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load recommendation audit log' });
  }
}
