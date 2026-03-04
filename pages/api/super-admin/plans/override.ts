import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

const RESOURCE_KEYS = ['llm_tokens', 'external_api_calls', 'automation_executions'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdmin(req, res))) return;

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
