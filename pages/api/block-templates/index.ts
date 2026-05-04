import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listBlockTemplates,
  createBlockTemplate,
} from '../../../backend/services/blockTemplateService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const auth = await enforceCompanyAccess({ req, res, companyId });
  if (!auth) return;

  // â”€â”€ GET: list templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ POST: create template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

