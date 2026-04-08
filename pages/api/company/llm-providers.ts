/**
 * GET /api/company/llm-providers?companyId=...
 *
 * Public (authenticated) read-only endpoint for company members.
 * Returns all active LLM providers and models configured by Super Admin,
 * plus the company's current selection if any.
 *
 * Used by settings UI dropdowns — any authenticated company member can read this.
 * Writing is restricted to COMPANY_ADMIN via /api/company/llm-config.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  Role,
} from '../../../backend/services/rbacService';
import {
  getActiveProviders,
  getAllActiveModels,
  getCompanyLlmConfig,
} from '../../../backend/services/llmProviderService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  // Auth: any authenticated company member can read
  const legacy = getLegacySuperAdminSession(req);
  if (!legacy) {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error || !user) return res.status(401).json({ error: 'UNAUTHORIZED' });

    // Must have at least some role in this company
    let { role } = await getUserRole(user.id, companyId);
    if (!role) {
      const fallback = await getCompanyRoleIncludingInvited(user.id, companyId);
      role = fallback ?? null;
    }
    if (!role) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const [providers, models, companyConfig] = await Promise.all([
      getActiveProviders(),
      getAllActiveModels(),
      getCompanyLlmConfig(companyId),
    ]);

    // Group models under their provider for easy UI rendering
    const providersWithModels = providers.map((provider) => ({
      ...provider,
      models: models.filter((m) => m.provider_id === provider.id),
    }));

    return res.status(200).json({
      providers: providersWithModels,
      company_config: companyConfig
        ? {
            provider_id:           companyConfig.provider_id,
            provider_name:         companyConfig.provider_name,
            provider_display_name: companyConfig.provider_display_name,
            model_id:              companyConfig.model_id,
            model_key:             companyConfig.model_key,
            model_display_name:    companyConfig.model_display_name,
            model_metadata:        companyConfig.model_metadata,
            has_custom_api_key:    companyConfig.has_custom_api_key,
            is_active:             companyConfig.is_active,
          }
        : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
