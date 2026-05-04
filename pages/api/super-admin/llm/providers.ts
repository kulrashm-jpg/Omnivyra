import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import {
  getAllProviders,
  upsertProvider,
} from '../../../../backend/services/llmProviderService';

/**
 * GET  /api/super-admin/llm/providers  â†’ list all providers
 * POST /api/super-admin/llm/providers  â†’ create or update a provider
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'config:llm');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/llm/providers', 'config:llm');
  }

  // â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    try {
      const providers = await getAllProviders();
      return res.status(200).json({ providers });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  // â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { name, display_name, is_active } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
      return res.status(400).json({ error: 'display_name is required' });
    }

    try {
      const provider = await upsertProvider({
        name:         name.trim().toLowerCase(),
        display_name: display_name.trim(),
        is_active:    typeof is_active === 'boolean' ? is_active : true,
      });
      return res.status(200).json({ success: true, provider });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
