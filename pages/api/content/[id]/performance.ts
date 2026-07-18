import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as performanceService from '@/backend/services/content/performanceService';

/**
 * Canonical content Performance endpoint (Writer Wave 5, item 2).
 *
 *   GET  /api/content/:id/performance
 *     → { signals: performanceService.getSignals(id, companyId),
 *         aggregate: performanceService.aggregateSignals(id) }
 *   POST /api/content/:id/performance  body { signals, platform?, source? }
 *     → performanceService.ingestSignals({ companyId, contentId, platform?, signals, source? })
 *     → 200 { performance }
 *
 * Company-scoped via enforceCompanyAccess, and additionally tenant-isolated by
 * loading the canonical content row with getContent(id, companyId) — this proves
 * the content belongs to the caller's company before any signal read / write
 * (enforceCompanyAccess only proves user↔company, not content↔company). Signals
 * are append-only and NEVER mutate the content. NEW route — additive,
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
      const signals = await performanceService.getSignals(id, scopedCompanyId);
      // aggregateSignals is fail-safe on absence; guard so an aggregate glitch
      // never blocks returning the raw signals.
      const aggregate = await performanceService.aggregateSignals(id).catch(() => null);
      return res.status(200).json({ signals, aggregate });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load performance signals');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const signals = (body.signals && typeof body.signals === 'object') ? body.signals as Record<string, unknown> : null;
    if (!signals) return res.status(400).json({ error: 'signals object required' });
    const platform = typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : undefined;
    const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : undefined;

    try {
      const performance = await performanceService.ingestSignals({
        companyId: scopedCompanyId,
        contentId: id,
        platform,
        signals: signals as never,
        source,
      });
      return res.status(200).json({ performance });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to ingest performance signals');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/performance' });
