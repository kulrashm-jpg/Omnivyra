import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { simulateRecommendations } from '../../../backend/services/recommendationSimulationService';
import { validatePolicy, RecommendationPolicyWeights } from '../../../backend/services/recommendationPolicyService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can simulate recommendation policies.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAdmin = await ensureSuperAdmin(req, res);
  if (!isAdmin) return;

  const { companyId, campaignId, draftPolicyWeights } = req.body || {};
  if (!draftPolicyWeights) {
    return res.status(400).json({ error: 'draftPolicyWeights is required' });
  }

  const validation = validatePolicy(draftPolicyWeights as RecommendationPolicyWeights);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message || 'Invalid policy weights' });
  }

  try {
    const result = await simulateRecommendations({
      companyId,
      campaignId,
      draftPolicyWeights,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to simulate recommendations' });
  }
}
