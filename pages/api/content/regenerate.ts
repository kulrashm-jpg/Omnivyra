import type { NextApiRequest, NextApiResponse } from 'next';
import { regenerateContentAsset } from '../../../backend/services/contentAssetService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { assetId, instruction } = req.body || {};
    if (!assetId || !instruction) {
      return res.status(400).json({ error: 'assetId and instruction are required' });
    }
    const updated = await regenerateContentAsset({ assetId, instruction });
    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to regenerate content' });
  }
}
