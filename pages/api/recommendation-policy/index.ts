import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getActivePolicy,
  updatePolicy,
  validatePolicy,
  RecommendationPolicyWeights,
} from '../../../backend/services/recommendationPolicyService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can manage recommendation policies.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isAdmin = await ensureSuperAdmin(req, res);
  if (!isAdmin) return;

  if (req.method === 'GET') {
    try {
      const policy = await getActivePolicy();
      return res.status(200).json({ policy });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load policy' });
    }
  }

  if (req.method === 'POST') {
    const { id, weights } = req.body || {};
    if (!id || !weights) {
      return res.status(400).json({ error: 'Policy id and weights are required' });
    }

    const validation = validatePolicy(weights as RecommendationPolicyWeights);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message || 'Invalid policy weights' });
    }

    try {
      const updated = await updatePolicy(id, weights);
      return res.status(200).json({ policy: updated });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update policy' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
