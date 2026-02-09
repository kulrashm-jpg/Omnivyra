import { NextApiRequest, NextApiResponse } from 'next';
import {
  createStrategyTemplate,
  listStrategyTemplates,
} from '../../../backend/services/strategyTemplateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { user_id, company_id, is_public } = req.query;
      if (!user_id || typeof user_id !== 'string') {
        return res.status(400).json({ error: 'user_id is required' });
      }
      const templates = await listStrategyTemplates(user_id, {
        company_id: company_id as string,
        is_public: is_public === 'true',
      });
      return res.status(200).json({ success: true, data: templates });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to list strategy templates',
        message: error.message,
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { user_id, ...templateData } = req.body || {};
      if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
      }
      if (!templateData.name || !templateData.objective || !templateData.target_audience) {
        return res.status(400).json({ error: 'Missing required template fields' });
      }
      if (!templateData.key_platforms || templateData.key_platforms.length === 0) {
        return res.status(400).json({ error: 'key_platforms is required' });
      }
      const template = await createStrategyTemplate(user_id, templateData);
      return res.status(201).json({ success: true, data: template });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to create strategy template',
        message: error.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
