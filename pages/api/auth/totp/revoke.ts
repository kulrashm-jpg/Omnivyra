/**
 * POST /api/auth/totp/revoke
 *
 * Body: { factorId?: string, reason?: string }
 *
 * Revoke the principal's TOTP factor. If `factorId` is omitted the
 * active factor is targeted (Wave 2A migration enforces single active
 * factor per user). Wave 2C will gate this on the `mfa.revoke`
 * capability AND require step-up; for Wave 2B-B we accept any
 * authenticated non-bridge principal so the management UI can land.
 *
 * Soft-deletes the factor row. Vault secret is left intact (deferred
 * to a Wave 2C cleanup job) — the row's revoked_at flag prevents reuse.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import {
  findActiveForUser,
  findByIdForUser,
  revokeFactor,
} from '../../../../backend/security/totp/TotpFactorRepository';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';

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
    return res.status(403).json({ error: 'Bridge principals have no TOTP factor', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const factorId = typeof body.factorId === 'string' ? body.factorId : null;
  const reason   = typeof body.reason   === 'string' ? body.reason.slice(0, 240) : 'user_initiated';

  const target = factorId
    ? await findByIdForUser(factorId, p.userId)
    : await findActiveForUser(p.userId);

  if (!target) return res.status(404).json({ error: 'No TOTP factor to revoke' });
  if (target.revokedAt) return res.status(409).json({ error: 'Already revoked' });

  const ok = await revokeFactor(target.id, p.userId, reason);
  if (!ok) return res.status(409).json({ error: 'Could not revoke (race or already revoked)' });

  await logSecurityEvent({
    capability: 'mfa.revoke',
    decision: 'totp_revoked',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    resourceId: target.id,
    reason,
    ip: clientIp(req),
    userAgent: userAgent(req),
  });

  return res.status(200).json({ revoked: true, factorId: target.id });
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
