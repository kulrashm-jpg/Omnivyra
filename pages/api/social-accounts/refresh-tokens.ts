/**
 * POST /api/social-accounts/refresh-tokens
 *
 * Refreshes OAuth tokens for the caller's organization (community_ai_platform_tokens)
 * whose expiry is within the cron buffer. Fired on company-admin login / dashboard
 * mount so downstream API calls don't hit an expired token.
 *
 * Fire-and-forget from the client; the response body is a small summary.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole } from '@/backend/services/rbacService';
import { runConnectorTokenRefresh } from '@/backend/services/connectorTokenRefreshService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) return res.status(401).json({ error: 'Unauthorized' });

  const companyId = (req.body?.companyId as string) || (req.query.companyId as string) || '';
  if (!companyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const { role } = await getUserRole(user.id, companyId).catch(() => ({ role: null, error: '' }));
  if (!role) return res.status(403).json({ error: 'No access to this company' });

  try {
    const result = await runConnectorTokenRefresh(companyId);
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    console.error('[refresh-tokens] failed:', e?.message);
    return res.status(500).json({ error: e?.message || 'Refresh failed' });
  }
}
