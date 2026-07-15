import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/totp/recovery
 *
 * Body: { code: string, regenerate?: boolean }
 *
 * Verify and consume a one-shot recovery code for the authenticated
 * principal. On success, the matched code is permanently consumed.
 * Optional `regenerate=true` re-issues a fresh batch (and revokes any
 * remaining unused codes) — typically the user does this immediately
 * after consuming one to keep their pool full.
 *
 * The endpoint does NOT mint a step-up session — `/api/auth/step-up/verify`
 * with factor='recovery_code' is the orchestration layer that consumes
 * a code and mints elevation in one transaction.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { regenerate, verifyAndConsume } from '../../../../backend/security/totp/RecoveryCodeService';

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
    return res.status(403).json({ error: 'Bridge principals cannot use recovery codes', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const code = typeof body.code === 'string' ? body.code : null;
  if (!code) {
    return res.status(400).json({ error: 'code required' });
  }
  const shouldRegenerate = body.regenerate === true;

  const ip = clientIp(req);
  const ua = userAgent(req);

  const result = await verifyAndConsume({ userId: p.userId, code, ip, userAgent: ua });
  if (result.ok !== true) {
    return res.status(401).json({ error: 'Recovery code rejected', code: result.reason });
  }

  let regen: { batchId: string; codes: ReadonlyArray<string> } | null = null;
  if (shouldRegenerate) {
    regen = await regenerate({ userId: p.userId, ip, userAgent: ua });
  }

  return res.status(200).json({
    consumed: true,
    consumedAt: result.consumedAt.toISOString(),
    regenerated: regen
      ? { batchId: regen.batchId, codes: regen.codes }
      : null,
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
export default __createApiRoute(handler, { route: '/api/auth/totp/recovery' });
