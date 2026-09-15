import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  createStrategyTemplate,
  listStrategyTemplates,
} from '../../../backend/services/strategyTemplateService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — strategy templates are owned by `user_id`
 * (strategyTemplateService). The owner is ALWAYS the authenticated caller: a
 * client-supplied `user_id` is ignored (it used to select whose private
 * templates were listed, and whose name a new template was created under).
 * An optional `company_id` is bound to the caller's membership before it is
 * used as a filter or stored on a new row.
 */
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
      const { company_id, is_public } = req.query;
      const companyId = typeof company_id === 'string' && company_id.trim() ? company_id.trim() : undefined;
      if (companyId) {
        const access = await enforceCompanyAccess({ req, res, companyId });
        if (!access) return;
      }
      const templates = await listStrategyTemplates(user.id, {
        company_id: companyId,
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

  try {
    // `user_id` is stripped: the owner is the authenticated caller.
    const { user_id: _ignoredUserId, ...templateData } = req.body || {};
    if (!templateData.name || !templateData.objective || !templateData.target_audience) {
      return res.status(400).json({ error: 'Missing required template fields' });
    }
    if (!templateData.key_platforms || templateData.key_platforms.length === 0) {
      return res.status(400).json({ error: 'key_platforms is required' });
    }
    if (templateData.company_id) {
      const access = await enforceCompanyAccess({ req, res, companyId: String(templateData.company_id) });
      if (!access) return;
    }
    const template = await createStrategyTemplate(user.id, templateData);
    return res.status(201).json({ success: true, data: template });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to create strategy template',
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/strategy-templates' });
