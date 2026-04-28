import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { getPostLoginRoute as getUserPreferenceRoute } from '../../../backend/services/userPreferencesService';

type SuccessResponse = { success: true; route: string };
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  seedRequestContextFromRequest(req);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const password = typeof body.password === 'string' ? body.password : '';
  const flow = body.flow === 'recovery' ? 'recovery' : 'signup';
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) {
    const status = userErr === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: userErr ?? 'Invalid session', code: userErr ?? undefined });
  }
  seedRequestContextFromRequest(req, { userId: user.id });

  const rawToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  const { data: authUserData, error: authUserError } = await supabase.auth.getUser(rawToken);
  if (authUserError || !authUserData.user) {
    return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
  }

  const { data: currentUser } = await supabase
    .from('users')
    .select('has_password')
    .eq('id', user.id)
    .maybeSingle();

  if (flow === 'recovery' && !(currentUser as any)?.has_password) {
    return res.status(400).json({ error: 'Recovery flow is invalid for this account.', code: 'INVALID_RECOVERY_FLOW' });
  }

  if (flow === 'signup' && (currentUser as any)?.has_password) {
    return res.status(400).json({ error: 'Signup password flow is invalid for this account.', code: 'INVALID_SIGNUP_FLOW' });
  }

  const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(authUserData.user.id, {
    password,
  });
  if (passwordUpdateError) {
    logger.error('auth_set_password_auth_update_failed', { userId: user.id, message: passwordUpdateError.message });
    return res.status(500).json({ error: 'Failed to update password' });
  }

  let route = '/onboarding/profile';

  if (user.email) {
    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, company_id, expires_at, token_consumed_at')
      .eq('email', user.email.toLowerCase())
      .is('accepted_at', null)
      .is('revoked_at', null)
      .not('token_consumed_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invitation) {
      const now = new Date().toISOString();
      if (new Date((invitation as any).expires_at) <= new Date()) {
        await supabase.from('invitations').update({ revoked_at: now }).eq('id', (invitation as any).id);
        return res.status(400).json({ error: 'Invitation has expired', code: 'EXPIRED_INVITATION' });
      }

      const { data: activationRows, error: activationError } = await supabase.rpc('activate_invitation_membership', {
        p_invitation_id: (invitation as any).id,
        p_user_id: user.id,
        p_now: now,
      });

      if (activationError) {
        logger.error('auth_set_password_invitation_activation_failed', {
          userId: user.id,
          invitationId: (invitation as any).id,
          message: activationError.message,
        });
        return res.status(500).json({ error: 'Failed to activate invitation membership' });
      }

      const activation = Array.isArray(activationRows) ? activationRows[0] : (activationRows as any);
      seedRequestContextFromRequest(req, { userId: user.id, orgId: activation?.company_id ?? (invitation as any).company_id });

      const { data: userRow } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      route = (userRow as any)?.name ? await getUserPreferenceRoute(user.id) : '/onboarding/profile';
    } else {
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (existingRole) {
        seedRequestContextFromRequest(req, { userId: user.id, orgId: (existingRole as any).company_id });
        const { data: userRow } = await supabase
          .from('users')
          .select('name')
          .eq('id', user.id)
          .single();
        route = (userRow as any)?.name ? await getUserPreferenceRoute(user.id) : '/onboarding/profile';
      }
    }
  }

  const { error: updateErr } = await supabase
    .from('users')
    .update({ has_password: true })
    .eq('id', user.id);

  if (updateErr) {
    logger.error('auth_set_password_user_update_failed', { userId: user.id, message: updateErr.message });
    return res.status(500).json({ error: 'Failed to update password status' });
  }

  return res.status(200).json({ success: true, route });
}
