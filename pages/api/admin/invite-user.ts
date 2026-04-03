
/**
 * POST /api/admin/invite-user
 *
 * Protected endpoint. Creates a team invitation for the caller's company.
 * Requires COMPANY_ADMIN role (or SUPER_ADMIN with companyId in body).
 *
 * This is the admin-facing invite endpoint. See also /api/team/invite
 * which handles the same operation with rate limiting and email delivery.
 *
 * Body: { email: string, role?: string, companyId?: string }
 * Auth: Bearer <supabase_access_token>
 * Returns: { invitationId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomBytes } from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

const VALID_ROLES = new Set([
  'COMPANY_ADMIN',
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
]);

const INVITE_EXPIRY_DAYS = 7;

type SuccessResponse = { invitationId: string };
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

  // ── 2. Parse and validate body ────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, role = 'CONTENT_CREATOR', companyId: bodyCompanyId } = body as {
    email?: string;
    role?: string;
    companyId?: string;
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── 3. Resolve caller's company & verify COMPANY_ADMIN role ───────────────
  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const isSuperAdmin = !!superAdminRow;

  let companyId: string;

  if (isSuperAdmin) {
    if (!bodyCompanyId) {
      return res.status(400).json({ error: 'companyId is required for super admin invitations' });
    }
    companyId = bodyCompanyId.trim();
  } else {
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('role', 'COMPANY_ADMIN')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!roleRow) {
      return res.status(403).json({ error: 'Only company admins can send invitations' });
    }
    companyId = (roleRow as any).company_id;
  }

  // ── 4. Check for existing active invite ───────────────────────────────────
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('company_id', companyId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: `An active invitation for ${normalizedEmail} already exists.`,
      code: 'INVITE_EXISTS',
    });
  }

  // ── 5. Generate secure token ──────────────────────────────────────────────
  const rawToken  = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400_000).toISOString();

  // ── 6. Insert invitation ──────────────────────────────────────────────────
  const { data: invitation, error: insertErr } = await supabase
    .from('invitations')
    .insert({
      email:      normalizedEmail,
      company_id: companyId,
      role,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return res.status(409).json({ error: 'An invitation for this email already exists', code: 'INVITE_EXISTS' });
    }
    console.error('[admin/invite-user] insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to create invitation' });
  }

  return res.status(201).json({ invitationId: invitation.id });
}
