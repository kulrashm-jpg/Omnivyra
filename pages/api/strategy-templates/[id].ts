import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  deleteStrategyTemplate,
  getStrategyTemplate,
  updateStrategyTemplate,
} from '../../../backend/services/strategyTemplateService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — a strategy template is owned by its `user_id`.
 * The row is loaded server-side and authorized against the authenticated
 * caller BEFORE any read, update or delete:
 *   - GET: the owner, or anyone signed in when the template is public
 *     (the same visibility listStrategyTemplates applies);
 *   - PUT / DELETE: the owner only.
 * A template the caller cannot see answers 404 (same as a missing one).
 */
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

  const template = await getStrategyTemplate(id);
  const isOwner = Boolean(template) && template!.user_id === user.id;
  const isVisible = isOwner || template?.is_public === true;
  if (!template || !isVisible) {
    return res.status(404).json({ error: 'Template not found' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: template });
  }

  if (!isOwner) {
    return res.status(403).json({ error: 'Only the template owner can modify it' });
  }

  if (req.method === 'PUT') {
    try {
      // Ownership / tenant columns are never client-writable.
      const { id: _id, user_id: _userId, company_id: _companyId, created_at: _createdAt, ...updates } = req.body || {};
      const updated = await updateStrategyTemplate(id, updates);
      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to update strategy template',
        message: error.message,
      });
    }
  }

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/strategy-templates/:id' });
