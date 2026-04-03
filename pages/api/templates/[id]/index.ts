
/**
 * Template Management API
 * GET /api/templates/[id] - Get template
 * PUT /api/templates/[id] - Update template
 * DELETE /api/templates/[id] - Delete template
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getTemplate, updateTemplate, deleteTemplate } from '../../../../backend/services/templateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Template ID is required' });
  }

  if (req.method === 'GET') {
    try {
      const template = await getTemplate(id);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.status(200).json({
        success: true,
        data: template,
      });
    } catch (error: any) {
      console.error('Template fetch error:', error);
      res.status(500).json({
        error: 'Failed to fetch template',
        message: error.message,
      });
    }
  } else if (req.method === 'PUT') {
    try {
      const updates = req.body;
      const template = await updateTemplate(id, updates);

      res.status(200).json({
        success: true,
        data: template,
      });
    } catch (error: any) {
      console.error('Template update error:', error);
      res.status(500).json({
        error: 'Failed to update template',
        message: error.message,
      });
    }
  } else if (req.method === 'DELETE') {
    try {
      await deleteTemplate(id);

      res.status(200).json({
        success: true,
        message: 'Template deleted successfully',
      });
    } catch (error: any) {
      console.error('Template delete error:', error);
      res.status(500).json({
        error: 'Failed to delete template',
        message: error.message,
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
