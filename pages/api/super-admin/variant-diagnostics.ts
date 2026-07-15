import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/variant-diagnostics
 *
 * Admin-only operational diagnostics surface (Phases 2-6 of the
 * production hardening pass). Aggregates read-only state from the
 * in-memory trackers + recorders into a single payload for
 * troubleshooting.
 *
 * Query params:
 *   ?company_id=…             — required scope
 *   ?window=7d|30d|90d|all_time (defaults to 30d)
 *   ?scheduled_post_id=…       — optional; when set, attaches an
 *                                attribution trace for that post
 *   ?include=health,orphans,diagnostics,trace  — comma-separated
 *                                section filter (default: all)
 *
 * NO mutation. NO writes. NO new processing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';
import {
  getAnalyticsHealth,
  getExperimentHealth,
  getOrphanReport,
  getVariantDiagnostics,
  traceAssetAttribution,
} from '../../../backend/services/creator/variantOperationalDiagnostics';
import { listExperiments } from '../../../backend/services/creator/variantExperimentTracker';

type Window = '7d' | '30d' | '90d' | 'all_time';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      code: 'VARIANT_DIAGNOSTICS_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }
  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({
      status: 'error',
      code: 'COMPANY_ID_REQUIRED',
      message: 'company_id is required',
    });
  }
  const windowRaw = String(req.query.window || '30d');
  const window: Window = (windowRaw === '7d' || windowRaw === '90d' || windowRaw === 'all_time')
    ? windowRaw
    : '30d';
  const scheduledPostId = req.query.scheduled_post_id ? String(req.query.scheduled_post_id) : null;
  const includeRaw = String(req.query.include || 'diagnostics,health,orphans,experiments,trace');
  const include = new Set(includeRaw.split(',').map((s) => s.trim()).filter(Boolean));

  const payload: Record<string, unknown> = {
    scope: { companyId, window, scheduledPostId },
  };

  try {
    if (include.has('diagnostics')) {
      payload.diagnostics = getVariantDiagnostics({ companyId, window });
    }
    if (include.has('health')) {
      payload.analytics_health = getAnalyticsHealth({ companyId });
    }
    if (include.has('experiments')) {
      payload.experiment_health = getExperimentHealth({ companyId });
      payload.active_experiments = listExperiments({ companyId, state: 'active' });
    }
    if (include.has('orphans')) {
      payload.orphans = getOrphanReport({ companyId });
    }
    if (include.has('trace') && scheduledPostId) {
      payload.attribution_trace = await traceAssetAttribution({ scheduledPostId });
    }
    return res.status(200).json({ status: 'ok', ...payload });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      code: 'VARIANT_DIAGNOSTICS_LOAD_FAILED',
      message: err?.message || 'Failed to load variant diagnostics',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/variant-diagnostics' });
