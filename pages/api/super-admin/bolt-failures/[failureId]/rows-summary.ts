import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/bolt-failures/:failureId/rows-summary
 *
 * Aggregated rollups for the row-level diagnostics linked to this
 * failure's run: rows failed, codes, platforms, content types, weeks,
 * stages. Backs the row-failures tab on the failure drawer.
 *
 * Migration safety: returns `{ migration_required: true, rows_failed: 0, ... }`
 * when bolt_row_failure_diagnostics doesn't exist.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../../shared/contracts/security';
import { getRowFailureSummary } from '../../../../../backend/services/boltRowFailureDashboard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'bolt_failure_row_summary',
  });
  if (!auth.ok) return;

  const failureId = typeof req.query.failureId === 'string' ? req.query.failureId.trim() : '';
  if (!failureId) return res.status(400).json({ error: 'failureId is required' });

  try {
    const summary = await getRowFailureSummary(failureId);
    if ('migration_required' in summary) {
      return res.status(200).json({
        migration_required: true,
        rows_failed: 0,
        by_code: [],
        by_platform: [],
        by_content_type: [],
        by_week: [],
        by_stage: [],
        notice: 'bolt_row_failure_diagnostics migration has not been applied. Run the 20260816 migration to enable per-row diagnostics.',
      });
    }
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[super-admin/bolt-failures/rows-summary]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/bolt-failures/:failureId/rows-summary' });
