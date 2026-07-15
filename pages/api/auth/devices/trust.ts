import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/devices/trust
 *
 * Body: { label?: string, ttlSeconds?: number }
 *
 * Register the current request's device as a trusted device for the
 * authenticated principal. Wave 2B-B requires an active step-up session
 * before allowing this — registering a trusted device is itself an
 * elevated action.
 *
 * Wave 2C will add capability gating (`mfa.enroll` + step-up policy).
 * For Wave 2B-B we enforce: principal must be authenticated, non-bridge,
 * with an active step-up session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { register } from '../../../../backend/security/devices/TrustedDeviceService';

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
    return res.status(403).json({ error: 'Bridge principals cannot trust devices', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }
  if (!p.stepUp.active) {
    return res.status(401).json({
      error: 'Step-up authentication required to trust this device',
      code: 'STEP_UP_REQUIRED',
    });
  }

  const body = parseBody(req);
  const label = typeof body.label === 'string' ? body.label.slice(0, 64) : null;
  const ttlSeconds = typeof body.ttlSeconds === 'number' && body.ttlSeconds > 0
    ? Math.min(body.ttlSeconds, 60 * 60 * 24 * 90)  // hard-cap at 90 days
    : undefined;

  const result = await register({
    userId:      p.userId,
    fingerprint: p.device.fingerprint,
    label,
    ttlSeconds,
    ip:          clientIp(req),
    userAgent:   userAgent(req),
  });

  if (result.ok !== true) {
    if (result.reason === 'ALREADY_TRUSTED') {
      return res.status(409).json({ error: 'Device already trusted', code: result.reason });
    }
    if (result.reason === 'FINGERPRINT_UNAVAILABLE') {
      return res.status(400).json({ error: 'Device fingerprint unavailable', code: result.reason });
    }
    return res.status(400).json({ error: 'Could not trust device', code: result.reason });
  }

  return res.status(201).json({
    device: {
      id:        result.device.id,
      label:     result.device.label,
      expiresAt: result.device.expiresAt.toISOString(),
    },
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
export default __createApiRoute(handler, { route: '/api/auth/devices/trust' });
