/**
 * POST /api/team/invite
 *
 * Creates a single-use, expiring invitation for a user to join the caller's company.
 * Sends the invite email via the configured mailer (or logs to console in dev).
 *
 * Auth: Firebase ID token in Authorization: Bearer <token>
 * Required role: COMPANY_ADMIN
 *
 * Body:
 *   { email: string, role?: string }
 *
 * Responses:
 *   201  { invitationId }
 *   400  Invalid input
 *   401  Not authenticated
 *   403  Not a COMPANY_ADMIN
 *   409  Active invite already exists for this email + company
 *   500  Internal error
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthHeader } from '../../../lib/auth/serverValidation';
import { checkRateLimit, LOGIN_LIMIT, INVITE_UID_LIMIT } from '../../../lib/auth/rateLimit';

const VALID_ROLES = new Set([
  'COMPANY_ADMIN',
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
]);

const INVITE_EXPIRY_DAYS = 7;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Rate limit per IP ──────────────────────────────────────────────────
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...LOGIN_LIMIT, keyPrefix: 'rl:invite', limit: 20, windowSecs: 60 * 60 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many invite requests. Try again later.' });
  }

  // ── 2. Authenticate caller ────────────────────────────────────────────────
  // checkRevoked=true: invite is a role-management operation — a revoked token
  // (e.g. from a deleted account) must be rejected immediately, not within 1h.
  let callerUid: string;
  try {
    const verified = await verifyAuthHeader(req.headers.authorization, true);
    callerUid = verified.uid;
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // ── 2b. Post-auth UID rate limit ──────────────────────────────────────────
  const rlUid = await checkRateLimit(callerUid, INVITE_UID_LIMIT);
  if (!rlUid.allowed) {
    return res.status(429).json({ error: 'Too many invite requests. Try again later.' });
  }

  // ── 3. Parse and validate body ────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, role = 'CONTENT_CREATOR', companyId: bodyCompanyId } = body as {
    email?: string;
    role?: string;
    /** Required when caller is SUPER_ADMIN — specify which company to invite into */
    companyId?: string;
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ── 4. Look up caller and resolve their company ───────────────────────────
  // We intentionally look up the role from user_company_roles, NOT from
  // users.role (which is a denormalized column that is often NULL/stale).
  const { data: callerUser } = await supabase
    .from('users')
    .select('id')
    .eq('firebase_uid', callerUid)
    .maybeSingle();

  if (!callerUser) {
    return res.status(401).json({ error: 'User not found' });
  }

  const callerId: string = (callerUser as any).id;

  // Check for SUPER_ADMIN role in user_company_roles
  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', callerId)
    .eq('role', 'SUPER_ADMIN')
    .limit(1)
    .maybeSingle();

  const callerIsSuperAdmin = !!superAdminRow;

  let companyId: string;

  if (callerIsSuperAdmin) {
    // SUPER_ADMIN must supply companyId in the request body
    if (!bodyCompanyId || typeof bodyCompanyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required when sending invitations as super admin' });
    }
    companyId = bodyCompanyId.trim();
  } else {
    // Regular users: must have an active COMPANY_ADMIN role in some company
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', callerId)
      .eq('role', 'COMPANY_ADMIN')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!roleRow) {
      return res.status(403).json({ error: 'Only company admins can send invitations' });
    }
    companyId = (roleRow as any).company_id;
  }

  // ── 5. Check for an existing active invite ────────────────────────────────
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
      error: `An active invitation for ${normalizedEmail} already exists. Revoke it first if you want to resend.`,
    });
  }

  // ── 6. Generate a cryptographically secure single-use token ───────────────
  // 32 random bytes → 64-char hex string sent in email link
  // SHA-256 of that hex is stored in DB — even if DB is compromised, the
  // raw token cannot be derived from the hash.
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400 * 1_000).toISOString();

  // ── 7. Persist invitation ─────────────────────────────────────────────────
  const { data: invitation, error: insertErr } = await supabase
    .from('invitations')
    .insert({
      email:      normalizedEmail,
      company_id: companyId,
      role,
      token_hash: tokenHash,
      invited_by: callerId,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Unique constraint — race condition with another concurrent invite
      return res.status(409).json({ error: 'An invitation for this email already exists' });
    }
    console.error('[/api/team/invite] insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to create invitation' });
  }

  // ── 8. Retrieve company name for email content ────────────────────────────
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();

  const companyName = (company as any)?.name ?? 'your team';

  // ── 9. Send invitation email ──────────────────────────────────────────────
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.omnivyra.com';
  const inviteLink = `${baseUrl}/auth/accept-invite?token=${rawToken}`;

  await sendInviteEmail({ to: normalizedEmail, companyName, inviteLink, role, expiresInDays: INVITE_EXPIRY_DAYS });

  return res.status(201).json({ invitationId: invitation.id });
}

// ── Email helper ──────────────────────────────────────────────────────────────
// Replace with your mailer (Resend, SendGrid, etc.) in production.
async function sendInviteEmail(params: {
  to: string;
  companyName: string;
  inviteLink: string;
  role: string;
  expiresInDays: number;
}) {
  const { to, companyName, inviteLink, role, expiresInDays } = params;

  // Production: call Resend / SendGrid / SES here.
  // For now: log in development, throw in production if mailer not configured.
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] Invite email to ${to}:\n  Company: ${companyName}\n  Role: ${role}\n  Link: ${inviteLink}\n  Expires in: ${expiresInDays} days`);
    return;
  }

  // Example Resend integration (uncomment and install resend package):
  // const { Resend } = await import('resend');
  // const resend = new Resend(process.env.RESEND_API_KEY!);
  // await resend.emails.send({
  //   from: 'noreply@omnivyra.com',
  //   to,
  //   subject: `You've been invited to ${companyName} on Omnivyra`,
  //   html: `<p>You've been invited as <strong>${role}</strong>...</p><a href="${inviteLink}">Accept Invitation</a>`,
  // });

  console.warn('[invite] Mailer not configured — invite link not sent to', to);
}
