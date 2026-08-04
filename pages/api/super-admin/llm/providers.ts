import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import {
  getAllProviders,
  upsertProvider,
} from '../../../../backend/services/llmProviderService';
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
 * GET  /api/super-admin/llm/providers  → list all providers
 * POST /api/super-admin/llm/providers  → create or update a provider
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const providers = await getAllProviders();
      return res.status(200).json({ providers });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/llm/providers' });
