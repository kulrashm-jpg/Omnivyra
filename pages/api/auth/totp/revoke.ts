import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/totp/revoke
 *
 * Body: { factorId?: string, reason?: string }
 *
 * Revoke the principal's TOTP factor. If `factorId` is omitted the
 * active factor is targeted (Wave 2A migration enforces single active
 * factor per user).
 *
 * Wave 2C-B: gated on `mfa.revoke` capability + phishing-resistant
 * step-up (registered policy: 10-min window, factor=webauthn). Note
 * that revoking TOTP requires a passkey factor — TOTP cannot revoke
 * itself.
 *
 * Soft-deletes the factor row. Vault secret is left intact (deferred
 * to a Wave 2C cleanup job) — the row's revoked_at flag prevents reuse.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  findActiveForUser,
  findByIdForUser,
  revokeFactor,
} from '../../../../backend/security/totp/TotpFactorRepository';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { MFA_REVOKE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: MFA_REVOKE,
    reason: 'user revokes their TOTP factor',
  });
  if (guard.ok !== true) return;
  const p = guard.principal;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/totp/revoke' });
