/**
 * POST /api/auth/passkeys/verify-authentication
 *
 * Body: { response: AuthenticationResponseJSON }
 *
 * Step 2 of passkey verification. Server verifies the assertion via
 * @simplewebauthn/server, atomically consumes the challenge, advances the
 * monotonic counter, and emits the audit event.
 *
 * Wave 2B-A scope is verification only. Session projection (issuing an
 * auth_session for login or a stepup_session for step-up) is owned by
 * the caller — Wave 2B-B will add the step-up consumer; Wave 2B-C the
 * login consumer. Until then, this route returns the verified userId so
 * downstream callers can branch.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { verifyAuthentication } from '../../../../backend/security/webauthn/WebAuthnAuthenticationService';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const response = body?.response as AuthenticationResponseJSON | undefined;
  if (!response) {
    return res.status(400).json({ error: 'Missing response body' });
  }

  // Bind to the authenticated principal when one exists (step-up scope).
  let scopedUserId: string | null = null;
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok === true && !principalResult.principal.legacyCookieSuperAdmin) {
    scopedUserId = principalResult.principal.userId;
  }

  const verification = await verifyAuthentication({
    userId:    scopedUserId,
    response,
    ip:        clientIp(req),
    userAgent: userAgent(req),
  });

  if (verification.ok !== true) {
    if (verification.reason === 'CHALLENGE_REJECTED') {
      return res.status(400).json({ error: 'Invalid or expired challenge', code: verification.reason, detail: verification.detail });
    }
    if (verification.reason === 'CREDENTIAL_NOT_FOUND' || verification.reason === 'CREDENTIAL_REVOKED' || verification.reason === 'OWNERSHIP_MISMATCH') {
      return res.status(401).json({ error: 'Credential not usable', code: verification.reason });
    }
    if (verification.reason === 'COUNTER_REPLAY') {
      return res.status(401).json({ error: 'Replay detected', code: verification.reason });
    }
    return res.status(401).json({ error: 'Verification failed', code: verification.reason, detail: verification.detail });
  }

  // Wave 2B-A: do NOT mint sessions. Return the verified identity envelope
  // so the caller (Wave 2B-B step-up flow / Wave 2B-C login flow) can
  // project as appropriate.
  return res.status(200).json({
    verified:     true,
    userId:       verification.result.userId,
    credentialId: verification.result.credentialId,
    verifiedAt:   verification.result.verifiedAt.toISOString(),
    deviceType:   verification.result.deviceType,
    isBackedUp:   verification.result.isBackedUp,
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
