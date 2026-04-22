/**
 * GET /api/automation/logs?organization_id=...&limit=50
 *
 * Returns the most recent automation decisions (allowed + blocked)
 * for the caller's organization. Used by the admin UI to surface the
 * audit trail — every allow/block carries its reason.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { readRecentAutomationLogs } from '../../../backend/services/automation/automationLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await resolveUserContext(req);
    const fromQuery = (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | string[] | undefined;
    const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    const organizationId = (q ?? (user as { defaultCompanyId?: string })?.defaultCompanyId ?? '').toString().trim();
    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const limitRaw = (req.query.limit ?? '50').toString();
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50));

    const rows = await readRecentAutomationLogs({ organization_id: organizationId, limit });
    return res.status(200).json({ success: true, count: rows.length, logs: rows });
  } catch (err) {
    console.error('[automation/logs]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'failed to read automation logs' });
  }
}
