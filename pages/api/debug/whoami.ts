/**
 * GET /api/debug/whoami
 *
 * Returns the user the server resolves from the request's auth context,
 * plus their company memberships. Read-only. Dev-side diagnostic for the
 * "Access denied to company" mystery — lets the user see whether the
 * tab they're using authenticates as the account they think it does.
 *
 * No new code paths; uses the exact same resolveUserContext + DB query
 * the BOLT endpoints use. If `userId` here doesn't match the admin you
 * expect to be signed in as, the 403 from /api/bolt/execute is correct
 * and the fix is on the browser side (re-sign-in, clear session, etc.).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await resolveUserContext(req);
  const { data: memberships } = await supabase
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', ctx.userId);

  return res.status(200).json({
    resolved_user_id: ctx.userId,
    role: ctx.role,
    company_ids_known: ctx.companyIds,
    default_company_id: ctx.defaultCompanyId,
    membership_type: ctx.membershipType,
    user_company_roles_for_this_user: memberships ?? [],
    request_cookies_present: !!req.headers.cookie,
    request_authorization_header_present: !!req.headers.authorization,
  });
}
