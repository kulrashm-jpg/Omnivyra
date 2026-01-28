import type { NextApiRequest, NextApiResponse } from 'next';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';
import { detectContentOverlap } from '../../../backend/services/contentOverlapService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, proposedPlan, campaignId } = req.body || {};
    if (!companyId || !proposedPlan) {
      return res.status(400).json({ error: 'companyId and proposedPlan are required' });
    }
    const memory = await getCampaignMemory({ companyId, campaignId });
    const proposedContent = [
      ...(proposedPlan.themes || []),
      ...(proposedPlan.topics || []),
      ...(proposedPlan.hooks || []),
      ...(proposedPlan.messages || []),
    ].filter(Boolean);

    const overlap = await detectContentOverlap({
      companyId,
      newProposedContent: proposedContent,
      campaignMemory: memory,
    });

    const status =
      overlap.similarityScore > 0.8
        ? 'blocked'
        : overlap.similarityScore > 0.6
        ? 'warning'
        : 'clear';

    return res.status(200).json({
      status,
      conflicts: overlap.overlappingItems.map((item) => ({
        field: 'topic',
        value: item,
        reason: 'Similar to past campaign content',
      })),
      suggestions: [overlap.recommendation],
      overlap,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to validate uniqueness' });
  }
}
