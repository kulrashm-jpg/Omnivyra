import type { NextApiRequest, NextApiResponse } from 'next';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, lookbackPeriod } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const memory = await getCampaignMemory({ companyId, campaignId, lookbackPeriod });
    return res.status(200).json(memory);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load campaign memory' });
  }
}
