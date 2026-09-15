import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Template Management API
 * GET /api/templates/[id] - Get template
 * PUT /api/templates/[id] - Update template
 * DELETE /api/templates/[id] - Delete template
 *
 * ROUTE-AUTH-001 (STEP 3AH-85) — a content template is owned by its `user_id`.
 * The row is loaded server-side and authorized against the authenticated
 * caller BEFORE any read, update or delete:
 *   - GET: the owner, or anyone signed in when the template is public
 *     (the same visibility listTemplates applies);
 *   - PUT / DELETE: the owner only.
 * A template the caller cannot see answers 404 (same as a missing one).
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getTemplate, updateTemplate, deleteTemplate } from '../../../../backend/services/templateService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Template ID is required' });
  }

  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const template = await getTemplate(id);
    const isOwner = Boolean(template) && template!.user_id === user.id;
    const isVisible = isOwner || template?.is_public === true;
    if (!template || !isVisible) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        data: template,
      });
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Only the template owner can modify it' });
    }

    if (req.method === 'PUT') {
      // Ownership / tenant columns are never client-writable (the editor
      // sends the whole template back, including user_id and campaign_id).
      const { id: _id, user_id: _userId, campaign_id: _campaignId, created_at: _createdAt, ...updates } = req.body || {};
      const updated = await updateTemplate(id, updates);

      return res.status(200).json({
        success: true,
        data: updated,
      });
    }

    await deleteTemplate(id);

    return res.status(200).json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error: any) {
    const verb = req.method === 'PUT' ? 'update' : req.method === 'DELETE' ? 'delete' : 'fetch';
    console.error(`Template ${verb} error:`, error);
    res.status(500).json({
      error: `Failed to ${verb} template`,
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/templates/:id' });
