
/**
 * POST /api/super-admin/credit-cost-config/update
 *
 * Update the credit cost for one or more actions.
 * Changes take effect immediately — no caching between DB and the
 * getCreditCost() function in creditDeductionService.
 *
 * Body: { updates: Array<{ action_type: string; credits: number; description?: string; smart_dedup_seconds?: number }> }
 *
 * GET /api/super-admin/credit-cost-config/update
 * Returns all current action costs from DB.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import { isContentArchitectSession } from '../../../../backend/services/contentArchitectService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1' || isContentArchitectSession(req)) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

type UpdateEntry = {
  action_type: string;
  credits: number;
  description?: string;
  smart_dedup_seconds?: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  // ── GET: return all current costs ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('credit_cost_config')
      .select('action_type, credits, category, description, smart_dedup_seconds, updated_at')
      .order('category')
      .order('action_type');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ costs: data });
  }

  // ── POST: update one or more action costs ──────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const updates: UpdateEntry[] = Array.isArray(body.updates) ? body.updates : [body];

    if (!updates.length) return res.status(400).json({ error: 'updates array is required' });

    const results: { action_type: string; ok: boolean; error?: string }[] = [];
    const now = new Date().toISOString();

    for (const entry of updates) {
      const { action_type, credits, description, smart_dedup_seconds } = entry;

      if (!action_type) { results.push({ action_type: '?', ok: false, error: 'action_type required' }); continue; }
      if (credits == null || credits < 0) { results.push({ action_type, ok: false, error: 'credits must be >= 0' }); continue; }

      const patch: Record<string, any> = { credits, updated_at: now };
      if (description      !== undefined) patch.description        = description;
      if (smart_dedup_seconds !== undefined) patch.smart_dedup_seconds = smart_dedup_seconds;

      const { error } = await supabase
        .from('credit_cost_config')
        .update(patch)
        .eq('action_type', action_type);

      results.push({ action_type, ok: !error, error: error?.message });
    }

    const failures = results.filter(r => !r.ok);
    if (failures.length > 0 && failures.length === results.length) {
      return res.status(500).json({ error: 'All updates failed', results });
    }

    return res.status(200).json({ success: true, results });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
