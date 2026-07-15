import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/resend-invitation
 *
 * Closes the invite dead-end: an invite was sent, the user didn't click
 * the link, and the link expired or got lost. Today there is no way to
 * recover — the user must ask an admin to send another invite manually.
 *
 * Two modes:
 *
 *   1. Self-serve (no auth): { email: string }
 *      The invitee enters their email; if a non-revoked, non-accepted
 *      invitation exists for that email (regardless of expiry), we
 *      issue a fresh invitation with a new token + send it. The old
 *      invitation row is revoked. Constant 200 response — no
 *      enumeration. Per-email + per-IP rate-limited.
 *
 *   2. Admin-driven (authenticated): { invitationId: string }
 *      A COMPANY_ADMIN clicks "resend" on an existing invite from the
 *      team page. Tenant-guarded against the invitation's company. The
 *      old invitation is revoked + a fresh one is sent.
 *
 * Both modes record an audit row with actor + invite id + outcome.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import { logger } from '../../../backend/services/logger';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';

type SuccessResponse = { ok: true; invitationId?: string };
type ErrorResponse   = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();

  // Detect mode by which body field is supplied.
  const adminInvitationId = typeof body.invitationId === 'string' ? body.invitationId : null;
  const selfServeEmail    = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;

  if (!adminInvitationId && !selfServeEmail) {
    return res.status(400).json({ error: 'email or invitationId is required' });
  }

  // ── Admin-driven mode ────────────────────────────────────────────────────
  if (adminInvitationId) {
    return await handleAdminResend(req, res, adminInvitationId, ip);
  }

  // ── Self-serve mode ──────────────────────────────────────────────────────
  return await handleSelfServeResend(req, res, selfServeEmail!, ip);
}

async function handleAdminResend(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
  invitationId: string,
  ip: string,
): Promise<void> {
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true || principalResult.principal.legacyCookieSuperAdmin) {
    res.status(401).json({ error: 'Authentication required', code: 'NO_AUTH' });
    return;
  }

  // Look up the invitation + its owning company so we can run the canonical
  // tenant guard before mutating anything.
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, email, role, company_id, accepted_at, revoked_at, invited_by')
    .eq('id', invitationId)
    .maybeSingle();

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found', code: 'NOT_FOUND' });
    return;
  }
  if ((invitation as { accepted_at?: string | null }).accepted_at) {
    res.status(409).json({ error: 'Invitation already accepted', code: 'ALREADY_ACCEPTED' });
    return;
  }

  const companyId = (invitation as { company_id: string }).company_id;
  const access = await requireTenantAccess(req, res, companyId, {
    requireRoleIn: ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'],
  });
  if (!access) return;

  // Revoke the old invitation row, then issue a fresh one. The new
  // invitation gets a new token; the old token is no longer redeemable.
  await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .is('accepted_at', null)
    .is('revoked_at', null);

  let resentId: string | null = null;
  try {
    const fresh = await createAndSendInvitation({
      email:     (invitation as { email: string }).email,
      companyId,
      role:      (invitation as { role: string }).role,
      invitedBy: access.userId,
    });
    resentId = fresh.id;
  } catch (err) {
    logger.error('admin_resend_invite_failed', {
      invitationId,
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to resend invitation', code: 'RESEND_FAILED' });
    return;
  }

  void logSecurityEvent({
    capability:      'mfa.view_factors',
    decision:        'allowed',
    actorUserId:     access.userId,
    principalUserId: access.userId,
    resourceId:      resentId,
    reason:          `admin_resend_invitation original=${invitationId} new=${resentId} company=${companyId}`,
    ip,
    userAgent:       typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  res.status(200).json({ ok: true, invitationId: resentId ?? undefined });
}

async function handleSelfServeResend(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
  email: string,
  ip: string,
): Promise<void> {
  // Per-IP and per-email rate limits.
  const ipRl = await checkRateLimit(ip, {
    ...EMAIL_LINK_LIMIT,
    keyPrefix:  'rl:auth:resend-invite:ip',
    limit:      5,
    windowSecs: 3600,
  });
  if (!ipRl.allowed) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  const emailRl = await checkRateLimit(email, {
    ...EMAIL_LINK_LIMIT,
    keyPrefix:  'rl:auth:resend-invite:email',
    limit:      3,
    windowSecs: 3600,
  });
  if (!emailRl.allowed) {
    // Constant 200 — no enumeration.
    res.status(200).json({ ok: true });
    return;
  }

  // Find the most-recent non-accepted, non-revoked invitation for this
  // email. Expired invites still count — the whole point of resend is
  // to recover from expiry.
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, role, company_id, invited_by')
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let outcome: 'sent' | 'no_pending_invite' = 'no_pending_invite';
  let resentId: string | null = null;

  if (invitation) {
    // Revoke the old row + issue a fresh one with a new token.
    await supabase
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', (invitation as { id: string }).id)
      .is('accepted_at', null);

    try {
      const fresh = await createAndSendInvitation({
        email,
        companyId: (invitation as { company_id: string }).company_id,
        role:      (invitation as { role: string }).role,
        invitedBy: (invitation as { invited_by: string | null }).invited_by ?? null,
      });
      resentId = fresh.id;
      outcome  = 'sent';
    } catch (err) {
      logger.warn('self_serve_resend_invite_failed', {
        email,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void logSecurityEvent({
    capability: 'mfa.view_factors',
    decision:   outcome === 'sent' ? 'allowed' : 'denied',
    resourceId: resentId,
    reason:     `self_serve_resend_invitation outcome=${outcome} email=${email} ip=${ip}`,
    ip,
    userAgent:  typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  // Constant-response shape regardless of outcome — no enumeration.
  res.status(200).json({ ok: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/resend-invitation' });
