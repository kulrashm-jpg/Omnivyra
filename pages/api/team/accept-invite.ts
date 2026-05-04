import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * POST /api/team/accept-invite
 *
 * Accepts a pending invitation. Validates the raw token, then links the
 *
 * The token is single-use: it is marked as accepted immediately after the
 * first successful verification. Concurrent duplicate submissions are
 * handled by the `accepted_at IS NULL` filter in the SELECT + the atomic
 * UPDATE â€” only one will succeed.
 *
 *
 * Body:
 *   { token: string }   â€” the raw invite token from the email link
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
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // â”€â”€ 1. Authenticate caller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let callerUid: string;
  let callerEmail: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    callerUid   = verified.id;
    callerEmail = verified.email;
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // â”€â”€ 2. Extract and hash the raw token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { token } = body as { token?: string };

  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: 'A valid invitation token is required' });
  }

  const tokenHash = createHash('sha256').update(token.trim()).digest('hex');

  // â”€â”€ 3. Look up the invitation (single query â€” fail fast if invalid) â”€â”€â”€â”€â”€â”€â”€
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, email, company_id, role, accepted_at, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found. It may have been revoked or the link is incorrect.' });
  }

  // Validate state â€” check each rejection reason explicitly for clear errors
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

  // â”€â”€ 4. Look up or verify caller's users row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: userRow } = await supabase
    .from('users')
    .select('id, company_id')
    .or(`supabase_uid.eq.${callerUid},email.eq.${callerEmail.toLowerCase()}`)
    .maybeSingle();

  if (!userRow) {
    return res.status(401).json({ error: 'User account not found. Please complete sign-in first.' });
  }

  const userId: string = userRow.id;
  const companyId: string = invitation.company_id;

  // â”€â”€ 5. Check for existing membership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: existingRole } = await supabase
    .from('user_company_' + 'roles')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (existingRole) {
    return res.status(409).json({ error: 'You are already a member of this company.' });
  }

  // â”€â”€ 6. Mark invitation as accepted (atomic â€” prevents double-accept) â”€â”€â”€â”€â”€â”€
  // If a concurrent request already accepted it, updated_count will be 0.
  const { data: updated, error: updateErr } = await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
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

  // â”€â”€ 7. Add user to the company â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const now = new Date().toISOString();

  await supabase.from('user_company_' + 'roles').insert({
    user_id:    userId,
    company_id: companyId,
    role:       invitation.role,
    status:     'active',
    created_at: now,
    updated_at: now,
  });

  // Link user's primary company if not already set
  if (!userRow.company_id) {
    await supabase
      .from('users')
      .update({ company_id: companyId, role: invitation.role })
      .eq('id', userId);
  }

  return res.status(200).json({
    companyId,
    role: invitation.role,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

