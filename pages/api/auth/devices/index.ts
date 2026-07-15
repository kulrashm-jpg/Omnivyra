import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/auth/devices
 *
 * Lists the principal's active trusted devices.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { list } from '../../../../backend/security/devices/TrustedDeviceService';

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
    return res.status(403).json({ error: 'Bridge principals have no trusted devices', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const devices = await list(p.userId);
  return res.status(200).json({
    devices: devices.map((d) => ({
      id:           d.id,
      label:        d.label,
      firstSeenAt:  d.firstSeenAt.toISOString(),
      lastSeenAt:   d.lastSeenAt.toISOString(),
      expiresAt:    d.expiresAt.toISOString(),
      isCurrent:    d.fingerprint === p.device.fingerprint,
    })),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/devices' });
