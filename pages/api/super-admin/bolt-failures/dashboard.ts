/**
 * GET /api/super-admin/bolt-failures/dashboard
 *
 * Returns aggregated rollups for the BOLT failure dashboard:
 *   - by_stage
 *   - by_provider
 *   - by_campaign_type
 *   - by_normalized_type
 *   - top_raw_messages
 *   - unknown_count
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { getFailureDashboardSnapshot } from '../../../../backend/services/boltFailureDashboard';

function strOrUndef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'bolt_failure_dashboard',
  });
  if (!auth.ok) return;

  try {
    const snapshot = await getFailureDashboardSnapshot({
      since: strOrUndef(req.query.since),
      until: strOrUndef(req.query.until),
      companyId: strOrUndef(req.query.company_id),
      pipelineMode: strOrUndef(req.query.pipeline_mode),
      topN: req.query.top_n ? Number(req.query.top_n) : undefined,
    });
    return res.status(200).json(snapshot);
  } catch (err) {
    console.error('[super-admin/bolt-failures/dashboard]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
