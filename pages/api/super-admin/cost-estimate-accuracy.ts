/**
 * GET /api/super-admin/cost-estimate-accuracy
 *
 * Cost Estimate Accuracy — Phase 6 diagnostic surface.
 *
 * Read-only operator view of estimate-vs-actual variance per
 * (content_type × variant_mode) bucket. Includes:
 *
 *   - per-bucket sample count, mean / median / abs mean variance
 *   - per-bucket total estimated vs actual USD
 *   - the cost profiles the estimator is currently using
 *   - the most-recent observations (bounded)
 *
 * Used by operators to decide whether to tune the cost-profile env
 * overrides documented in costProfiles.ts. NO automatic billing
 * adjustment. NO mutation. NO charging.
 *
 * Query:
 *   ?company_id=…           — optional, scopes summary to one org
 *   ?content_type=…         — optional bucket filter
 *   ?variant_mode=…         — optional bucket filter
 *   ?limit=…                — recent observation count (default 50)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';
import {
  getCostAccuracySummary,
  listRecentObservations,
  costObservationStoreStats,
} from '../../../backend/services/creator/costObservationStore';
import { listCostProfiles } from '../../../backend/services/creator/costProfiles';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      code: 'COST_ESTIMATE_ACCURACY_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }
  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const companyIdRaw = String(req.query.company_id || '').trim();
  const companyId = companyIdRaw.length > 0 ? companyIdRaw : undefined;
  const contentType = typeof req.query.content_type === 'string' && req.query.content_type
    ? String(req.query.content_type)
    : undefined;
  const variantMode = typeof req.query.variant_mode === 'string' && req.query.variant_mode
    ? String(req.query.variant_mode) as
        'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment' | 'no_variant'
    : undefined;
  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 50;

  try {
    const summary = getCostAccuracySummary({ companyId, contentType, variantMode });
    const recent = listRecentObservations({ companyId, limit });
    const profiles = listCostProfiles();
    const stats = costObservationStoreStats();
    return res.status(200).json({
      status: 'ok',
      scope: { companyId: companyId ?? null, contentType: contentType ?? null, variantMode: variantMode ?? null },
      profiles,
      summary,
      recent,
      stats,
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      code: 'COST_ESTIMATE_ACCURACY_LOAD_FAILED',
      message: err?.message || 'Failed to load cost estimate accuracy',
    });
  }
}
