import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as qualityEngine from '@/backend/services/content/qualityEngine';
import * as qualityService from '@/backend/services/content/qualityService';
import type { QualityScorecard } from '@/lib/content/quality/types';

/**
 * Canonical content Quality endpoint (Writer Wave 4).
 *
 *   GET  /api/content/:id/quality  → qualityService.getScorecard(id, companyId)
 *                                     → 200 { scorecard } | 404 (no scorecard yet)
 *   POST /api/content/:id/quality  body optional { text?, platform? }
 *     → qualityEngine.evaluate(...) → qualityService.persistScorecard(...)
 *     → 200 { scorecard }
 *
 * Company-scoped via enforceCompanyAccess, and additionally tenant-isolated by
 * loading the canonical content row with getContent(id, companyId) — this proves
 * the content actually belongs to the caller's company before any quality read /
 * write (enforceCompanyAccess only proves user↔company, not content↔company).
 * NEW route — additive, backward-compatible.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  if (req.method === 'GET') {
    try {
      const scorecard = await qualityService.getScorecard(id, scopedCompanyId);
      if (!scorecard) return res.status(404).json({ error: 'Scorecard not found' });
      return res.status(200).json({ scorecard });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load scorecard');
    }
  }

  if (req.method === 'POST') {
    try {
      // Tenant isolation: the content must belong to the caller's company.
      const content = await getContent(id, scopedCompanyId);
      if (!content) return res.status(404).json({ error: 'Content not found' });

      const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      const overrideText = typeof body.text === 'string' ? body.text : undefined;
      const overridePlatform = typeof body.platform === 'string' ? body.platform.trim() : undefined;
      const briefPlatform = content.brief && typeof (content.brief as Record<string, unknown>).platform === 'string'
        ? String((content.brief as Record<string, unknown>).platform)
        : undefined;

      const text = (overrideText ?? content.body ?? '') as string;

      const scorecard: QualityScorecard = await qualityEngine.evaluate({
        companyId: scopedCompanyId,
        contentType: content.contentType,
        platform: overridePlatform ?? briefPlatform,
        text,
        objective: content.objective ?? undefined,
        audience: content.audience ?? undefined,
      });
      // evaluatedAt is caller-supplied (determinism contract in quality/types.ts).
      if (!scorecard.evaluatedAt) scorecard.evaluatedAt = new Date().toISOString();

      await qualityService.persistScorecard({ companyId: scopedCompanyId, contentId: id, scorecard });
      return res.status(200).json({ scorecard });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to evaluate content quality');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/quality' });
