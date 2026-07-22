import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as predictionEngine from '@/backend/services/content/predictionEngine';
import * as qualityService from '@/backend/services/content/qualityService';

/**
 * Canonical content Prediction endpoint (Writer Wave 5, item 6).
 *
 *   GET  /api/content/:id/prediction → predictionEngine.getLatestPrediction(id, companyId)
 *                                       → 200 { prediction } | 404 (none yet)
 *   POST /api/content/:id/prediction  body optional { platform? }
 *     → predictionEngine.predict({ companyId, contentId, text, platform?, objective?, scorecard?, learningMemory? })
 *       then predictionEngine.persistPrediction({ companyId, contentId, platform?, prediction })
 *     → 200 { prediction }
 *
 * text/objective are pulled from the canonical content row; the scorecard is
 * loaded best-effort (predict is fail-safe on its absence). Company-scoped via
 * enforceCompanyAccess, and tenant-isolated by loading the canonical content row
 * with getContent(id, companyId). Predictions are explainable + reproducible and
 * NEVER mutate the content. NEW route — additive, backward-compatible.
 *
 * Concurrent-contract note: this route calls predictionEngine.getLatestPrediction
 * and predictionEngine.persistPrediction per the documented Wave-5 signatures.
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
      const prediction = await predictionEngine.getLatestPrediction(id, scopedCompanyId);
      if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
      return res.status(200).json({ prediction });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load prediction');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const overridePlatform = typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : undefined;
    const briefPlatform = content.brief && typeof (content.brief as Record<string, unknown>).platform === 'string'
      ? String((content.brief as Record<string, unknown>).platform)
      : undefined;
    const platform = overridePlatform ?? briefPlatform;

    try {
      // Best-effort enrichment — predict is fail-safe when these are absent.
      const scorecard = await qualityService.getScorecard(id, scopedCompanyId).catch(() => null);
      // WAVE5-TODO: enrich with learning_memory once a company-memory getter
      // lands in the Wave-5 learning surface (predict.learningMemory is optional).

      const prediction = await predictionEngine.predict({
        companyId: scopedCompanyId,
        contentId: id,
        text: content.body ?? '',
        platform,
        objective: content.objective ?? undefined,
        scorecard: (scorecard ?? undefined) as never,
      });

      await predictionEngine.persistPrediction({
        companyId: scopedCompanyId,
        contentId: id,
        platform,
        prediction,
      });

      return res.status(200).json({ prediction });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to generate prediction');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/prediction' });
