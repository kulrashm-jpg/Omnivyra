import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET  /api/whatsapp/templates   â€” list templates for a company
 * POST /api/whatsapp/templates   â€” submit a new template version to Meta
 *
 * Query params (GET): company_id, status (optional), active_only (bool)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  submitTemplate,
  type CreateTemplateInput,
} from '../../../../backend/services/whatsappTemplateService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // â”€â”€ GET: list templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const { company_id, status, active_only } = req.query as Record<string, string>;

    if (!company_id) return res.status(400).json({ error: 'company_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    let query = supabase
      .from('whatsapp_templates')
      .select('*')
      .eq('company_id', company_id)
      .order('template_name', { ascending: true })
      .order('version', { ascending: false });

    if (status) query = query.eq('status', status);
    if (active_only === 'true') query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ templates: data ?? [] });
  }

  // â”€â”€ POST: submit template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const {
      company_id,
      social_account_id,
      template_name,
      template_category,
      language_code,
      components,
    } = req.body || {};

    if (!company_id || !social_account_id || !template_name || !template_category || !components) {
      return res.status(400).json({ error: 'company_id, social_account_id, template_name, template_category, components required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    const roleGate = await enforceRole({ req, res, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
    if (!roleGate) return;

    const input: CreateTemplateInput = {
      company_id,
      social_account_id,
      template_name,
      template_category,
      language_code,
      components,
    };

    try {
      const templateId = await submitTemplate(input);
      return res.status(201).json({ template_id: templateId });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit template' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

