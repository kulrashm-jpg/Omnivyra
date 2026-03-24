/**
 * POST /api/auth/sync-firebase-user
 *
 * Verifies a Firebase ID token (via Admin SDK) then upserts the user's identity
 * into the Supabase `users` table. Called by syncUserToSupabase() in
 * lib/auth/emailLink.ts immediately after a successful Firebase Email Link sign-in.
 *
 * Request body:
 *   { uid: string; email: string; idToken: string }
 *
 * Responses:
 *   200 { ok: true }
 *   400 { error: string }  — missing fields or blocked email domain
 *   401 { error: string }  — invalid / expired Firebase token, or UID mismatch
 *   500 { error: string }  — database write failed
 *
 * Security:
 *   - Firebase ID token is verified via the Admin SDK (RS256 signature check)
 *     before any database operation — no unverified uid/email is trusted from body.
 *   - Email domain is validated server-side against the blocked-domain list.
 *   - Supabase write uses the service-role key (server-side only) to bypass RLS.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyToken, validateWorkEmail } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';

type RequestBody = { uid: string; email: string; idToken: string };
type SuccessResponse = { ok: true };
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { uid, email, idToken } = (req.body ?? {}) as Partial<RequestBody>;

  if (!uid || !email || !idToken) {
    return res.status(400).json({ error: 'uid, email, and idToken are all required' });
  }

  // ── 1. Server-side domain validation ─────────────────────────────────────
  try {
    validateWorkEmail(email);
  } catch (err: any) {
    return res.status(400).json({ error: err.message ?? 'Email domain not allowed' });
  }

  // ── 2. Verify Firebase ID token (Admin SDK — RS256 signature check) ───────
  let verifiedUid: string;
  try {
    const verified = await verifyToken(idToken);
    verifiedUid = verified.uid;
  } catch (err: any) {
    return res.status(401).json({ error: err.message ?? 'Invalid Firebase token' });
  }

  // Guard: token's uid must match the uid in the request body
  if (verifiedUid !== uid) {
    return res.status(401).json({ error: 'Token UID does not match request UID' });
  }

  // ── 3. Upsert user into Supabase ──────────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ── 3a. Block deleted users from re-registering ───────────────────────────
  // Check both by firebase_uid and by email (covers the case where Firebase
  // issued a new UID for an email that was previously deleted).
  const { data: existingByUid } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('firebase_uid', uid)
    .maybeSingle();

  if (existingByUid && (existingByUid as any).is_deleted) {
    console.warn('[sync-firebase-user] ghost_session_detected', {
      event:  'ghost_session_detected',
      uid,
      reason: 'user_is_soft_deleted',
    });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:      (existingByUid as any).id,
      firebaseUid: uid,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'sync-firebase-user' },
    });
    return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  if (!existingByUid) {
    // Check by email — covers re-signup with a new Firebase UID (e.g. after account deletion)
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id, is_deleted')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingByEmail && (existingByEmail as any).is_deleted) {
      console.warn('[sync-firebase-user] ghost_session_detected', {
        event:  'ghost_session_detected',
        uid,
        reason: 'email_is_soft_deleted',
        email:  email.toLowerCase().trim(),
      });
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        userId:      (existingByEmail as any).id,
        firebaseUid: uid,
        metadata: { reason: 'email_is_soft_deleted', endpoint: 'sync-firebase-user' },
      });
      return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
    }
  }

  const now = new Date().toISOString();
  const normalizedEmail = email.toLowerCase().trim();

  // ── 3b. Try upsert by firebase_uid first ─────────────────────────────────
  // Requires a non-partial UNIQUE constraint on firebase_uid (see migration
  // 20260401_firebase_uid_full_unique.sql) — a partial index is not usable by
  // PostgREST's ON CONFLICT (firebase_uid) clause and causes a 42P10 error.
  const { error: uidUpsertError } = await supabase
    .from('users')
    .upsert(
      { firebase_uid: uid, email: normalizedEmail, is_email_verified: true, last_sign_in_at: now },
      { onConflict: 'firebase_uid' },
    );

  if (!uidUpsertError) {
    return res.status(200).json({ ok: true });
  }

  // ── 3c. If upsert failed on email uniqueness, update the invited-user stub ─
  // This covers invited users: their stub row has email but no firebase_uid yet.
  // Any other error (missing column, NOT NULL violation, etc.) is a hard failure.
  const isEmailConflict =
    uidUpsertError.code === '23505' ||
    uidUpsertError.message?.toLowerCase().includes('unique') ||
    uidUpsertError.message?.toLowerCase().includes('duplicate');

  if (!isEmailConflict) {
    console.error('[sync-firebase-user] upsert error (non-unique):', {
      code:    uidUpsertError.code,
      message: uidUpsertError.message,
      details: uidUpsertError.details,
      hint:    uidUpsertError.hint,
    });
    return res.status(500).json({ error: 'Failed to sync user to database' });
  }

  // Email-conflict fallback: set firebase_uid on the stub row for invited users.
  const { data: updatedRows, error: updateError } = await supabase
    .from('users')
    .update({ firebase_uid: uid, is_email_verified: true, last_sign_in_at: now })
    .eq('email', normalizedEmail)
    .is('firebase_uid', null)
    .select('id');

  if (updateError) {
    console.error('[sync-firebase-user] email-fallback update error:', updateError);
    return res.status(500).json({ error: 'Failed to sync user to database' });
  }

  if (!updatedRows || updatedRows.length === 0) {
    // The email row already has a firebase_uid set (so the IS NULL filter found nothing).
    // This can happen when:
    //   a) The UNIQUE constraint migration hasn't run yet and the partial index caused
    //      the primary upsert to fail with 42P10 — it's actually the SAME user.
    //   b) A genuinely different Firebase account owns this email (data conflict).
    //
    // Disambiguate by checking whether the existing row belongs to the same UID.
    const { data: existingRow } = await supabase
      .from('users')
      .select('id, firebase_uid')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingRow && (existingRow as any).firebase_uid === uid) {
      // Same user — primary upsert failed only due to the partial-index bug.
      // Update last_sign_in_at so post-login routing sees fresh data.
      const { error: touchError } = await supabase
        .from('users')
        .update({ is_email_verified: true, last_sign_in_at: now })
        .eq('email', normalizedEmail);

      if (touchError) {
        console.error('[sync-firebase-user] touch update error:', touchError);
        return res.status(500).json({ error: 'Failed to sync user to database' });
      }
      return res.status(200).json({ ok: true });
    }

    if (!existingRow) {
      // No row at all — the primary upsert INSERT failed due to the partial-index
      // bug (42P10). Fall back to a direct INSERT.
      const { error: insertError } = await supabase
        .from('users')
        .insert({ firebase_uid: uid, email: normalizedEmail, is_email_verified: true, last_sign_in_at: now });

      if (insertError) {
        console.error('[sync-firebase-user] direct insert error:', insertError);
        return res.status(500).json({ error: 'Failed to sync user to database' });
      }
      return res.status(200).json({ ok: true });
    }

    // Truly different Firebase account owns this email.
    console.error('[sync-firebase-user] email taken by another account:', {
      uid,
      email: normalizedEmail,
      existingUid: (existingRow as any)?.firebase_uid ?? null,
    });
    return res.status(409).json({ error: 'Email address is already associated with a different account' });
  }

  return res.status(200).json({ ok: true });
}
