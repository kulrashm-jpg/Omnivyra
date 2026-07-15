import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/passkeys/begin-registration
 *
 * Step 1 of passkey enrollment. Returns the
 * PublicKeyCredentialCreationOptionsJSON the browser passes to
 * navigator.credentials.create(). Server persists the challenge as a
 * one-shot row in webauthn_challenges.
 *
 * Auth: principal must be authenticated (any role); UI surface is "MFA
 * settings". Wave 2C will gate this on `mfa.enroll` capability via the
 * AuthorizationService.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { beginRegistration } from '../../../../backend/security/webauthn/WebAuthnRegistrationService';

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
    return res.status(403).json({ error: 'Bridge principals cannot enroll passkeys', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  try {
    const result = await beginRegistration({
      userId:          p.userId,
      userName:        p.email,
      userDisplayName: p.email,
      ip:              clientIp(req),
      userAgent:       userAgent(req),
    });
    return res.status(200).json(result.options);
  } catch (err) {
    return res.status(500).json({
      error: 'Could not start passkey registration',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
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
export default __createApiRoute(handler, { route: '/api/auth/passkeys/begin-registration' });
