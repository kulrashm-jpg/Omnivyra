import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/auth/capabilities
 *
 * Returns the authoritative capability list for the current principal.
 * The frontend uses this list to decide UI affordances (e.g., whether to
 * render a "Delete organization" button) — but every action still runs
 * its own server-side capability check. This endpoint is hint-only.
 *
 * Auth: Bearer / cookie (same as /api/auth/session).
 *
 * Response shape:
 *   {
 *     capabilities: Capability[],            // hierarchy-expanded
 *     byOrganization: Record<orgId, Capability[]>,
 *     legacyCookieSuperAdmin: boolean
 *   }
 *
 * Frontends MUST refetch on org switch.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { resolveUserCapabilities } from '../../../backend/security/CapabilityService';
import { legacyCookieSuperAdminCapabilities } from '../../../backend/security/capabilityRegistry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const result = await resolvePrincipal(req);
  if (result.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: result.reason });
  }

  const p = result.principal;

  // Bridge principals don't have a real DB user; serve the static bridge set.
  if (p.legacyCookieSuperAdmin) {
    return res.status(200).json({
      capabilities: legacyCookieSuperAdminCapabilities(),
      byOrganization: {},
      legacyCookieSuperAdmin: true,
    });
  }

  const caps = await resolveUserCapabilities(p.userId);
  const byOrganization: Record<string, ReadonlyArray<string>> = {};
  for (const [orgId, list] of caps.byOrganization.entries()) {
    byOrganization[orgId] = list;
  }

  return res.status(200).json({
    capabilities: caps.aggregate,
    byOrganization,
    legacyCookieSuperAdmin: false,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/capabilities' });
