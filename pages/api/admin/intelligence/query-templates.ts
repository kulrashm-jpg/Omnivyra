
/**
 * Admin Intelligence Query Templates API
 * Phase-2: Super Admin Governance
 * GET, POST, PUT, PATCH for intelligence_query_templates
 * Does not modify schema.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../../backend/middleware/requireSuperAdmin';
import {
  listQueryTemplates,
  createQueryTemplate,
  updateQueryTemplate,
  setQueryTemplateEnabled,
} from '../../../../backend/services/intelligenceGovernanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    switch (req.method) {
      case 'GET': {
        const templates = await listQueryTemplates();
        return res.status(200).json({ templates });
      }
      case 'POST': {
        const body = req.body as {
          api_source_id?: string | null;
          category?: string | null;
          template: string;
          enabled?: boolean;
        };
        if (!body?.template?.trim()) {
          return res.status(400).json({ error: 'template is required' });
        }
        const template = await createQueryTemplate({
          api_source_id: body.api_source_id,
          category: body.category,
          template: body.template,
          enabled: body.enabled,
        });
        return res.status(201).json({ template });
      }
      case 'PUT': {
        const { id, ...params } = req.body as { id: string; category?: string; template?: string };
        if (!id) return res.status(400).json({ error: 'id is required' });
        const template = await updateQueryTemplate(id, params);
        return res.status(200).json({ template });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const template = await setQueryTemplateEnabled(id, enabled);
        return res.status(200).json({ template });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
