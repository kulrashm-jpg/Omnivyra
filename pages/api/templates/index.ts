/**
 * Templates API
 * GET /api/templates - List templates
 * POST /api/templates - Create template
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { listTemplates, createTemplate } from '../../../backend/services/templateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { user_id, platform, campaign_id, is_public, tags } = req.query;

      if (!user_id || typeof user_id !== 'string') {
        return res.status(400).json({ error: 'user_id is required' });
      }

      const templates = await listTemplates(user_id, {
        platform: platform as string,
        campaign_id: campaign_id as string,
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
  } else if (req.method === 'POST') {
    try {
      const { user_id, ...templateData } = req.body;

      if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
      }

      if (!templateData.name || !templateData.content || !templateData.platform || !templateData.content_type) {
        return res.status(400).json({ error: 'Missing required template fields' });
      }

      const template = await createTemplate(user_id, templateData);

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
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

