import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/logout
 *
 * Phase 1 — super-admin canonicalization:
 *   - Clears legacy bridge cookies (super_admin_session, content_architect_session,
 *     content_architect_company_id) — UNCHANGED behavior.
 *   - Additionally revokes the canonical auth_session if one is bound to
 *     the request and clears the omnivyra_session cookie.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  resolveSessionFromRequest,
  revokeSession,
  clearSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { logger } from '../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Best-effort canonical session revocation. Failure is non-fatal — the
  // bridge cookies still get cleared so the operator's logout intent is
  // honored even if the canonical path errors.
  try {
    const lookup = await resolveSessionFromRequest(req);
    if (lookup.ok === true) {
      await revokeSession(lookup.session.id, 'super_admin_logout');
      clearSessionCookie(res);
      await logSecurityEvent({
        capability: 'super_admin.legacy',
        decision: 'auth_session_revoked',
        actorUserId: lookup.session.user_id,
        actorSessionId: lookup.session.id,
        principalUserId: lookup.session.user_id,
        reason: 'super-admin logout',
      });
    } else {
      // No canonical session present — just clear the cookie defensively
      // in case a stale signed cookie is still in the browser.
      clearSessionCookie(res);
    }
  } catch (err) {
    logger.warn('super_admin_logout_canonical_revoke_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const clearSuperAdmin = [
    'super_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  const clearContentArchitect = [
    'content_architect_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  const clearContentArchitectCompany = [
    'content_architect_company_id=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');

  // Preserve any Set-Cookie already added by clearSessionCookie above.
  const existing = res.getHeader('Set-Cookie');
  const all: string[] = [];
  if (Array.isArray(existing)) all.push(...existing);
  else if (typeof existing === 'string') all.push(existing);
  all.push(clearSuperAdmin, clearContentArchitect, clearContentArchitectCompany);
  res.setHeader('Set-Cookie', all);

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/logout' });
