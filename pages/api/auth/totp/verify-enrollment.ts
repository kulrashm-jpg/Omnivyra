import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/totp/verify-enrollment
 *
 * Body: { factorId: string, token: string }
 *
 * Step 2 of TOTP enrollment. Server verifies the token, activates the
 * factor, and immediately regenerates a fresh batch of recovery codes.
 * Returns the recovery codes ONCE — the only time they leave the server.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { verifyEnrollment } from '../../../../backend/security/totp/TotpEnrollmentService';
import { regenerate } from '../../../../backend/security/totp/RecoveryCodeService';

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
    return res.status(403).json({ error: 'Bridge principals cannot enroll factors', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const factorId = typeof body.factorId === 'string' ? body.factorId : null;
  const token    = typeof body.token    === 'string' ? body.token    : null;
  if (!factorId || !token) {
    return res.status(400).json({ error: 'factorId and token required' });
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  const verification = await verifyEnrollment({
    userId: p.userId,
    factorId,
    token,
    ip,
    userAgent: ua,
  });

  if (verification.ok !== true) {
    if (verification.reason === 'INVALID_TOKEN') {
      return res.status(401).json({ error: 'Invalid token', code: verification.reason });
    }
    if (verification.reason === 'FACTOR_NOT_FOUND' || verification.reason === 'FACTOR_REVOKED' || verification.reason === 'ALREADY_VERIFIED') {
      return res.status(409).json({ error: 'Factor not enrollable', code: verification.reason });
    }
    return res.status(500).json({ error: 'Verification failed', code: verification.reason });
  }

  // First-time enrollment — generate recovery codes ONCE.
  const recovery = await regenerate({ userId: p.userId, ip, userAgent: ua });

  return res.status(200).json({
    factor: {
      id:          verification.factor.id,
      verifiedAt:  verification.factor.verifiedAt?.toISOString() ?? null,
      label:       verification.factor.label,
    },
    recoveryCodes: recovery.codes,
    recoveryBatchId: recovery.batchId,
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
export default __createApiRoute(handler, { route: '/api/auth/totp/verify-enrollment' });
