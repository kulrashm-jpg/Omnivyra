import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

const RESOURCE_KEYS = ['llm_tokens', 'external_api_calls', 'automation_executions'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'plans:override');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/plans/override', 'plans:override');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const organizationId = body.organization_id ?? body.organizationId;
  const resourceKey = body.resource_key ?? body.resourceKey;
  const monthlyLimit = body.monthly_limit ?? body.monthlyLimit;

  if (!organizationId || !resourceKey) {
    return res.status(400).json({ error: 'organization_id and resource_key are required' });
  }
  if (!RESOURCE_KEYS.includes(resourceKey)) {
    return res.status(400).json({
      error: 'resource_key must be one of: llm_tokens, external_api_calls, automation_executions',
    });
  }

  try {
    const limitValue = monthlyLimit != null ? Number(monthlyLimit) : null;

    const { error: upsertErr } = await supabase.from('organization_plan_overrides').upsert(
      {
        organization_id: organizationId,
        resource_key: resourceKey,
        monthly_limit: limitValue,
      },
      { onConflict: 'organization_id,resource_key' }
    );

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });
    return res.status(200).json({
      success: true,
      organization_id: organizationId,
      resource_key: resourceKey,
      monthly_limit: limitValue,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
