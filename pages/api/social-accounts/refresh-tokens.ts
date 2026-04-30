/**
 * POST /api/social-accounts/refresh-tokens
 *
 * Refreshes OAuth tokens for the caller's organization. Tokens live in
 * social_accounts (single source of truth post-consolidation), so this
 * endpoint just calls refreshExpiringSocialAccountsForCompany.
 *
 * Fire-and-forget from the client; the response body is a small summary.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole } from '@/backend/services/rbacService';
import { refreshExpiringSocialAccountsForCompany } from '@/backend/auth/tokenRefresh';

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
    const social = await refreshExpiringSocialAccountsForCompany(companyId);
    return res.status(200).json({ success: true, social_accounts: social });
  } catch (e: any) {
    console.error('[refresh-tokens] failed:', e?.message);
    return res.status(500).json({ error: e?.message || 'Refresh failed' });
  }
}
