import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../backend/services/rbacService';
import {
  getActivePolicy,
  updatePolicy,
  validatePolicy,
  RecommendationPolicyWeights,
} from '../../backend/services/recommendationPolicyService';

const defaultWeights: RecommendationPolicyWeights = {
  trend_score: 1,
  geo_fit: 1,
  audience_fit: 1,
  category_fit: 1,
  platform_fit: 1,
  health_multiplier: 1,
  historical_accuracy: 1,
  effort_penalty: 0.1,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (req.method === 'GET') {
    try {
      let policy = await getActivePolicy();
      if (!policy) {
        const { data, error } = await supabase
          .from('recommendation_policies')
          .insert({
            name: 'Default Policy',
            is_active: true,
            weights: defaultWeights,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select('*')
          .single();
        if (!error && data) {
          policy = data;
        }
      }
      return res.status(200).json({ policy: policy || null });
    } catch (error) {
      console.error('Failed to load recommendation policy', error);
      return res.status(500).json({ error: 'Failed to load policy' });
    }
  }

  if (req.method === 'POST') {
    const allowed = await isSuperAdmin(user.id);
    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const { id, weights } = req.body || {};
    if (!id || !weights) {
      return res.status(400).json({ error: 'id and weights are required' });
    }
    const validation = validatePolicy(weights);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message || 'Invalid policy weights' });
    }
    try {
      const policy = await updatePolicy(id, weights);
      return res.status(200).json({ policy });
    } catch (error) {
      console.error('Failed to update recommendation policy', error);
      return res.status(500).json({ error: 'Failed to update policy' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
