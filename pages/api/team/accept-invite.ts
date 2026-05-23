
/**
 * POST /api/team/accept-invite
 *
 * Accepts a pending invitation. Validates the raw token, then links the
 * authenticated Firebase user to the invited company with the specified role.
 *
 * The token is single-use: it is marked as accepted immediately after the
 * first successful verification. Concurrent duplicate submissions are
 * handled by the `accepted_at IS NULL` filter in the SELECT + the atomic
 * UPDATE — only one will succeed.
 *
 * Auth: Firebase ID token in Authorization: Bearer <token>
 *
 * Body:
 *   { token: string }   — the raw invite token from the email link
 *
 * Responses:
 *   200  { companyId, role }
 *   400  Missing token or user already has a company
 *   401  Not authenticated
 *   404  Invitation not found, expired, already used, or revoked
 *   409  User is already a member of this company
 *   500  Internal error
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { insertAuditLogStrict, SYSTEM_USER_ID } from '../../../backend/services/auditActorService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Authenticate caller ────────────────────────────────────────────────
  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const callerUid: string   = authResult.user.supabaseUid;
  const callerEmail: string = authResult.user.email;

  // ── 2. Extract and hash the raw token ────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { token } = body as { token?: string };

  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: 'A valid invitation token is required' });
  }

  const tokenHash = createHash('sha256').update(token.trim()).digest('hex');

  // ── 3. Look up the invitation (single query — fail fast if invalid) ───────
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, email, company_id, role, accepted_at, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found. It may have been revoked or the link is incorrect.' });
  }

  // Validate state — check each rejection reason explicitly for clear errors
  if (invitation.revoked_at) {
    return res.status(404).json({ error: 'This invitation has been revoked.' });
  }
  if (invitation.accepted_at) {
    return res.status(404).json({ error: 'This invitation has already been used.' });
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return res.status(404).json({ error: 'This invitation has expired. Ask your admin to send a new one.' });
  }

  // Confirm the authenticated user's email matches the invitation
  // (prevents account takeover via shared invite links)
  if (callerEmail.toLowerCase() !== invitation.email.toLowerCase()) {
    return res.status(403).json({
      error: `This invitation was sent to a different email address. Sign in as ${invitation.email} to accept it.`,
    });
  }

  // ── 4. Look up or verify caller's users row ───────────────────────────────
  // active_company_id is the canonical "primary org" pointer; users.company_id
  // is deprecated and no longer read.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, active_company_id, status')
    .or(`supabase_uid.eq.${callerUid},email.eq.${callerEmail.toLowerCase()}`)
    .maybeSingle();

  if (!userRow) {
    return res.status(401).json({ error: 'User account not found. Please complete sign-in first.' });
  }

  const userId: string = userRow.id;
  const companyId: string = invitation.company_id;
  const previousUserStatus: string | null = (userRow as any).status ?? null;

  // ── 5. Resolve existing membership ────────────────────────────────────
  // Phase 2.A invariant: a Super-Admin "Create User" flow pre-creates a
  // user_company_roles row with status='invited'. We MUST upgrade that
  // row to 'active' on acceptance rather than rejecting the invitation
  // as a duplicate. Pre-existing 'active' rows still short-circuit as
  // already-a-member (legacy behavior preserved).
  const { data: existingRole } = await supabase
    .from('user_company_roles')
    .select('id, status, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  const existingStatus = (existingRole as any)?.status ?? null;
  const existingRoleValue = (existingRole as any)?.role ?? null;

  if (existingRole && existingStatus === 'active') {
    return res.status(409).json({ error: 'You are already a member of this company.' });
  }

  // ── 6. Mark invitation as accepted (atomic — prevents double-accept) ──────
  // If a concurrent request already accepted it, updated_count will be 0.
  const acceptedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from('invitations')
    .update({ accepted_at: acceptedAt, accepted_by: userId })
    .eq('id', invitation.id)
    .is('accepted_at', null)   // guard against race condition
    .is('revoked_at', null)
    .select('id');

  if (updateErr) {
    console.error('[/api/team/accept-invite] update error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
  if (!updated || updated.length === 0) {
    // Another request won the race
    return res.status(404).json({ error: 'This invitation has already been used.' });
  }

  // ── 7. Activate membership ───────────────────────────────────────────────
  // - If an 'invited' role row exists (Phase 2.A pre-create), upgrade it.
  // - Otherwise INSERT (legacy single-endpoint acceptance flow).
  const now = new Date().toISOString();

  if (existingRole) {
    const { error: roleErr } = await supabase
      .from('user_company_roles')
      .update({
        role: invitation.role,
        status: 'active',
        accepted_at: now,
        deactivated_at: null,
        updated_at: now,
      })
      .eq('id', (existingRole as any).id);
    if (roleErr) {
      console.error('[/api/team/accept-invite] role upgrade error:', roleErr.message);
      return res.status(500).json({ error: 'Failed to activate membership' });
    }
  } else {
    const { error: insErr } = await supabase.from('user_company_roles').insert({
      user_id:    userId,
      company_id: companyId,
      role:       invitation.role,
      status:     'active',
      accepted_at: now,
      created_at: now,
      updated_at: now,
    });
    if (insErr) {
      console.error('[/api/team/accept-invite] role insert error:', insErr.message);
      return res.status(500).json({ error: 'Failed to activate membership' });
    }
  }

  // ── 8. Sync canonical user lifecycle state ────────────────────────────────
  // - Flip users.status invited → active (Phase 2.A lifecycle).
  // - Populate active_company_id if not already set. Existing pointers are
  //   preserved (the user may already belong to a different primary org).
  const userPatch: Record<string, unknown> = { updated_at: now };
  if (previousUserStatus === 'invited') userPatch.status = 'active';
  if (!(userRow as any).active_company_id) userPatch.active_company_id = companyId;
  if (Object.keys(userPatch).length > 1) {
    await supabase.from('users').update(userPatch).eq('id', userId);
  }

  // ── 9. Canonical audit row ────────────────────────────────────────────────
  // Non-null actor: the user accepting the invitation IS the actor. The
  // invitation.invited_by (admin/super-admin) lands in metadata for trace.
  await insertAuditLogStrict({
    actorUserId: userId || SYSTEM_USER_ID,
    action: 'INVITATION_ACCEPTED',
    targetUserId: userId,
    companyId,
    metadata: {
      invitation_id: invitation.id,
      role: invitation.role,
      previous_user_status: previousUserStatus,
      previous_role_status: existingStatus,
      previous_role_value: existingRoleValue,
      role_existed: Boolean(existingRole),
      active_company_id_set: !(userRow as any).active_company_id,
    },
  });

  return res.status(200).json({
    companyId,
    role: invitation.role,
  });
}
