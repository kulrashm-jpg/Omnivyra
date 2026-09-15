import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Templates API
 * GET /api/templates - List templates
 * POST /api/templates - Create template
 *
 * ROUTE-AUTH-001 (STEP 3AH-85) — content templates are owned by `user_id`
 * (templateService). The owner is ALWAYS the authenticated caller: a
 * client-supplied `user_id` is ignored (it used to select whose private
 * templates were listed, and whose name a new template was created under).
 * An optional `campaign_id` (filter on GET, stored on POST) is bound to the
 * caller's tenant with requireCampaignAccess before it is used.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { listTemplates, createTemplate } from '../../../backend/services/templateService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (req.method === 'GET') {
    try {
      const { platform, campaign_id, is_public, tags } = req.query;
      const campaignId = typeof campaign_id === 'string' && campaign_id.trim() ? campaign_id.trim() : undefined;
      if (campaignId) {
        const access = await requireCampaignAccess(req, res, campaignId);
        if (!access) return;
      }

      const templates = await listTemplates(user.id, {
        platform: platform as string,
        campaign_id: campaignId,
        is_public: is_public === 'true',
        tags: tags ? (tags as string).split(',') : undefined,
      });

      res.status(200).json({
        success: true,
        data: templates,
      });
    } catch (error: any) {
      console.error('Templates API error:', error);
      res.status(500).json({
        error: 'Failed to list templates',
        message: error.message,
      });
    }
    return;
  }

  try {
    // `user_id` is stripped: the owner is the authenticated caller.
    const { user_id: _ignoredUserId, ...templateData } = req.body || {};

    if (!templateData.name || !templateData.content || !templateData.platform || !templateData.content_type) {
      return res.status(400).json({ error: 'Missing required template fields' });
    }

    if (templateData.campaign_id) {
      const access = await requireCampaignAccess(req, res, String(templateData.campaign_id));
      if (!access) return;
    }

    const template = await createTemplate(user.id, templateData);

    res.status(201).json({
      success: true,
      data: template,
    });
  } catch (error: any) {
    console.error('Template creation error:', error);
    res.status(500).json({
      error: 'Failed to create template',
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/templates' });
