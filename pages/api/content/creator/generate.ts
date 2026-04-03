/**
 * POST /api/content/creator/generate
 *
 * Generate creator content (video, carousel, story) from blog context.
 *
 * Accepts card context from blog intelligence and routes to appropriate creator generator.
 * Returns jobId for async polling.
 *
 * Body:
 * {
 *   company_id: string,
 *   content_type: 'video_script' | 'carousel' | 'story',
 *   topic: string,
 *   audience?: string,
 *   gap_reason?: string,  // Why this gap exists (from blog intelligence)
 *   content_theme?: string, // 'educational', 'inspirational', etc.
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import {
  generateVideoScript,
  generateCarousel,
  generateVisualStory,
  type CreatorContextEnrichment,
} from '../../../../backend/adapters/commandCenter/creatorContentAdapter';
import { getProfile } from '../../../../backend/services/companyProfileService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    content_type,
    topic,
    audience,
    gap_reason,
    content_theme,
  } = req.body ?? {};

  // ── Validate input ────────────────────────────────────────────────────────
  if (!company_id || typeof company_id !== 'string')
    return res.status(400).json({ error: 'company_id required' });

  if (!content_type || !['video_script', 'carousel', 'story'].includes(content_type))
    return res.status(400).json({ error: 'content_type required (video_script|carousel|story)' });

  if (!topic || typeof topic !== 'string' || !topic.trim())
    return res.status(400).json({ error: 'topic required' });

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId: company_id,
    allowedRoles: [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR],
  });
  if (!roleGate) return;

  // ── 2. Enrich context from company profile ────────────────────────────────
  let companyProfile: Record<string, unknown> | undefined;
  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    if (profile) {
      companyProfile = profile as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('[creator/generate] profile enrichment failed:', err);
  }

  // ── 3. Build creator context enrichment ────────────────────────────────────
  const creatorContext: CreatorContextEnrichment = {
    content_theme: content_theme || 'engaging',
    campaign_description: gap_reason || `Content on: ${topic}`,
    target_platforms:
      content_type === 'video_script'
        ? ['tiktok', 'instagram_reels', 'youtube_shorts']
        : content_type === 'carousel'
          ? ['instagram', 'pinterest', 'linkedin']
          : ['instagram', 'tiktok'],
    brand_visual_tone: (companyProfile?.brand_voice as string) || 'professional',
    platform_specs: {
      tiktok: { duration: 15, aspect_ratio: '9:16', hook_duration: 2, max_cuts: 6 },
      instagram_reels: { duration: 30, aspect_ratio: '9:16', hook_duration: 3, max_cuts: 8 },
      youtube_shorts: { duration: 60, aspect_ratio: '9:16', hook_duration: 3, max_cuts: 10 },
      instagram: { duration: 30, aspect_ratio: '1:1' },
      pinterest: { duration: 30, aspect_ratio: '1000:1500' },
      linkedin: { duration: 45, aspect_ratio: '16:9' },
    },
    pacing: 'fast_cuts',
    hooks_per_content: 2,
  };

  // ── 4. Route to appropriate generator ──────────────────────────────────────
  try {
    let result;

    switch (content_type) {
      case 'video_script':
        result = await generateVideoScript(company_id, {
          topic: topic.trim(),
          audience: audience ? String(audience).trim() : undefined,
          creator_context: creatorContext,
        });
        break;

      case 'carousel':
        result = await generateCarousel(company_id, {
          topic: topic.trim(),
          audience: audience ? String(audience).trim() : undefined,
          creator_context: creatorContext,
        });
        break;

      case 'story':
        result = await generateVisualStory(company_id, {
          topic: topic.trim(),
          audience: audience ? String(audience).trim() : undefined,
          creator_context: creatorContext,
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid content_type' });
    }

    return res.status(200).json({
      success: true,
      jobId: result.jobId,
      pollUrl: result.pollUrl,
      estimatedSeconds: result.estimatedSeconds,
      targetPlatforms: result.targetPlatforms,
      repurposeTemplate: result.repurposeTemplate,
    });
  } catch (error) {
    console.error('[creator/generate] Generation failed:', error);
    return res.status(500).json({
      error: 'Failed to generate creator content',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
