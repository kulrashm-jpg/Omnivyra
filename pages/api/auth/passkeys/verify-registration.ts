/**
 * POST /api/auth/passkeys/verify-registration
 *
 * Body: { response: RegistrationResponseJSON, label?: string }
 *
 * Step 2 of passkey enrollment. Server verifies the attestation via
 * @simplewebauthn/server, atomically consumes the challenge, persists the
 * credential, and emits the audit event.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { verifyRegistration } from '../../../../backend/security/webauthn/WebAuthnRegistrationService';

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
    return res.status(403).json({ error: 'Bridge principals cannot enroll passkeys', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const body = parseBody(req);
  const response = body?.response as RegistrationResponseJSON | undefined;
  if (!response) {
    return res.status(400).json({ error: 'Missing response body' });
  }
  const label = typeof body?.label === 'string' ? body.label : null;

  const verification = await verifyRegistration({
    userId:    p.userId,
    response,
    label,
    ip:        clientIp(req),
    userAgent: userAgent(req),
  });

  if (verification.ok !== true) {
    if (verification.reason === 'CHALLENGE_REJECTED') {
      return res.status(400).json({ error: 'Invalid or expired challenge', code: verification.reason, detail: verification.detail });
    }
    if (verification.reason === 'DUPLICATE_CREDENTIAL') {
      return res.status(409).json({ error: 'Credential already registered', code: verification.reason });
    }
    return res.status(400).json({ error: 'Verification failed', code: verification.reason, detail: verification.detail });
  }

  return res.status(201).json({
    credential: {
      id:           verification.result.credential.id,
      credentialId: verification.result.credential.credentialId,
      label:        verification.result.credential.label,
      deviceType:   verification.result.credential.deviceType,
      isBackedUp:   verification.result.credential.isBackedUp,
      transports:   verification.result.credential.transports,
      createdAt:    verification.result.credential.createdAt.toISOString(),
    },
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
