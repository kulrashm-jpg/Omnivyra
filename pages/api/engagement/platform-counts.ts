/**
 * GET /api/engagement/platform-counts
 * Returns per-platform thread counts, unread counts, max priority tier.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getPlatformCounts } from '../../../backend/services/engagementInboxService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const counts = await getPlatformCounts(organizationId);
    return res.status(200).json({ counts });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch platform counts';
    console.error('[engagement/platform-counts]', msg);
    return res.status(500).json({ error: msg });
  }
}
