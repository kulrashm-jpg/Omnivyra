import type { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { connectGoogleAnalytics } from '../../../backend/services/analyticsIntegrationService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function requireSuperAdminAccess(req: NextApiRequest, res: NextApiResponse): Promise<{ userId: string | null }> {
  if (req.cookies?.super_admin_session === '1') {
    return { userId: null };
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(403).json({ error: 'Super admin access required' });
    return { userId: null };
  }

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!roleRow) {
    res.status(403).json({ error: 'Super admin access required' });
    return { userId: null };
  }

  return { userId: user.id };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireSuperAdminAccess(req, res);
  if (res.writableEnded) return;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({ error: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND' });
  }

  try {
    const { authorizationUrl } = await connectGoogleAnalytics(company.id, {
      userId: access.userId ?? undefined,
      returnTo: '/super-admin/dashboard',
      requestBaseUrl: getBaseUrl(req),
    });

    return res.status(200).json({ status: 'ok', authorizationUrl });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to connect Google Analytics' });
  }
}
