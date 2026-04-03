
/**
 * POST /api/auth/sync-supabase-user
 *
 * Called by /auth/callback immediately after Supabase OAuth / email auth.
 * Upserts the user's identity into public.users and sets supabase_uid.
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifySupabaseAuthHeader, validateWorkEmail } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';

type SuccessResponse = { ok: true };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Supabase token ──────────────────────────────────────────────
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // ── 2. Work-email validation (skip for invited users — they may use any domain) ──
  // Don't block social logins with personal emails if they were explicitly invited.
  const isWorkEmail = (() => {
    try { validateWorkEmail(email); return true; } catch { return false; }
  })();

  // ── 3. Block soft-deleted accounts ───────────────────────────────────────
  const normalizedEmail = email.toLowerCase().trim();
  const { data: existingByUid } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (existingByUid && (existingByUid as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:     (existingByUid as any).id,
      metadata:   { reason: 'user_is_soft_deleted', endpoint: 'sync-supabase-user' },
    });
    return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  if (!existingByUid) {
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id, is_deleted')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail && (existingByEmail as any).is_deleted) {
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        userId:   (existingByEmail as any).id,
        metadata: { reason: 'email_is_soft_deleted', endpoint: 'sync-supabase-user' },
      });
      return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
    }
  }

  const now = new Date().toISOString();

  // ── 4. Upsert by supabase_uid ────────────────────────────────────────────
  // First try: existing row already has supabase_uid (returning user)
  if (existingByUid) {
    await supabase
      .from('users')
      .update({ is_email_verified: true, last_sign_in_at: now })
      .eq('supabase_uid', supabaseUid);
    return res.status(200).json({ ok: true });
  }

  // Second try: row exists by email (invited user or Firebase-migrated user) —
  // stamp supabase_uid on it so future lookups use the faster UID path.
  const { data: byEmail } = await supabase
    .from('users')
    .select('id, supabase_uid')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (byEmail) {
    // Restore active_company_id from existing role if missing (stateful login)
    const updatePayload: Record<string, unknown> = {
      supabase_uid:      supabaseUid,
      is_email_verified: true,
      last_sign_in_at:   now,
    };
    if (!(byEmail as any).active_company_id) {
      const { data: roleRow } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', (byEmail as any).id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (roleRow) updatePayload.active_company_id = (roleRow as any).company_id;
    }
    await supabase.from('users').update(updatePayload).eq('id', (byEmail as any).id);
    return res.status(200).json({ ok: true });
  }

  // Third: brand-new user — INSERT
  // Pre-link to invitation company if one exists for this email
  let invitedCompanyId: string | null = null;
  const { data: pendingInvite } = await supabase
    .from('invitations')
    .select('company_id')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingInvite) invitedCompanyId = (pendingInvite as any).company_id;

  const { error: insertError } = await supabase.from('users').insert({
    supabase_uid:      supabaseUid,
    email:             normalizedEmail,
    is_email_verified: true,
    last_sign_in_at:   now,
    ...(invitedCompanyId ? { active_company_id: invitedCompanyId } : {}),
  });

  if (insertError) {
    console.error('[sync-supabase-user] insert error:', insertError);
    return res.status(500).json({ error: 'Failed to sync user to database' });
  }

  return res.status(200).json({ ok: true });
}
