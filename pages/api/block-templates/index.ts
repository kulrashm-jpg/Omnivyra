import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listBlockTemplates,
  createBlockTemplate,
  deleteBlockTemplate,
} from '../../../backend/services/blockTemplateService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const auth = await enforceCompanyAccess({ req, res, companyId });
  if (!auth) return;

  // ── GET: list templates ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const templates = await listBlockTemplates(companyId, {
        content_type: req.query.content_type as string | undefined,
        format_type: req.query.format_type as string | undefined,
      });
      return res.status(200).json({ templates });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: create template ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, description, content_type, format_type, content_blocks, tags, is_public } = req.body;
    if (!name || !content_blocks || !Array.isArray(content_blocks)) {
      return res.status(400).json({ error: 'name and content_blocks (array) required' });
    }
    try {
      const template = await createBlockTemplate(auth.userId, companyId, {
        name,
        description,
        content_type: content_type || 'blog',
        format_type,
        content_blocks,
        tags,
        is_public,
      });
      return res.status(201).json({ template });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: remove a template (id in query OR body) ───────────────────────
  // Lives on the static /api/block-templates path because the dynamic
  // [id] route was returning HTML 404 in this dev environment despite a
  // correct handler. This branch is reached through the already-compiled
  // index file, sidestepping that issue.
  if (req.method === 'DELETE') {
    const id = (typeof req.query.id === 'string' ? req.query.id
      : typeof req.body?.id === 'string' ? req.body.id
      : '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await deleteBlockTemplate(id);
      return res.status(200).json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/block-templates' });
