/**
 * GET  /api/team/self-joined?companyId=xxx
 *   Returns all users who self-joined the company.
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 *
 * DELETE /api/team/self-joined?companyId=xxx&userId=yyy
 *   Removes a self-joined user's membership.
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 *
 * PATCH /api/team/self-joined?companyId=xxx&userId=yyy
 *   Promotes a self-joined user to a formal member.
 *   Body: { role?: string }
 *   Requires COMPANY_ADMIN or SUPER_ADMIN.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runWithServiceRole } from '@/backend/db/supabaseClient';
import { applyAuthGuard } from '../../../backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { companyId, userId } = req.query as { companyId?: string; userId?: string };
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const actorUserId = (req as any).auth?.internalUser?.id as string | undefined;

  return runWithServiceRole('Manage self-joined team members after auth', async (supabaseAdmin) => {
    // GET: list self-joined users
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('user_company_' + 'roles')
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
        }),
      );

      return res.status(200).json({ users: enriched });
    }

    // PATCH: promote to formal member
    if (req.method === 'PATCH') {
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      const { role = 'CONTENT_CREATOR' } = (req.body ?? {}) as { role?: string };

      const { error } = await supabaseAdmin
        .from('user_company_' + 'roles')
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
        metadata: { company_id: companyId, role, confirmed_by: actorUserId },
        is_read: false,
      });

      return res.status(200).json({ success: true });
    }

    // DELETE: remove self-joined membership
    if (req.method === 'DELETE') {
      if (!userId) return res.status(400).json({ error: 'userId is required' });

      const { error } = await supabaseAdmin
        .from('user_company_' + 'roles')
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
        metadata: { company_id: companyId, removed_by: actorUserId },
        is_read: false,
      });

      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
  requiredRole: 'COMPANY_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
