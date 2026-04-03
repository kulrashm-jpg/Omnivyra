
/**
 * GET  /api/team/self-joined?companyId=xxx
 *   Returns all users who self-joined the company (join_source = 'self_joined').
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 *
 * DELETE /api/team/self-joined?companyId=xxx&userId=yyy
 *   Removes a self-joined user's membership (they become independent again).
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 *
 * PATCH /api/team/self-joined?companyId=xxx&userId=yyy
 *   Promotes a self-joined user to a formal member (clears self_joined status → invited).
 *   Body: { role?: string }
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function getRequestingUser(req: NextApiRequest) {
  const { user } = await getSupabaseUserFromRequest(req);
  return user ?? null;
}

async function isCompanyAdmin(userId: string, companyId: string): Promise<boolean> {
  // Super admin check
  const { data: superRole } = await supabaseAdmin
    .from('user_company_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .maybeSingle();
  if (superRole) return true;

  const { data: role } = await supabaseAdmin
    .from('user_company_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();
  return role?.role === 'COMPANY_ADMIN';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { companyId, userId } = req.query as { companyId?: string; userId?: string };
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const user = await getRequestingUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const isAdmin = await isCompanyAdmin(user.id, companyId);
  if (!isAdmin) return res.status(403).json({ error: 'Company admin access required' });

  // ── GET: list self-joined users ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, role, status, created_at, join_source')
      .eq('company_id', companyId)
      .eq('join_source', 'self_joined')
      .eq('status', 'active');

    if (error) return res.status(500).json({ error: error.message });

    // Enrich with email from auth.users
    const enriched = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
        return {
          user_id: row.user_id,
          email: authUser?.user?.email ?? null,
          role: row.role,
          status: row.status,
          joined_at: row.created_at,
        };
      })
    );

    return res.status(200).json({ users: enriched });
  }

  // ── PATCH: promote to formal member ──────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const { role = 'CONTENT_CREATOR' } = (req.body ?? {}) as { role?: string };

    const { error } = await supabaseAdmin
      .from('user_company_roles')
      .update({
        join_source: 'invited',
        role,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('join_source', 'self_joined');

    if (error) return res.status(500).json({ error: error.message });

    // Notify the user they've been formally added
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'role_updated',
      title: 'Your company membership was confirmed',
      message: `A company admin has confirmed your membership and set your role to ${role.replace(/_/g, ' ').toLowerCase()}.`,
      metadata: { company_id: companyId, role, confirmed_by: user.id },
      is_read: false,
    });

    return res.status(200).json({ success: true });
  }

  // ── DELETE: remove self-joined membership ────────────────────────────────
  if (req.method === 'DELETE') {
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { error } = await supabaseAdmin
      .from('user_company_roles')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('join_source', 'self_joined');

    if (error) return res.status(500).json({ error: error.message });

    // Notify the removed user
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'membership_removed',
      title: 'Company membership removed',
      message: 'A company admin has removed your automatic membership. Contact them if you believe this is a mistake.',
      metadata: { company_id: companyId, removed_by: user.id },
      is_read: false,
    });

    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
