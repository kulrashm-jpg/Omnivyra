import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

const PLACEHOLDER_GRANTED_BY = '00000000-0000-0000-0000-000000000000';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<string | null> => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    return PLACEHOLDER_GRANTED_BY;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    }
    return user.id;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const grantedBy = await requireSuperAdminAccess(req, res);
  if (grantedBy === null) return;

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
