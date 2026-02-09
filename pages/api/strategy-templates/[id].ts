import { NextApiRequest, NextApiResponse } from 'next';
import {
  deleteStrategyTemplate,
  getStrategyTemplate,
  updateStrategyTemplate,
} from '../../../backend/services/strategyTemplateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Template ID is required' });
  }

  if (req.method === 'GET') {
    const template = await getStrategyTemplate(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.status(200).json({ success: true, data: template });
  }

  if (req.method === 'PUT') {
    try {
      const updated = await updateStrategyTemplate(id, req.body || {});
      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to update strategy template',
        message: error.message,
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteStrategyTemplate(id);
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to delete strategy template',
        message: error.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
