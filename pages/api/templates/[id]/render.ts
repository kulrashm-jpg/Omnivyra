import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Template Render API
 * POST /api/templates/[id]/render
 *
 * ROUTE-AUTH-001 (STEP 3AH-85) — authenticated; the template must be visible
 * to the caller (their own, or public) — the same rule as GET /api/templates/[id].
 * A template the caller cannot see answers 404 and its usage count is untouched.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getTemplate, renderTemplate, incrementTemplateUsage } from '../../../../backend/services/templateService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const { id } = req.query;
    const { variables } = req.body || {};

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const template = await getTemplate(id);
    if (!template || (template.user_id !== user.id && template.is_public !== true)) {
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/templates/:id/render' });
