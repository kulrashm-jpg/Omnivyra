import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import {
  getAllModels,
  upsertModel,
} from '../../../../backend/services/llmProviderService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

/**
 * GET  /api/super-admin/llm/models  â†’ list all models (with provider info)
 * POST /api/super-admin/llm/models  â†’ create or update a model
 *
 * POST body:
 *   provider_id OR provider_name (one is required)
 *   model_key       (required)
 *   display_name    (required)
 *   is_active       (optional, default true)
 *   metadata        (optional jsonb)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'config:llm');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/llm/models', 'config:llm');
  }

  // â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    try {
      const models = await getAllModels();
      return res.status(200).json({ models });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  // â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { provider_id, provider_name, model_key, display_name, is_active, metadata } = body;

    if (!model_key || typeof model_key !== 'string' || !model_key.trim()) {
      return res.status(400).json({ error: 'model_key is required' });
    }
    if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
      return res.status(400).json({ error: 'display_name is required' });
    }
    if (!provider_id && !provider_name) {
      return res.status(400).json({ error: 'provider_id or provider_name is required' });
    }

    try {
      // Resolve provider_id from provider_name if only name was given
      let resolvedProviderId: string = provider_id;
      if (!resolvedProviderId && provider_name) {
        const { data: prov, error: provErr } = await supabase
          .from('llm_providers')
          .select('id')
          .eq('name', String(provider_name).trim().toLowerCase())
          .maybeSingle();
        if (provErr) return res.status(500).json({ error: provErr.message });
        if (!prov) return res.status(400).json({ error: `Provider "${provider_name}" not found` });
        resolvedProviderId = prov.id;
      }

      const model = await upsertModel({
        provider_id:  resolvedProviderId,
        model_key:    model_key.trim(),
        display_name: display_name.trim(),
        is_active:    typeof is_active === 'boolean' ? is_active : true,
        metadata:     metadata && typeof metadata === 'object' ? metadata : {},
      });
      return res.status(200).json({ success: true, model });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
