import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/engagement/platform-health?organization_id=...
 *
 * Returns per-platform health snapshots for the caller's org. Only
 * platforms with at least one detected connection (API token, RPA
 * session, or recent extension success) are returned.
 *
 * Shape per platform:
 *   {
 *     platform,
 *     connected_via: ['api' | 'rpa' | 'extension' | 'publish_adapter'],
 *     egress: {
 *       reply|like|dm|post: {
 *         api|rpa|extension|publish_adapter: 'ok'|'no_session'|'unverified'|'unsupported'|'none'
 *       }
 *     },
 *     ingress: {
 *       polling|webhook|extension_events: 'active'|'none'
 *     },
 *     overall: 'green'|'orange'|'red',
 *     observed_at: ISO
 *   }
 *
 * Read-only. No mutation of tokens, sessions, or state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getPlatformHealth } from '../../../backend/services/platformHealth/platformHealthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const fromQuery = (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as
      | string
      | string[]
      | undefined;
    const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    const organizationId =
      (q ?? (user as { defaultCompanyId?: string })?.defaultCompanyId ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const platforms = await getPlatformHealth(organizationId);
    return res.status(200).json({
      success: true,
      organization_id: organizationId,
      platform_count: platforms.length,
      platforms,
    });
  } catch (err) {
    console.error('[engagement/platform-health]', err);
    return res
      .status(500)
      .json({ error: (err as Error)?.message || 'platform-health lookup failed' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

