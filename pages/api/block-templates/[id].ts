import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getBlockTemplate,
  updateBlockTemplate,
  deleteBlockTemplate,
} from '../../../backend/services/blockTemplateService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: 'id required' });

  // For GET we still need auth context; take company_id from query
  const companyId = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const auth = await enforceCompanyAccess({ req, res, companyId });
  if (!auth) return;

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const template = await getBlockTemplate(id);
      if (!template) return res.status(404).json({ error: 'Template not found' });
      return res.status(200).json({ template });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT ────────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { name, description, content_blocks, tags, is_public } = req.body;
    try {
      const template = await updateBlockTemplate(id, {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(content_blocks !== undefined && { content_blocks }),
        ...(tags !== undefined && { tags }),
        ...(is_public !== undefined && { is_public }),
      });
      return res.status(200).json({ template });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      await deleteBlockTemplate(id);
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/block-templates/:id' });
