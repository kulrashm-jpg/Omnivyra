import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/totp/begin-enrollment
 *
 * Body: { factorLabel?: string }
 *
 * Step 1 of TOTP enrollment. Server provisions a base32 secret, stores
 * it in Vault, returns the otpauth URI + secret ONCE for QR / paste.
 * Activation requires a successful verify-enrollment call with the first
 * generated code.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { beginEnrollment } from '../../../../backend/security/totp/TotpEnrollmentService';

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
  const factorLabel = typeof body.factorLabel === 'string' ? body.factorLabel.slice(0, 64) : null;

  const result = await beginEnrollment({
    userId:       p.userId,
    accountLabel: p.email,
    factorLabel,
    ip:           clientIp(req),
    userAgent:    userAgent(req),
  });

  if (result.ok !== true) {
    if (result.reason === 'ALREADY_ENROLLED') {
      return res.status(409).json({ error: 'TOTP already enrolled — revoke first', code: result.reason });
    }
    return res.status(500).json({ error: 'Could not start TOTP enrollment' });
  }

  return res.status(200).json({
    factorId:      result.bundle.factorId,
    otpauthUri:    result.bundle.otpauthUri,
    secret:        result.bundle.secret,
    algorithm:     result.bundle.algorithm,
    digits:        result.bundle.digits,
    periodSeconds: result.bundle.periodSeconds,
  });
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') as Record<string, unknown>; } catch { return {}; }
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
export default __createApiRoute(handler, { route: '/api/auth/totp/begin-enrollment' });
