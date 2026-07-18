import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as publicationLineageService from '@/backend/services/content/publicationLineageService';

/**
 * Canonical content Publication Lineage endpoint (Writer Wave 5, item 7).
 *
 *   GET  /api/content/:id/lineage → publicationLineageService.getLineage(id, companyId)
 *                                    → 200 { lineage }
 *   POST /api/content/:id/lineage  body { eventType, platform?, parentContentId? }
 *     → publicationLineageService.recordEvent({ companyId, contentId, eventType, platform?, parentContentId? })
 *     → 200 { event }
 *
 * Company-scoped via enforceCompanyAccess, and tenant-isolated by loading the
 * canonical content row with getContent(id, companyId). Lineage is append-only
 * and NEVER mutates the content. NEW route — additive, backward-compatible.
 */

// Mirrors the CHECK constraint on publication_lineage.event_type
// (supabase/migrations/20260718000003_content_learning_performance.sql).
const LINEAGE_EVENT_TYPES = ['published', 'reposted', 'regenerated', 'revised', 'scheduled'] as const;

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
      const lineage = await publicationLineageService.getLineage(id, scopedCompanyId);
      return res.status(200).json({ lineage });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load publication lineage');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
    if (!eventType) return res.status(400).json({ error: 'eventType required' });
    if (!(LINEAGE_EVENT_TYPES as readonly string[]).includes(eventType)) {
      return res.status(400).json({ error: `Unsupported eventType "${eventType}"` });
    }
    const platform = typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : undefined;
    const parentContentId = typeof body.parentContentId === 'string' && body.parentContentId.trim()
      ? body.parentContentId.trim()
      : undefined;

    try {
      const event = await publicationLineageService.recordEvent({
        companyId: scopedCompanyId,
        contentId: id,
        eventType: eventType as never,
        platform,
        parentContentId,
      });
      return res.status(200).json({ event });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to record lineage event');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/lineage' });
