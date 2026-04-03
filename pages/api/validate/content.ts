
// API Endpoint for Content Validation
import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformRules } from '@/backend/services/platformIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, content, contentType = 'post', mediaUrls = [], hashtags = [] } = req.body;

    if (!platform || !content) {
      return res.status(400).json({
        success: false,
        error: 'Platform and content are required',
      });
    }

    const bundle = await getPlatformRules(platform);
    if (!bundle) {
      return res.status(400).json({
        success: false,
        error: `Platform ${platform} not supported`,
      });
    }

    const normalizedType = String(contentType || 'post').toLowerCase().trim();
    const rules = bundle.content_rules || [];
    const rule =
      rules.find((r: any) => String(r?.content_type || '').toLowerCase().trim() === normalizedType) || rules[0];

    const errors: string[] = [];
    const warnings: string[] = [];

    const maxChars = rule?.max_characters != null ? Number(rule.max_characters) : null;
    if (maxChars && String(content).length > maxChars) {
      errors.push(`Content exceeds character limit of ${maxChars}`);
    }

    const hashtagLimit =
      rule?.formatting_rules && typeof rule.formatting_rules === 'object'
        ? Number((rule.formatting_rules as any).hashtag_limit ?? 0)
        : 0;
    const hashtagCount = Array.isArray(hashtags) ? hashtags.length : 0;
    if (hashtagLimit > 0 && hashtagCount > hashtagLimit) {
      errors.push(`Too many hashtags. Maximum allowed: ${hashtagLimit}`);
    }

    const mediaCount = Array.isArray(mediaUrls) ? mediaUrls.length : 0;
    const mediaFormat = String(rule?.media_format || 'text').toLowerCase();
    if (mediaFormat === 'text' && mediaCount > 0) {
      warnings.push('This content type is typically text-only; media may be ignored');
    }
    if (mediaFormat !== 'text' && mediaCount === 0) {
      warnings.push('This content type typically performs better with media');
    }

    const validation = { valid: errors.length === 0, errors, warnings };

    res.status(200).json({
      success: true,
      data: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        platform,
        contentType,
        characterCount: content.length,
        hashtagCount,
        mediaCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
