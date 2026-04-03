
/**
 * Admin Intelligence Categories API
 * Phase-2: Super Admin Governance
 * GET, POST, PUT, PATCH for intelligence_categories
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../../backend/middleware/requireSuperAdmin';
import {
  getCategories,
  createCategory,
  updateCategory,
  setCategoryEnabled,
} from '../../../../backend/services/intelligenceGovernanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    switch (req.method) {
      case 'GET': {
        const enabledOnly = req.query.enabled === 'true';
        const categories = await getCategories(enabledOnly);
        return res.status(200).json({ categories });
      }
      case 'POST': {
        const body = req.body as { name: string; description?: string; enabled?: boolean };
        if (!body?.name?.trim()) {
          return res.status(400).json({ error: 'name is required' });
        }
        const category = await createCategory({
          name: body.name,
          description: body.description,
          enabled: body.enabled,
        });
        return res.status(201).json({ category });
      }
      case 'PUT': {
        const { id, ...params } = req.body as { id: string; name?: string; description?: string };
        if (!id) return res.status(400).json({ error: 'id is required' });
        const category = await updateCategory(id, params);
        return res.status(200).json({ category });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const category = await setCategoryEnabled(id, enabled);
        return res.status(200).json({ category });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
