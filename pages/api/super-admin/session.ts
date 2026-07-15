import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/session
 *
 * Returns whether the caller is recognized as a super-admin operator,
 * honoring BOTH canonical session and (for compatibility) the legacy
 * cookie super-admin bridge.
 *
 * Phase 1 — super-admin canonicalization:
 *   - Resolves via canonical IdentityResolver
 *   - Bridge principal still answers `isSuperAdmin: true` so the
 *     /super-admin/free-credits dashboard auth check continues working
 *     until Wave 3B migrates the page to /api/auth/capabilities
 *   - Canonical principal answers `isSuperAdmin` based on
 *     SUPER_ADMIN_DASHBOARD_VIEW capability
 *
 * Response: { isSuperAdmin: boolean, via: 'canonical' | 'bridge' | null }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { hasCapability } from '../../../backend/security/AuthorizationService';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const result = await resolvePrincipal(req);
  if (result.ok !== true) {
    return res.status(200).json({ isSuperAdmin: false, via: null });
  }

  const p = result.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(200).json({ isSuperAdmin: true, via: 'bridge' });
  }

  const allowed = hasCapability(p, SUPER_ADMIN_DASHBOARD_VIEW);
  return res.status(200).json({ isSuperAdmin: allowed, via: allowed ? 'canonical' : null });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/session' });
