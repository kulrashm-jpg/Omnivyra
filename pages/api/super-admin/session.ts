
/**
 * GET /api/super-admin/session
 *
 * Returns whether the authenticated caller is a confirmed platform super-admin.
 * Replaces the legacy cookie check (super_admin_session=1).
 *
 * Auth: Bearer <supabase_access_token>
 * Response: { isSuperAdmin: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAdminScope(req, res, 'users:list-external');
  return ctx ? res.status(200).json({ isSuperAdmin: true }) : undefined;
}
