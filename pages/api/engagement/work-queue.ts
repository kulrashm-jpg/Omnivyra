
/**
 * GET /api/engagement/work-queue
 * Returns daily work queue: actionable threads per platform.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getDailyWorkQueue } from '../../../backend/services/engagementWorkQueueService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const rawOrg = req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId;
    const organizationId = (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const queue = await getDailyWorkQueue(organizationId);
    return res.status(200).json({
      total_actionable_threads: queue.total_actionable_threads,
      platforms: queue.platforms,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch work queue';
    console.error('[engagement/work-queue]', msg);
    return res.status(500).json({ error: msg });
  }
}
