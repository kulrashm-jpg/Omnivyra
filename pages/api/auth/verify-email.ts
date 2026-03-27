/**
 * POST /api/auth/verify-email
 *
 * Protected endpoint. Called after the user clicks the email verification link
 * and the frontend has obtained a valid session.
 *
 * Updates onboarding_state and is_email_verified in public.users.
 * Completes any pending signup_intent.
 * Returns a routing decision based on user state.
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

  if (userErr === 'ACCOUNT_DELETED') {
    return res.status(403).json({ error: 'Account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  const now = new Date().toISOString();

  // ── 1a. New user — token valid but no public.users row yet ────────────────
  // (signup only creates signup_intent; user row is created here on first verify)
  let resolvedUserId: string;
  let resolvedEmail:  string | null;

  if (!user) {
    // Re-verify token directly to confirm it is valid (not just missing from DB)
    const rawToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(rawToken);
    if (authErr || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const email = authUser.email?.toLowerCase() ?? '';

    // Create user row (upsert on email to handle any race)
    const { data: inserted } = await supabase
      .from('users')
      .insert({ supabase_uid: authUser.id, email, is_email_verified: true })
      .select('id')
      .maybeSingle();

    let newId = (inserted as any)?.id ?? null;
    if (!newId) {
      const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
      newId = (existing as any)?.id ?? null;
    }
    if (!newId) return res.status(500).json({ error: 'Could not initialize user account.' });

    resolvedUserId = newId;
    resolvedEmail  = email || null;
  } else {
    resolvedUserId = user.id;
    resolvedEmail  = user.email ?? null;
  }

  // ── 2. Mark email as verified & advance onboarding_state ──────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('name, onboarding_state, has_password')
    .eq('id', resolvedUserId)
    .single();

  if (!userRow) {
    return res.status(404).json({ error: 'User not found' });
  }

  const currentState = (userRow as any).onboarding_state;
  const nextState = currentState === 'pending_verification' ? 'verified' : currentState;

  await supabase
    .from('users')
    .update({
      is_email_verified: true,
      onboarding_state:  nextState,
      last_sign_in_at:   now,
    })
    .eq('id', resolvedUserId);

  // ── 3. Complete any pending signup_intent for this email ──────────────────
  if (resolvedEmail) {
    await supabase
      .from('signup_intents')
      .update({ status: 'completed', completed_at: now })
      .eq('email', resolvedEmail.toLowerCase())
      .eq('status', 'pending');
  }

  // ── 4. Determine routing ──────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const mode = (body as any).mode ?? '';

  let route: string;

  if (!(userRow as any).has_password && mode !== 'passwordless') {
    route = '/auth/set-password';
  } else if (!(userRow as any).name) {
    route = '/onboarding/profile';
  } else {
    // Check for active company membership
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', resolvedUserId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    route = roleRow ? '/dashboard' : '/onboarding/company';
  }

  return res.status(200).json({ success: true, route });
}
