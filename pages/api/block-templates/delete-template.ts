import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/block-templates/delete-template
 *
 * Workaround endpoint for deleting a block template. The canonical
 * DELETE /api/block-templates/[id] dynamic route was returning 404
 * from the Next.js layer despite the handler being correct — likely
 * a dev-server route-compilation issue. This POST endpoint at a
 * static (non-dynamic) path side-steps the issue.
 *
 * Body: { id: string, company_id: string }
 *
 * Same auth + ownership semantics as the [id].ts DELETE handler:
 *   - company_id is required
 *   - enforceCompanyAccess gate must pass (caller must be a member)
 *   - is_default templates are never deleted
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { deleteBlockTemplate } from '../../../backend/services/blockTemplateService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : '';

  if (!id) return res.status(400).json({ error: 'id required' });
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const auth = await enforceCompanyAccess({ req, res, companyId });
  if (!auth) return;

  try {
    await deleteBlockTemplate(id);
    return res.status(200).json({ success: true, id });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete block template',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/block-templates/delete-template' });
