/**
 * POST /api/auth/sessions/revoke
 *
 * Body:
 *   { id: string }            — revoke a specific session id (must belong to caller)
 *   { revokeOthers: true }    — revoke ALL of caller's sessions except the current one
 *   { revokeAll: true }       — revoke ALL of caller's sessions (including current)
 *
 * Always emits a `session_revoked_by_user` audit event for each revoked id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import {
  clearSessionCookie,
  resolveSessionFromRequest,
  revokeAllSessionsForUser,
  revokeSession,
} from '../../../../backend/security/SessionAuthorityService';
import { revokeForAuthSession } from '../../../../backend/security/stepup/StepUpSessionService';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import { supabase as db } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(403).json({ error: 'Bridge principals have no sessions to revoke', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const id = typeof body.id === 'string' ? body.id : null;
  const revokeOthers = body.revokeOthers === true;
  const revokeAll = body.revokeAll === true;

  const ip = clientIp(req);
  const ua = userAgent(req);

  if (!id && !revokeOthers && !revokeAll) {
    return res.status(400).json({ error: 'Provide one of: id, revokeOthers, revokeAll' });
  }

  // Revoke ALL — including current session — caller is signing out everywhere.
  if (revokeAll) {
    const count = await revokeAllSessionsForUser(p.userId, 'user_revoked_all');
    if (p.sessionId) await revokeForAuthSession(p.sessionId, 'auth_session_revoked');
    clearSessionCookie(res);
    await logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'session_revoked_by_user',
      actorUserId: p.userId,
      actorSessionId: p.sessionId,
      principalUserId: p.userId,
      reason: 'user_revoked_all_sessions',
      ip,
      userAgent: ua,
    });
    return res.status(200).json({ revoked: count });
  }

  // Revoke OTHERS — keep current session alive.
  if (revokeOthers) {
    const count = await revokeAllSessionsForUser(
      p.userId,
      'user_revoked_other_sessions',
      p.sessionId ?? undefined,
    );
    await logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'session_revoked_by_user',
      actorUserId: p.userId,
      actorSessionId: p.sessionId,
      principalUserId: p.userId,
      reason: `user_revoked_other_sessions count=${count}`,
      ip,
      userAgent: ua,
    });
    return res.status(200).json({ revoked: count });
  }

  // Revoke a SPECIFIC session by id — ownership-checked.
  const { data: target } = await db
    .from('auth_sessions')
    .select('id, user_id, revoked_at')
    .eq('id', id!)
    .maybeSingle();

  if (!target) return res.status(404).json({ error: 'Session not found' });
  if ((target as { user_id: string }).user_id !== p.userId) {
    return res.status(403).json({ error: 'Not your session' });
  }
  if ((target as { revoked_at: string | null }).revoked_at) {
    return res.status(409).json({ error: 'Already revoked' });
  }

  await revokeSession(id!, 'user_revoked_session');
  await revokeForAuthSession(id!, 'auth_session_revoked');

  // If the user revoked their CURRENT session, clear the cookie too.
  if (id === p.sessionId) {
    clearSessionCookie(res);
  }

  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'session_revoked_by_user',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    resourceId: id,
    reason: id === p.sessionId ? 'user_revoked_current_session' : 'user_revoked_session',
    ip,
    userAgent: ua,
  });

  return res.status(200).json({ revoked: 1, id });
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
  }
  return (req.body ?? {}) as Record<string, unknown>;
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
