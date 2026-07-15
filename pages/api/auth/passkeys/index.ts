import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/auth/passkeys
 *
 * Returns the authenticated principal's active (non-revoked) passkey
 * credentials. Used by MFA settings UI in Wave 2C.
 *
 * Wave 2C will gate this on `mfa.view_factors` capability.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { listForUser } from '../../../../backend/security/webauthn/WebAuthnCredentialRepository';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(403).json({ error: 'Bridge principals have no passkeys', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const credentials = await listForUser(p.userId);
  return res.status(200).json({
    credentials: credentials.map((c) => ({
      id:           c.id,
      label:        c.label,
      deviceType:   c.deviceType,
      isBackedUp:   c.isBackedUp,
      transports:   c.transports,
      createdAt:    c.createdAt.toISOString(),
      lastUsedAt:   c.lastUsedAt?.toISOString() ?? null,
    })),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/passkeys' });
