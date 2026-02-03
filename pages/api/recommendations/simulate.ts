import { NextApiRequest, NextApiResponse } from 'next';
import { simulateRecommendations } from '../../../backend/services/recommendationSimulationService';
import { validatePolicy, RecommendationPolicyWeights } from '../../../backend/services/recommendationPolicyService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

export default withRBAC(handler, [Role.SUPER_ADMIN]);
