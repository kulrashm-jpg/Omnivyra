import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/bolt-failures/:failureId/rows
 *
 * Returns row-level failure diagnostics for the run that owns this
 * failure summary record. Supports pagination, filtering, sorting,
 * and free-text search of the failure message.
 *
 * Migration safety: when bolt_row_failure_diagnostics doesn't exist
 * (e.g. the migration hasn't been applied), the endpoint returns
 *   200 { migration_required: true, items: [], total: 0 }
 * so the UI can render a graceful "migration required" notice rather
 * than the operator seeing a 500.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../../shared/contracts/security';
import {
  listRowFailuresForFailure,
  type RowFailureFilters,
} from '../../../../../backend/services/boltRowFailureDashboard';

function strOrUndef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function numOrUndef(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const ALLOWED_SORTS = new Set(['occurred_at', 'failure_code', 'platform', 'content_type', 'week_number']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'bolt_failure_row_diagnostics',
  });
  if (!auth.ok) return;

  const failureId = typeof req.query.failureId === 'string' ? req.query.failureId.trim() : '';
  if (!failureId) return res.status(400).json({ error: 'failureId is required' });

  try {
    const sortRaw = strOrUndef(req.query.sort);
    const filters: RowFailureFilters = {
      failureCode: strOrUndef(req.query.failure_code),
      platform: strOrUndef(req.query.platform),
      contentType: strOrUndef(req.query.content_type),
      search: strOrUndef(req.query.search),
      limit: numOrUndef(req.query.limit),
      offset: numOrUndef(req.query.offset),
      sort: sortRaw && ALLOWED_SORTS.has(sortRaw) ? (sortRaw as RowFailureFilters['sort']) : undefined,
      order: req.query.order === 'asc' ? 'asc' : 'desc',
    };
    const result = await listRowFailuresForFailure(failureId, filters);
    if ('migration_required' in result) {
      return res.status(200).json({
        migration_required: true,
        items: [],
        total: 0,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
        has_more: false,
        notice: 'bolt_row_failure_diagnostics migration has not been applied. Run the 20260816 migration to enable per-row diagnostics.',
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[super-admin/bolt-failures/rows]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/bolt-failures/:failureId/rows' });
