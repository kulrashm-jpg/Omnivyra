/**
 * Template Render API
 * POST /api/templates/[id]/render
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getTemplate, renderTemplate, incrementTemplateUsage } from '../../../../backend/services/templateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { variables } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const template = await getTemplate(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const rendered = renderTemplate(template, variables || {});

    // Increment usage count
    await incrementTemplateUsage(id);

    res.status(200).json({
      success: true,
      data: rendered,
    });
  } catch (error: any) {
    console.error('Template render error:', error);
    res.status(500).json({
      error: 'Failed to render template',
      message: error.message,
    });
  }
}

