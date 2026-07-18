import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as collaborationService from '@/backend/services/content/collaborationService';
import * as qualityService from '@/backend/services/content/qualityService';
import * as recommendationRuntime from '@/backend/services/content/recommendationRuntime';

/**
 * Canonical content Recommendations endpoint (Writer Wave 4).
 *
 *   GET  /api/content/:id/recommendations → collaborationService.listRecommendations(id)
 *                                            → 200 { recommendations }
 *   POST /api/content/:id/recommendations  body { action, recommendationId? }
 *     - 'generate'        → recommendationRuntime.generateRecommendations(input)
 *     - 'accept'          → collaborationService.acceptRecommendation(id, recommendationId)
 *     - 'reject'          → collaborationService.rejectRecommendation(id, recommendationId)
 *     - 'acceptAll'       → collaborationService.acceptAll(id)
 *     - 'restoreOriginal' → collaborationService.restoreOriginal(id)   (additive)
 *
 * Company-scoped via enforceCompanyAccess, and tenant-isolated by loading the
 * canonical content row with getContent(id, companyId). NEW route — additive,
 * backward-compatible.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  // Tenant isolation: prove the content belongs to the caller's company.
  const content = await getContent(id, scopedCompanyId);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  if (req.method === 'GET') {
    try {
      const recommendations = await collaborationService.listRecommendations(id, scopedCompanyId);
      return res.status(200).json({ recommendations });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load recommendations');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const action = typeof body.action === 'string' ? body.action.trim() : 'generate';
    const recommendationId = typeof body.recommendationId === 'string' ? body.recommendationId.trim() : '';

    try {
      switch (action) {
        case 'generate': {
          // Enrich the runtime input with the persisted scorecard + blocks when
          // available (best-effort — the runtime is fail-safe on their absence).
          const scorecard = await qualityService.getScorecard(id, scopedCompanyId).catch(() => null);
          const blocks = await collaborationService.listBlocks(id, scopedCompanyId).catch(() => []);
          const recommendations = await recommendationRuntime.generateRecommendations({
            companyId: scopedCompanyId,
            contentId: id,
            content: content.body ?? '',
            // scorecard/blocks are cast at the seam — the persisted rows are
            // structurally compatible with the runtime's contract mirror.
            // WAVE4-TODO: unify on lib/content/quality/types.ts.
            scorecard: (scorecard ?? undefined) as never,
            blocks: blocks as never,
          });
          return res.status(200).json({ recommendations });
        }
        case 'accept': {
          if (!recommendationId) return res.status(400).json({ error: 'recommendationId required' });
          const result = await collaborationService.acceptRecommendation(recommendationId, scopedCompanyId);
          return res.status(200).json({ recommendation: result });
        }
        case 'reject': {
          if (!recommendationId) return res.status(400).json({ error: 'recommendationId required' });
          const result = await collaborationService.rejectRecommendation(recommendationId, scopedCompanyId);
          return res.status(200).json({ recommendation: result });
        }
        case 'acceptAll': {
          const result = await collaborationService.acceptAll(id, scopedCompanyId);
          return res.status(200).json({ recommendations: result });
        }
        case 'restoreOriginal': {
          const result = await collaborationService.restoreOriginal(id, scopedCompanyId);
          return res.status(200).json({ content: result });
        }
        default:
          return res.status(400).json({ error: `Unsupported action "${action}"` });
      }
    } catch (error) {
      return respondServiceError(res, error, 'Failed to process recommendation action');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/recommendations' });
