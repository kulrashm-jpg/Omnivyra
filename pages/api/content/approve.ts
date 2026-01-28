import type { NextApiRequest, NextApiResponse } from 'next';
import { approveContentAsset } from '../../../backend/services/contentAssetService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { assetId, approver } = req.body || {};
    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }
    const updated = await approveContentAsset({ assetId, approver });
    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to approve content' });
  }
}
