/**
 * POST /api/campaigns/validate-frequency
 * Validates campaign frequency during configuration (early validation).
 * Returns frequency summary and validation result.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { resolveOrganizationPlanLimits } from '../../../backend/services/planResolutionService';
import {
  calculateCampaignFrequency,
  validateCampaignFrequency,
} from '../../../lib/planning/campaignFrequencyEngine';
import { validateCapacityForContentMix } from '../../../backend/services/capacityExpectationValidator';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.body?.companyId ?? req.body?.company_id) as string | undefined;
  const access = await enforceCompanyAccess({ req, res, companyId: companyId ?? null });
  if (!access) return;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const body = req.body ?? {};
  const duration_weeks = Math.max(1, Number(body.duration_weeks) || 12);
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p: unknown) => typeof p === 'string').map((p: string) => p.trim())
    : ['linkedin'];
  const cross_platform_sharing_enabled = body.cross_platform_sharing_enabled !== false;
  const content_mix =
    body.content_mix && typeof body.content_mix === 'object'
      ? body.content_mix
      : {};

  let max_campaign_duration_weeks: number | null = null;
  try {
    const resolved = await resolveOrganizationPlanLimits(companyId);
    max_campaign_duration_weeks = resolved.max_campaign_duration_weeks ?? null;
  } catch {
    // ignore; validation will skip duration limit
  }

  const available_content = body.available_content ?? null;
  const weekly_capacity = body.weekly_capacity ?? null;

  const frequency_summary = calculateCampaignFrequency({
    duration_weeks,
    cross_platform_sharing_enabled,
    platforms,
    content_mix,
  });

  let validation = validateCampaignFrequency({
    duration_weeks,
    cross_platform_sharing_enabled,
    platforms,
    content_mix,
    max_campaign_duration_weeks,
    available_content,
    weekly_capacity,
  });

  if (available_content || weekly_capacity) {
    const capResult = validateCapacityForContentMix({
      platforms,
      content_mix,
      duration_weeks,
      cross_platform_sharing_enabled,
      available_content: available_content ?? undefined,
      weekly_capacity: weekly_capacity ?? undefined,
      exclusive_campaigns: 0,
    });
    if (capResult && capResult.status === 'invalid') {
      validation = {
        ...validation,
        valid: false,
        errors: [
          ...validation.errors,
          { code: 'capacity', message: capResult.explanation || "Content demand exceeds your team's capacity." },
        ],
      };
    }
  }

  return res.status(200).json({
    frequency_summary: {
      weekly_unique_content_required: frequency_summary.weekly_unique_content_required,
      total_content_required: frequency_summary.total_content_required,
      weekly_total_posts: frequency_summary.weekly_total_posts,
      weekly_total_videos: frequency_summary.weekly_total_videos,
      weekly_total_blogs: frequency_summary.weekly_total_blogs,
    },
    validation: {
      valid: validation.valid,
      warnings: validation.warnings,
      errors: validation.errors,
    },
  });
}
