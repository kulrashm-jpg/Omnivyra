import type { NextApiRequest, NextApiResponse } from 'next';
import { getTemplateById } from '../../../lib/creator-templates';

/**
 * GET /api/creator-templates/:id
 *
 * Read-only single-template fetch (full definition incl. form + contract).
 * Additive — does not touch the generation pipeline.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const template = getTemplateById(id);
  // System templates are globally readable + immutable. User templates are
  // tenant-scoped and must NOT be served here (even if registry-resident in this
  // process) — they have their own authorized route (/user/:id).
  if (!template || template.ownership !== 'system') {
    return res.status(404).json({ error: `Template "${id}" not found` });
  }
  return res.status(200).json({ template });
}
