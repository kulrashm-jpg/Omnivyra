/**
 * POST /api/auth/passkeys/revoke
 *
 * Body: { id: string, reason?: string }
 *
 * Revoke a passkey owned by the authenticated principal.
 *
 * Wave 2C-B: gated on `mfa.revoke` capability + phishing-resistant
 * step-up (registered policy: 10-min window, factor=webauthn). Bridge
 * principals are rejected.
 *
 * Soft-deletes the credential (revoked_at + revocation_reason) so audit
 * history is preserved. Cannot be re-registered until a new ceremony.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { findById, revokeCredential } from '../../../../backend/security/webauthn/WebAuthnCredentialRepository';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { MFA_REVOKE } from '../../../../shared/contracts/security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: MFA_REVOKE,
    reason: 'user revokes a passkey credential',
  });
  if (guard.ok !== true) return;
  const p = guard.principal;

  const body = parseBody(req);
  const id = typeof body?.id === 'string' ? body.id : null;
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 240) : 'user_initiated';
  if (!id) {
    return res.status(400).json({ error: 'Missing credential id' });
  }

  // Ownership pre-check so we surface 404 vs 403 clearly.
  const existing = await findById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Credential not found' });
  }
  if (existing.userId !== p.userId) {
    return res.status(403).json({ error: 'Not your credential' });
  }
  if (existing.revokedAt) {
    return res.status(409).json({ error: 'Already revoked' });
  }

  const ok = await revokeCredential(id, p.userId, reason);
  if (!ok) {
    // Race or concurrent revoke — re-fetch to confirm state.
    return res.status(409).json({ error: 'Credential could not be revoked' });
  }

  await logSecurityEvent({
    capability: 'mfa.revoke',
    decision: 'passkey_revoked',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    resourceId: id,
    reason,
    ip: clientIp(req),
    userAgent: userAgent(req),
  });

  return res.status(200).json({ revoked: true });
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
