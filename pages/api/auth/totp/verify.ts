/**
 * POST /api/auth/totp/verify
 *
 * Body: { token: string }
 *
 * Verify a TOTP code for the authenticated principal. Used by step-up
 * flows (`/api/auth/step-up/verify` with factor='totp') and by future
 * feature gates that require fresh TOTP. Does NOT mint a step-up
 * session — the caller does that via step-up/verify.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { verifyTotp } from '../../../../backend/security/totp/TotpVerificationService';

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
    return res.status(403).json({ error: 'Bridge principals cannot use TOTP', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const token = typeof body.token === 'string' ? body.token : null;
  if (!token) {
    return res.status(400).json({ error: 'token required' });
  }

  const result = await verifyTotp({
    userId: p.userId,
    token,
    ip:     clientIp(req),
    userAgent: userAgent(req),
  });

  if (result.ok !== true) {
    return res.status(401).json({ error: 'TOTP verification failed', code: result.reason });
  }

  return res.status(200).json({
    verified: true,
    factorId: result.factorId,
    verifiedAt: result.verifiedAt.toISOString(),
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
