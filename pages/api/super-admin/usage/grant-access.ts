import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'config:rbac');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/usage/grant-access', 'config:rbac');
  }
  const grantedBy = ctx.id;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const organizationId = body.organization_id ?? body.organizationId;
  const userId = body.user_id ?? body.userId;

  if (!organizationId || !userId) {
    return res.status(400).json({ error: 'organization_id and user_id are required' });
  }

  try {
    const { error } = await supabase.from('usage_report_access').insert({
      organization_id: organizationId,
      user_id: userId,
      granted_by: grantedBy,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '23505') {
        return res.status(200).json({ success: true, message: 'Access already granted' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true, message: 'Access granted' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
