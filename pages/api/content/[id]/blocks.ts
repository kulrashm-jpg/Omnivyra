import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as collaborationService from '@/backend/services/content/collaborationService';
import type { ContentBlock } from '@/lib/content/quality/types';

/**
 * Canonical content section-Blocks endpoint (Writer Wave 4).
 *
 *   GET  /api/content/:id/blocks  → collaborationService.listBlocks(id) → 200 { blocks }
 *   POST /api/content/:id/blocks
 *     - { action: 'lock', blockId, locked }  → collaborationService.setBlockLocked(id, blockId, locked)
 *     - { blocks: ContentBlock[] } (default)  → collaborationService.upsertBlocks(id, blocks)
 *     → 200 { blocks }
 *
 * Company-scoped via enforceCompanyAccess, and tenant-isolated by loading the
 * canonical content row with getContent(id, companyId) before any block read /
 * write. NEW route — additive, backward-compatible.
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
      const blocks = await collaborationService.listBlocks(id, scopedCompanyId);
      return res.status(200).json({ blocks });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load blocks');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';

    try {
      if (action === 'lock') {
        const blockId = typeof body.blockId === 'string' ? body.blockId.trim() : '';
        if (!blockId) return res.status(400).json({ error: 'blockId required' });
        const locked = body.locked !== false; // default true; explicit false unlocks
        const result = await collaborationService.setBlockLocked(blockId, scopedCompanyId, locked);
        return res.status(200).json({ block: result });
      }

      const blocks = Array.isArray(body.blocks) ? body.blocks as never : null;
      if (!blocks) return res.status(400).json({ error: 'blocks array required' });
      const saved = await collaborationService.upsertBlocks(scopedCompanyId, id, blocks);
      return res.status(200).json({ blocks: saved });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to update blocks');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/blocks' });
