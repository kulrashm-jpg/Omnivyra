import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

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
import { requireCapability } from '../../../backend/security/requireCapability';
import { ORGANIZATION_MANAGE } from '../../../shared/contracts/security';
import { NON_ADMIN_TENANT_ROLES } from '../../../backend/services/rbacPrimitives';

/**
 * PRIVILEGE (2026-11-12): roles a self-joined member may be CONFIRMED into.
 * `role` used to come from the request body unvalidated, so an org admin could
 * make a self-joined user COMPANY_ADMIN here - bypassing the governed
 * promotion path (step-up, single-admin rule, audit). Admin roles go through
 * that path only; any other value is refused.
 */
export const SELF_JOINED_CONFIRMABLE_ROLES: readonly string[] = NON_ADMIN_TENANT_ROLES;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { companyId, userId } = req.query as { companyId?: string; userId?: string };
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  // Wave 2C-B: capability-based gate replaces inline isCompanyAdmin helper.
  // organization.manage is granted to COMPANY_ADMIN + SUPER_ADMIN — same
  // surface the inline helper allowed. No step-up required for these
  // membership-management actions on self-joined users (medium-risk).
  const guard = await requireCapability(req, res, {
    capability: ORGANIZATION_MANAGE,
    organizationId: companyId,
    reason: `manage self-joined member (${req.method})`,
    resourceId: userId,
  });
  if (guard.ok !== true) return;
  const user = guard.principal;

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
    if (!SELF_JOINED_CONFIRMABLE_ROLES.includes(role)) {
      return res.status(400).json({
        error: `role must be one of ${SELF_JOINED_CONFIRMABLE_ROLES.join(', ')}; admin roles are granted through the governed promotion flow`,
        code: 'ROLE_NOT_CONFIRMABLE',
      });
    }

    // PRIVILEGE (2026-11-12, e1 audit): the ONLY app writer of join_source
    // 'self_joined' is onboarding/setup-company - the FOUNDING COMPANY_ADMIN (the
    // column defaults to 'invited'). Without a role filter this route let any
    // ORGANIZATION_MANAGE holder demote or delete the founder (incl. the last
    // admin). It may only ever act on NON-ADMIN rows.
    const { data: confirmed, error } = await supabaseAdmin
      .from('user_company_roles')
      .update({
        join_source: 'invited',
        role,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('join_source', 'self_joined')
      .in('role', [...NON_ADMIN_TENANT_ROLES])
      .select('user_id');

    if (error) return res.status(500).json({ error: 'Failed to confirm the member' });
    // 0 rows: not (or no longer) a self-joined member - never a 200 for nothing.
    if (!Array.isArray(confirmed) || confirmed.length === 0) {
      return res.status(404).json({ error: 'No self-joined membership for this user', code: 'NOT_SELF_JOINED' });
    }

    // Notify the user they've been formally added
    // best-effort: the role change is done; a failed notice is logged, not silent.
    const { error: notifyErr } = await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'role_updated',
      title: 'Your company membership was confirmed',
      message: `A company admin has confirmed your membership and set your role to ${role.replace(/_/g, ' ').toLowerCase()}.`,
      metadata: { company_id: companyId, role, confirmed_by: user.userId },
      is_read: false,
    });
    if (notifyErr) console.error('[team/self-joined] confirmation notification failed:', userId, notifyErr.message);

    return res.status(200).json({ success: true });
  }

  // ── DELETE: remove self-joined membership ────────────────────────────────
  if (req.method === 'DELETE') {
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // PRIVILEGE (2026-11-12, e1 audit): the ONLY app writer of join_source
    // 'self_joined' is onboarding/setup-company - the FOUNDING COMPANY_ADMIN (the
    // column defaults to 'invited'). Without a role filter this route let any
    // ORGANIZATION_MANAGE holder demote or delete the founder (incl. the last
    // admin). It may only ever act on NON-ADMIN rows.
    const { data: removed, error } = await supabaseAdmin
      .from('user_company_roles')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('join_source', 'self_joined')
      .in('role', [...NON_ADMIN_TENANT_ROLES])
      .select('user_id');

    if (error) return res.status(500).json({ error: error.message });
    // 0 rows: not a self-joined NON-ADMIN member (e.g. the founding admin) - never a 200 for nothing.
    if (!Array.isArray(removed) || removed.length === 0) {
      return res.status(404).json({ error: 'No self-joined membership for this user', code: 'NOT_SELF_JOINED' });
    }

    // Notify the removed user
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'membership_removed',
      title: 'Company membership removed',
      message: 'A company admin has removed your automatic membership. Contact them if you believe this is a mistake.',
      metadata: { company_id: companyId, removed_by: user.userId },
      is_read: false,
    });

    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/team/self-joined' });
