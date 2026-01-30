import type { NextApiRequest, NextApiResponse } from 'next';
import { getContentAssetById, listContentVersions } from '../../../backend/db/contentAssetStore';
import { generatePromotionMetadata } from '../../../backend/services/promotionMetadataService';
import { formatPlatformContent } from '../../../backend/services/platformContentFormatter';
import { validatePlatformCompliance } from '../../../backend/services/platformComplianceService';
import { getOmniVyraAdvisory } from '../../../backend/services/omnivyraAdapterService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, contentAssetId, platform, contentType, omnivyraRecommendation } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!companyId || !contentAssetId || !platform || !contentType) {
      return res.status(400).json({ error: 'companyId, contentAssetId, platform, contentType are required' });
    }

    const asset = await getContentAssetById(contentAssetId);
    if (!asset) {
      return res.status(404).json({ error: 'Content asset not found' });
    }

    const versions = await listContentVersions(contentAssetId);
    const latest = versions[versions.length - 1]?.content_json ?? {};
    const metadata = await generatePromotionMetadata({
      companyId,
      contentAssetId,
      platform,
      content: latest,
    });

    const omnivyraAdvisory = await getOmniVyraAdvisory({
      recommendation: omnivyraRecommendation,
      context: { companyId, contentAssetId, platform, contentType },
    });
    const formatted = await formatPlatformContent({
      contentAssetId,
      platform,
      contentType,
      content: latest,
      hashtags: metadata.hashtags || [],
      omnivyraAdvisory,
    });

    const compliance = await validatePlatformCompliance({
      contentAssetId,
      platform,
      contentType,
      formattedContent: formatted.variant.formatted_content,
      rule: formatted.rule,
      promotionMetadata: metadata,
    });

    return res.status(200).json({
      rule: formatted.rule,
      metadata,
      variant: formatted.variant,
      compliance,
      omnivyraAdvisory,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to format content' });
  }
}
