
/**
 * POST /api/auth/set-password
 *
 * Protected endpoint. Updates has_password flag in public.users.
 * After password is set, checks for a pending invitation for the user's email.
 * If found: creates user_company_roles, sets active_company_id, marks invitation accepted.
 *
 * Body: (none — user derived from Bearer token)
 * Auth: Bearer <supabase_access_token>
 * Returns: { success: true, route: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

type SuccessResponse = { success: true; route: string };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Bearer token & resolve user ─────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) {
    const status = userErr === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: userErr ?? 'Invalid session', code: userErr ?? undefined });
  }

  // ── 2. Update has_password flag in public.users ───────────────────────────
  const { error: updateErr } = await supabase
    .from('users')
    .update({ has_password: true })
    .eq('id', user.id);

  if (updateErr) {
    console.error('[auth/set-password] update error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to update password status' });
  }

  // ── 3. Check for pending invitation for this email ────────────────────────
  let route = '/onboarding/profile';

  if (user.email) {
    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, company_id, role')
      .eq('email', user.email.toLowerCase())
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invitation) {
      const now = new Date().toISOString();
      const companyId = (invitation as any).company_id;
      const role      = (invitation as any).role || 'CONTENT_CREATOR';

      // ── 3a. Create user_company_roles entry ─────────────────────────────
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .maybeSingle();

      if (!existingRole) {
        await supabase.from('user_company_roles').insert({
          user_id:     user.id,
          company_id:  companyId,
          role,
          status:      'active',
          join_source: 'invited',
          accepted_at: now,
          created_at:  now,
          updated_at:  now,
        });
      } else {
        // Activate if already exists (e.g. status=invited)
        await supabase
          .from('user_company_roles')
          .update({ status: 'active', role, accepted_at: now, updated_at: now })
          .eq('id', (existingRole as any).id);
      }

      // ── 3b. Set active_company_id on user ─────────────────────────────
      await supabase
        .from('users')
        .update({ active_company_id: companyId })
        .eq('id', user.id);

      // ── 3c. Mark invitation as accepted ───────────────────────────────
      await supabase
        .from('invitations')
        .update({ accepted_at: now })
        .eq('id', (invitation as any).id);

      // User has company — check if profile is complete
      const { data: userRow } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      route = (userRow as any)?.name ? '/dashboard' : '/onboarding/profile';
    } else {
      // No pending invitation — but user may already have a role (super-admin assigned,
      // or invitation was previously accepted). Restore their actual state.
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (existingRole) {
        const { data: userRow } = await supabase
          .from('users')
          .select('name')
          .eq('id', user.id)
          .single();
        route = (userRow as any)?.name ? '/dashboard' : '/onboarding/profile';
      }
    }
  }

  return res.status(200).json({ success: true, route });
}
