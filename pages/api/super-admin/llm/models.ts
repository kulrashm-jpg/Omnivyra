import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import {
  getAllModels,
  upsertModel,
} from '../../../../backend/services/llmProviderService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

/**
 * GET  /api/super-admin/llm/models  → list all models (with provider info)
 * POST /api/super-admin/llm/models  → create or update a model
 *
 * POST body:
 *   provider_id OR provider_name (one is required)
 *   model_key       (required)
 *   display_name    (required)
 *   is_active       (optional, default true)
 *   metadata        (optional jsonb)
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const models = await getAllModels();
      return res.status(200).json({ models });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/llm/models' });
