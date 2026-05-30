/**
 * POST /api/creator-intelligence/variant-execution-plan
 *
 * Variant Execution Planner endpoint. UI surfaces (Creator / Writer /
 * Campaign) post a `VariantExecutionRequest` and receive a
 * `VariantExecutionResult` — one `VariantSelectionDecision` per
 * asset the existing creator pipeline should generate.
 *
 * This endpoint does NOT generate assets. It produces the structured
 * plan that downstream callers feed into the canonical
 * `creatorAssetRenderer` pipeline (which honors every existing
 * governance / QA / moderation / approval gate — PHASE 15 contract).
 *
 * Phases addressed:
 *   - PHASE 2 — request-driven variant selection
 *   - PHASE 6 — winner-engine integration
 *   - PHASE 7 — top-3 generation
 *   - PHASE 8 — experiment-mode fan-out + tracker registration
 *   - PHASE 16 — operator-control resolution
 *
 * Request body:
 *   {
 *     company_id: string,
 *     campaign_id?: string,
 *     platform?: string,
 *     creator_id?: string,
 *     strategy_id: string,
 *     mode: 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment',
 *     variant_id?: string,
 *     variant_family?: 'v1' | 'v2' | 'v3',
 *     window?: '7d' | '30d' | '90d' | 'all_time',
 *     content_type?: 'image' | 'carousel' | 'infographic',
 *     correlation_id?: string,
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  isVariantExecutionMode,
  validateVariantExecutionRequest,
  type VariantExecutionRequest,
} from '../../../backend/services/creator/variantExecutionContract';
import { planVariantExecution } from '../../../backend/services/creator/variantExecutionPlanner';
import { getVariantOperatorControls } from '../../../backend/services/creator/variantOperatorControls';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String(body.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const user = await resolveUserContext(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const mode = body.mode;
  if (!isVariantExecutionMode(mode)) {
    return res.status(400).json({ success: false, error: 'invalid mode', code: 'INVALID_MODE' });
  }
  const request: VariantExecutionRequest = {
    companyId,
    campaignId: typeof body.campaign_id === 'string' ? body.campaign_id : null,
    platform: typeof body.platform === 'string' ? body.platform : null,
    creatorId: typeof body.creator_id === 'string' ? body.creator_id : null,
    strategyId: String(body.strategy_id || '').trim(),
    mode,
    variantId: typeof body.variant_id === 'string' ? body.variant_id : null,
    variantFamily: (body.variant_family === 'v1' || body.variant_family === 'v2' || body.variant_family === 'v3')
      ? body.variant_family
      : null,
    window: body.window === '7d' || body.window === '30d' || body.window === '90d' || body.window === 'all_time'
      ? body.window
      : undefined,
    contentType: body.content_type === 'image' || body.content_type === 'carousel' || body.content_type === 'infographic'
      ? body.content_type
      : undefined,
    correlationId: typeof body.correlation_id === 'string' ? body.correlation_id : null,
  };
  const invalid = validateVariantExecutionRequest(request);
  if (invalid) {
    return res.status(400).json({ success: false, error: invalid.message, code: invalid.code.toUpperCase() });
  }
  const plan = planVariantExecution(request);
  const controls = getVariantOperatorControls(companyId);

  return res.status(200).json({
    success: true,
    request: {
      strategy_id: request.strategyId,
      mode: request.mode,
      variant_id: request.variantId,
      variant_family: request.variantFamily,
      campaign_id: request.campaignId,
      platform: request.platform,
      creator_id: request.creatorId,
      window: request.window ?? '30d',
      content_type: request.contentType ?? null,
      correlation_id: request.correlationId,
    },
    plan,
    operator_controls: controls,
  });
}
