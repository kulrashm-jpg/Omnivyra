/**
 * POST /api/super-admin/users/reset-mfa
 *
 * Operator-driven MFA factor reset for a target user. Closes the
 * permanent TOTP-only lockout chain (TOTP user with no recovery codes
 * + no WebAuthn). Operator authentication uses THEIR own factors via
 * the platform-tier capability + step-up policy; the target user has
 * no path to reset their own MFA (intentional: a self-serve
 * "reset MFA via email" creates an email-takeover MFA bypass).
 *
 * Body: {
 *   userId:                 string,
 *   reason:                 string,
 *   alsoRevokeRecoveryCodes?: boolean,  // default true
 *   alsoRevokeSessions?:    boolean,    // default true
 * }
 *
 * Auth: MFA_REVOKE (platform-tier capability — same gate that protects
 * the user-facing factor revoke; step-up policy is phishing-resistant,
 * 10-minute window).
 *
 * Idempotent: re-clicking on a user with no remaining factors returns
 * `idempotent: true`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { MFA_REVOKE } from '../../../../shared/contracts/security';
import { adminResetMfa } from '../../../../backend/security/MfaResetService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const userId               = typeof body.userId === 'string' ? body.userId : null;
  const reason               = typeof body.reason === 'string' ? body.reason : null;
  const alsoRevokeRecoveryCodes = body.alsoRevokeRecoveryCodes !== false; // default true
  const alsoRevokeSessions      = body.alsoRevokeSessions      !== false; // default true

  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!reason || reason.trim().length < 4) {
    return res.status(400).json({ error: 'reason is required (min 4 chars) — recorded to audit' });
  }

  const guard = await requireCapability(req, res, {
    capability: MFA_REVOKE,
    reason:     `super-admin resets MFA for user ${userId}`,
    resourceId: userId,
  });
  if (guard.ok !== true) return;

  const result = await adminResetMfa({
    userId,
    performedBy: guard.principal.userId,
    reason,
    alsoRevokeRecoveryCodes,
    alsoRevokeSessions,
  });

  return res.status(200).json({
    ok:                    true,
    totpRevoked:           result.totpRevoked,
    webauthnRevoked:       result.webauthnRevoked,
    recoveryCodesRevoked:  result.recoveryCodesRevoked,
    sessionsRevoked:       result.sessionsRevoked,
    stepupSessionsRevoked: result.stepupSessionsRevoked,
    idempotent:            result.idempotent,
  });
}
