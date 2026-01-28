import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformVariant, getPromotionMetadata, getPlatformRule } from '../../../backend/db/platformPromotionStore';
import { validatePlatformCompliance } from '../../../backend/services/platformComplianceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contentAssetId, platform, contentType } = req.body || {};
    if (!contentAssetId || !platform || !contentType) {
      return res.status(400).json({ error: 'contentAssetId, platform, contentType are required' });
    }

    const variant = await getPlatformVariant(contentAssetId, platform);
    const metadata = await getPromotionMetadata(contentAssetId, platform);
    const rule = await getPlatformRule(platform, contentType);
    if (!variant || !metadata || !rule) {
      return res.status(404).json({ error: 'Missing variant/metadata/rule' });
    }

    const compliance = await validatePlatformCompliance({
      contentAssetId,
      platform,
      contentType,
      formattedContent: variant.formatted_content,
      rule,
      promotionMetadata: metadata,
    });

    return res.status(200).json(compliance);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to run compliance check' });
  }
}
