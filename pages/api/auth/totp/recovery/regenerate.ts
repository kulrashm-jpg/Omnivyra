import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/totp/recovery/regenerate
 *
 * Standalone recovery-code regeneration endpoint.
 *
 * Differs from POST /api/auth/totp/recovery (which CONSUMES a code and
 * optionally regenerates):
 *   - This endpoint does NOT require an existing recovery code as input.
 *   - It is gated on `mfa.revoke` capability + phishing-resistant step-up.
 *   - The previous batch is revoked atomically before the new batch is
 *     hashed + persisted (RecoveryCodeService.regenerate handles this).
 *   - Plaintext codes are returned ONCE; never logged, never persisted in
 *     plaintext.
 *
 * Bridge principals are rejected by the capability gate.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { regenerate } from '../../../../../backend/security/totp/RecoveryCodeService';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { logSecurityEvent } from '../../../../../backend/security/audit/SecurityAuditService';
import { MFA_REVOKE } from '../../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // mfa.revoke is policy-marked phishing-resistant step-up. Bridge
  // principals fail at the step-up evaluation; they cannot regenerate
  // recovery codes.
  const guard = await requireCapability(req, res, {
    capability: MFA_REVOKE,
    reason: 'user regenerates recovery codes (revokes prior batch)',
  });
  if (guard.ok !== true) return;
  const p = guard.principal;

  const ip = clientIp(req);
  const ua = userAgent(req);

  await logSecurityEvent({
    capability: MFA_REVOKE,
    decision: 'recovery_regeneration_started',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    principalSupabaseUid: p.supabaseUid,
    ip,
    userAgent: ua,
  });

  let result: Awaited<ReturnType<typeof regenerate>>;
  try {
    result = await regenerate({ userId: p.userId, ip, userAgent: ua });
  } catch (err) {
    await logSecurityEvent({
      capability: MFA_REVOKE,
      decision: 'recovery_regeneration_denied',
      actorUserId: p.userId,
      actorSessionId: p.sessionId,
      principalUserId: p.userId,
      principalSupabaseUid: p.supabaseUid,
      reason: err instanceof Error ? err.message : String(err),
      ip,
      userAgent: ua,
    });
    return res.status(500).json({ error: 'Failed to regenerate recovery codes' });
  }

  await logSecurityEvent({
    capability: MFA_REVOKE,
    decision: 'recovery_regeneration_completed',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    principalSupabaseUid: p.supabaseUid,
    resourceId: result.batchId,
    ip,
    userAgent: ua,
  });

  return res.status(201).json({
    batchId: result.batchId,
    codes: result.codes,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/totp/recovery/regenerate' });
