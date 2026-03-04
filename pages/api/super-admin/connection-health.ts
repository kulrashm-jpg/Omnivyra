import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getConnectionStatus } from '../../../backend/services/connectionHealthStatus';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
    return true;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdminAccess(req, res))) return;

  try {
    const { data: rows, error } = await supabase
      .from('social_accounts')
      .select('user_id, platform, account_name, token_expires_at, access_token')
      .eq('is_active', true);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const list = rows ?? [];
    const userIds = [...new Set(list.map((r: { user_id: string }) => r.user_id))];

    let companyByUser: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: roles } = await supabase
        .from('user_company_roles')
        .select('user_id, company_id')
        .in('user_id', userIds);
      const rolesList = roles ?? [];
      rolesList.forEach((r: { user_id: string; company_id: string }) => {
        if (companyByUser[r.user_id] == null) companyByUser[r.user_id] = r.company_id;
      });
    }

    let expired_count = 0;
    let expiring_soon_count = 0;
    let active_count = 0;
    let no_token_count = 0;

    const accounts = list.map((row: { user_id: string; platform: string; account_name: string; token_expires_at?: string | null; access_token?: string | null }) => {
      const hasAccessToken = row.access_token != null && String(row.access_token).trim() !== '';
      const connection_status = getConnectionStatus(row.token_expires_at ?? null, hasAccessToken);
      if (connection_status === 'expired') expired_count += 1;
      else if (connection_status === 'expiring_soon') expiring_soon_count += 1;
      else if (connection_status === 'active') active_count += 1;
      else no_token_count += 1;

      return {
        company_id: companyByUser[row.user_id] ?? null,
        user_id: row.user_id,
        platform: row.platform,
        account_name: row.account_name ?? null,
        token_expires_at: row.token_expires_at ?? null,
        connection_status,
      };
    });

    return res.status(200).json({
      success: true,
      total_accounts: accounts.length,
      expired_count,
      expiring_soon_count,
      active_count,
      no_token_count,
      accounts,
    });
  } catch (err: any) {
    console.error('[super-admin/connection-health]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
