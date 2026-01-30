import type { NextApiRequest, NextApiResponse } from 'next';
import { generatePromotionMetadata } from '../../../backend/services/promotionMetadataService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, contentAssetId, platform, content } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!companyId || !contentAssetId || !platform || !content) {
      return res.status(400).json({ error: 'companyId, contentAssetId, platform, content are required' });
    }
    const metadata = await generatePromotionMetadata({
      companyId,
      contentAssetId,
      platform,
      content,
    });
    return res.status(200).json(metadata);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate promotion metadata' });
  }
}
