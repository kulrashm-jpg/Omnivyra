
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
import {
  extractAccessToken,
  validateAuthToken,
  resolveAuthenticatedUser,
} from '../../../backend/services/authResolver';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { getPostLoginRoute as getUserPreferenceRoute } from '../../../backend/services/userPreferencesService';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  requestIp,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

type SuccessResponse = { success: true; route: string; requiresLogin?: boolean; email?: string | null };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  // ── 1. Verify Bearer header or Supabase auth cookie & resolve user ────────
  // resolveAuthenticatedUser returns USER_NOT_FOUND when the public.users
  // row does not exist yet (first-time verify). For that case we re-extract
  // the access token and validate it via the canonical authResolver path,
  // then INSERT the public.users row from the auth.users identity. ACCOUNT_*
  // errors fail with the legacy contract; INVALID_TOKEN / NO_TOKEN fall
  // through to a generic 401 below for the new-user path.
  const authResult = await resolveAuthenticatedUser(req);

  if (authResult.error === 'ACCOUNT_DELETED') {
    return res.status(403).json({ error: 'Account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  const user = authResult.user;
  if (user) seedRequestContextFromRequest(req, { userId: user.id });

  // ── 1b. App-level verification gate (AUTH-001 §1) ─────────────────────────
  // is_email_verified may only ever mirror the Supabase auth confirm state.
  // A session whose auth identity is NOT confirmed cannot use this endpoint
  // to self-verify — that would make the gate forgeable by any session holder.
  if (user && !user.emailVerified) {
    return res.status(403).json({ error: 'Email address is not verified yet.', code: 'EMAIL_NOT_VERIFIED' });
  }

  const now = new Date().toISOString();

  // ── 1a. New user — token valid but no public.users row yet ────────────────
  // (signup only creates signup_intent; user row is created here on first verify)
  let resolvedUserId: string;
  let resolvedEmail:  string | null;

  if (!user) {
    // No public.users row yet — re-validate the auth identity via the
    // canonical resolver (Bearer header OR Supabase cookie) so we can
    // insert the row using auth.users.id + email.
    const token = extractAccessToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    }
    const identity = await validateAuthToken(token);
    if (!identity) {
      return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    }

    // AUTH-001 §1 — same gate for the first-verify path: the public.users row
    // is only created (with is_email_verified=true) when Supabase itself says
    // the email is confirmed.
    if (!identity.emailVerified) {
      return res.status(403).json({ error: 'Email address is not verified yet.', code: 'EMAIL_NOT_VERIFIED' });
    }

    const email = identity.email?.toLowerCase() ?? '';

    const insertResult = await supabase
      .from('users')
      .insert({ supabase_uid: identity.supabaseUid, email, is_email_verified: true })
      .select('id')
      .maybeSingle();

    let newId = (insertResult.data as any)?.id ?? null;
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
  const userRowResult = await supabase
    .from('users')
    .select('name, onboarding_state, has_password, last_sign_in_at')
    .eq('id', resolvedUserId)
    .single();

  const userRow = userRowResult.data;
  if (!userRow) {
    return res.status(404).json({ error: 'User not found' });
  }

  const currentState = (userRow as any).onboarding_state;
  const nextState = currentState === 'pending_verification' ? 'verified' : currentState;
  const priorLastSignInAt = (userRow as any).last_sign_in_at as string | null | undefined;
  const isFirstVerifiedLogin = !priorLastSignInAt;

  // Build update payload — only include columns that exist
  const updatePayload: Record<string, unknown> = { is_email_verified: true, last_sign_in_at: now };
  if (nextState !== undefined) updatePayload.onboarding_state = nextState;

  await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', resolvedUserId);

  // Canonical journey event (AUTH-001 §9). Idempotent-by-outcome: repeat
  // verifies emit another allowed row for the same correlation ID, which is
  // how operators see re-verification volume without any state change.
  if (resolvedEmail) {
    void ensureSignupCorrelationId(resolvedEmail).then((correlationId) =>
      emitSignupEvent({
        event:         'VerificationSucceeded',
        outcome:       'allowed',
        correlationId,
        email:         resolvedEmail,
        userId:        resolvedUserId,
        reason:        currentState === 'pending_verification' ? 'first_verify' : 'repeat_verify',
        ip:            requestIp(req),
        userAgent:     requestUserAgent(req),
      }),
    );
  }

  // ── 3. Complete any pending signup_intent for this email ──────────────────
  // sync-supabase-user's bootstrap already attempts to mark the intent
  // completed; this is a backstop. Any failure here is logged and
  // ignored — the intent state is informational and must NOT break auth.
  if (resolvedEmail) {
    try {
      const { error: signupIntentError } = await supabase
        .from('signup_intents')
        .update({ status: 'completed', completed_at: now })
        .eq('email', resolvedEmail.toLowerCase())
        .eq('status', 'pending');

      if (signupIntentError) {
        logger.warn('auth_verify_email_signup_intent_failed', {
          email: resolvedEmail,
          message: signupIntentError.message,
        });
      }
    } catch (err) {
      logger.warn('auth_verify_email_signup_intent_threw', {
        email: resolvedEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 4. Determine routing ──────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const mode = (body as any).mode ?? '';

  let route: string;

  // Route to set-password if: no password set yet (new signup) OR column missing (new user)
  const hasPassword = (userRow as any).has_password === true;
  if (!hasPassword && mode !== 'passwordless') {
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
    if (!roleRow) {
      route = '/onboarding/company';
    } else {
      route = isFirstVerifiedLogin ? '/welcome' : await getUserPreferenceRoute(resolvedUserId);
    }
  }

  // For first-time email verifications on a password-based signup, send the
  // user back to /login with an explicit "Email verified" banner instead of
  // silently auto-signing them in. Magic-link / passwordless flows keep the
  // auto-sign-in behavior — they have no password to log in with.
  const requiresLogin =
    isFirstVerifiedLogin && hasPassword && mode !== 'passwordless';

  return res.status(200).json({
    success: true,
    route,
    requiresLogin,
    email: resolvedEmail,
  });
}
