import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET / POST /api/creator-intelligence/variant-operator-controls
 *
 * Per-company variant execution feature controls (PHASE 16).
 *
 * GET  — fetch current controls.
 *        Query: ?company_id=...
 *
 * POST — set one or more controls (partial merge).
 *        Body: {
 *          company_id,
 *          experiment_mode_disabled?,
 *          variant_exploration_disabled?,
 *          force_baseline_v1?,
 *          force_winning_variant?,
 *        }
 *
 * Controls are in-memory and per-process. Persistence beyond a
 * process lifetime is intentionally deferred — this matches the
 * other in-memory runtime caches (recorder, tracker) and avoids a
 * schema migration. Operators set the controls again after a restart
 * via the same endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  defaultVariantOperatorControls,
  getVariantOperatorControls,
  setVariantOperatorControls,
} from '../../../backend/services/creator/variantOperatorControls';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });

  if (req.method === 'GET') {
    const companyId = String(req.query.company_id || '').trim();
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
    }
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    return res.status(200).json({
      success: true,
      controls: getVariantOperatorControls(companyId),
      defaults: defaultVariantOperatorControls(),
    });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const companyId = String(body.company_id || '').trim();
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
    }
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    const patch: Parameters<typeof setVariantOperatorControls>[1] = {};
    if (typeof body.experiment_mode_disabled === 'boolean') patch.experimentModeDisabled = body.experiment_mode_disabled;
    if (typeof body.variant_exploration_disabled === 'boolean') patch.variantExplorationDisabled = body.variant_exploration_disabled;
    if (typeof body.force_baseline_v1 === 'boolean') patch.forceBaselineV1 = body.force_baseline_v1;
    if (typeof body.force_winning_variant === 'boolean') patch.forceWinningVariant = body.force_winning_variant;
    const next = setVariantOperatorControls(companyId, patch);
    return res.status(200).json({ success: true, controls: next });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-intelligence/variant-operator-controls' });
