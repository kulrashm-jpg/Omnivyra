import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/devices/revoke
 *
 * Body: { id: string, reason?: string }
 *
 * Revoke a trusted device owned by the principal. Always allowed for the
 * owner — revoking a stolen device must be possible without elevation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { revoke } from '../../../../backend/security/devices/TrustedDeviceService';
import { revokeSessionsForDevice } from '../../../../backend/security/SessionAuthorityService';
import { revokeForAuthSession } from '../../../../backend/security/stepup/StepUpSessionService';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    return res.status(403).json({ error: 'Bridge principals have no devices', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const id     = typeof body.id     === 'string' ? body.id     : null;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 240) : 'user_initiated';
  if (!id) return res.status(400).json({ error: 'id required' });

  const result = await revoke({
    id,
    userId:    p.userId,
    reason,
    ip:        clientIp(req),
    userAgent: userAgent(req),
  });

  if (result.ok !== true) {
    if (result.reason === 'NOT_FOUND') return res.status(404).json({ error: 'Device not found', code: result.reason });
    if (result.reason === 'NOT_OWNER') return res.status(403).json({ error: 'Not your device', code: result.reason });
    if (result.reason === 'ALREADY_REVOKED') return res.status(409).json({ error: 'Already revoked', code: result.reason });
  }

  // ── Cascade: revoke any live auth_sessions bound to this trusted
  //    device, plus the stepup_sessions chained off them. Without this
  //    cascade, the live cookie on the revoked device continues to
  //    authenticate until natural session TTL.
  // Fail-soft — the device revoke already succeeded; cascade failure is
  // logged but not surfaced as an error to the client.
  let revokedSessionIds: string[] = [];
  let revokedStepUpCount = 0;
  try {
    revokedSessionIds = await revokeSessionsForDevice(p.userId, id, `device_revoked:${reason}`);
    for (const sid of revokedSessionIds) {
      revokedStepUpCount += await revokeForAuthSession(sid, `device_revoked:${reason}`);
    }
  } catch {
    /* non-fatal */
  }

  void logSecurityEvent({
    capability: 'mfa.revoke',
    decision: 'auth_session_revoked',
    actorUserId: p.userId,
    principalUserId: p.userId,
    resourceId: id,
    reason: `device_revoke_cascade auth=${revokedSessionIds.length} stepup=${revokedStepUpCount}`,
    ip: clientIp(req),
    userAgent: userAgent(req),
  });

  return res.status(200).json({
    revoked: true,
    cascade: {
      authSessionsRevoked: revokedSessionIds.length,
      stepUpSessionsRevoked: revokedStepUpCount,
    },
  });
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/devices/revoke' });
