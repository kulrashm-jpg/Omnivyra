import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/company/llm-config?companyId=...
 *   Returns the company's current LLM config + all available active providers/models.
 *   If no config saved, returns null for config (means platform default is used).
 *
 * PUT /api/company/llm-config
 *   Body: { companyId, provider_id, model_id, api_key? }
 *   Saves the company's LLM selection. api_key is optional (BYOK).
 *   Pass api_key: "" to remove a stored key.
 *
 * Auth: COMPANY_ADMIN or SUPER_ADMIN (MANAGE_EXTERNAL_APIS permission)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';
import {
  getCompanyLlmConfig,
  setCompanyLlmConfig,
  getAllActiveModels,
  getActiveProviders,
} from '../../../backend/services/llmProviderService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function requireCompanyLlmAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string,
): Promise<{ userId: string; role: string } | null> {
  // Legacy super admin cookie

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };
  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };

  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallback = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (fallback === Role.COMPANY_ADMIN || fallback === Role.ADMIN || fallback === Role.SUPER_ADMIN) {
      role = fallback;
      roleError = null;
    }
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const companyId = (req.query.companyId as string)?.trim();
    if (!companyId) return res.status(400).json({ error: 'companyId is required' });

    const companyAccess = await enforceCompanyAccess({ req, res, companyId });
    if (!companyAccess) return;

    const access = await requireCompanyLlmAccess(req, res, companyId);
    if (!access) return;

    try {
      const [config, providers, models] = await Promise.all([
        getCompanyLlmConfig(companyId),
        getActiveProviders(),
        getAllActiveModels(),
      ]);

      // Group models by provider for convenient UI rendering
      const modelsByProvider: Record<string, typeof models> = {};
      for (const model of models) {
        if (!modelsByProvider[model.provider_name]) modelsByProvider[model.provider_name] = [];
        modelsByProvider[model.provider_name].push(model);
      }

      return res.status(200).json({
        config,            // null = using platform default
        providers,
        models,
        modelsByProvider,
        platform_default: {
          note: 'When no config is set, the platform uses its own OpenAI key with gpt-4o-mini.',
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  // â”€â”€ PUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'PUT') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { companyId, provider_id, model_id, api_key, is_active } = body;

    if (!companyId) return res.status(400).json({ error: 'companyId is required' });
    if (!provider_id) return res.status(400).json({ error: 'provider_id is required' });
    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const companyAccess = await enforceCompanyAccess({ req, res, companyId });
    if (!companyAccess) return;

    const access = await requireCompanyLlmAccess(req, res, companyId);
    if (!access) return;

    try {
      // Validate that provider and model are active and model belongs to provider
      const { data: model, error: modelErr } = await supabase
        .from('llm_models')
        .select('id, provider_id, is_active')
        .eq('id', model_id)
        .eq('provider_id', provider_id)
        .eq('is_active', true)
        .maybeSingle();

      if (modelErr) return res.status(500).json({ error: modelErr.message });
      if (!model) {
        return res.status(400).json({
          error: 'Invalid model: not found, inactive, or does not belong to the specified provider',
        });
      }

      const { data: provider, error: provErr } = await supabase
        .from('llm_providers')
        .select('id, is_active')
        .eq('id', provider_id)
        .eq('is_active', true)
        .maybeSingle();

      if (provErr) return res.status(500).json({ error: provErr.message });
      if (!provider) {
        return res.status(400).json({ error: 'Provider not found or inactive' });
      }

      const config = await setCompanyLlmConfig({
        company_id:  companyId,
        provider_id,
        model_id,
        api_key:     api_key !== undefined ? api_key : undefined, // preserve if not sent
        is_active:   typeof is_active === 'boolean' ? is_active : true,
        updated_by:  access.userId,
      });

      return res.status(200).json({ success: true, config });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

