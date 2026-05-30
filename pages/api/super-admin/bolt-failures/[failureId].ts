/**
 * GET /api/super-admin/bolt-failures/:failureId
 *
 * Returns full failure detail — raw_error_message, stack_excerpt,
 * strategy_snapshot, plus the run's complete catch-site timeline
 * (every row in bolt_failure_summary for the same run_id).
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { getFailureDetail } from '../../../../backend/services/boltFailureDashboard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'bolt_failure_detail',
  });
  if (!auth.ok) return;

  const failureId = typeof req.query.failureId === 'string' ? req.query.failureId.trim() : '';
  if (!failureId) return res.status(400).json({ error: 'failureId is required' });

  try {
    const detail = await getFailureDetail(failureId);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(detail);
  } catch (err) {
    console.error('[super-admin/bolt-failures/detail]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
