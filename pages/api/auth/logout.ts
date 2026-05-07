/**
 * POST /api/auth/logout
 *
 * Server-side logout. Revokes the principal's auth_session, cascades the
 * revoke to any active step-up sessions bound to it, clears the session
 * cookie, and audits.
 *
 * Note: this does NOT call supabase.auth.signOut() — that is a
 * browser-side operation managed by the Supabase client. The two are
 * complementary; the frontend logout flow should call BOTH.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import {
  clearSessionCookie,
  resolveSessionFromRequest,
  revokeSession,
} from '../../../backend/security/SessionAuthorityService';
import { revokeForAuthSession } from '../../../backend/security/stepup/StepUpSessionService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Always clear the cookie regardless of session state — defensive against
  // stale cookies that no longer match a live row.
  clearSessionCookie(res);

  // Best-effort principal resolution for audit attribution. We don't 401
  // a logout call: the client's intent is "tear it down", and we should
  // happily comply even if their session is already invalid.
  const principalResult = await resolvePrincipal(req);
  const lookup = await resolveSessionFromRequest(req);
  const ip = clientIp(req);
  const ua = userAgent(req);

  let revokedSessionId: string | null = null;
  let revokedStepUpCount = 0;

  if (lookup.ok === true) {
    revokedSessionId = lookup.session.id;
    await revokeSession(lookup.session.id, 'user_logout');
    revokedStepUpCount = await revokeForAuthSession(lookup.session.id, 'auth_session_revoked');
  }

  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'auth_session_revoked',
    actorUserId: principalResult.ok === true ? principalResult.principal.userId : null,
    actorSessionId: revokedSessionId,
    principalUserId: principalResult.ok === true ? principalResult.principal.userId : null,
    principalSupabaseUid: principalResult.ok === true ? principalResult.principal.supabaseUid : null,
    reason: 'user_logout',
    ip,
    userAgent: ua,
  });

  return res.status(200).json({
    loggedOut: true,
    revokedAuthSessionId: revokedSessionId,
    revokedStepUpCount,
  });
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
