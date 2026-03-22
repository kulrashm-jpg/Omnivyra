/**
 * POST /api/super-admin/plans/toggle
 *
 * Activate or deactivate a pricing plan.
 * Deactivating a plan does NOT remove existing org assignments —
 * it prevents new assignments only.
 *
 * Body: { plan_key: string, is_active: boolean }
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { plan_key, is_active } = body as { plan_key: string; is_active: boolean };

  if (!plan_key) return res.status(400).json({ error: 'plan_key is required' });
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be a boolean' });

  try {
    const { data: plan, error: fetchErr } = await supabase
      .from('pricing_plans')
      .select('id, name')
      .eq('plan_key', plan_key)
      .maybeSingle();

    if (fetchErr || !plan) return res.status(404).json({ error: 'Plan not found' });

    const { error: updateErr } = await supabase
      .from('pricing_plans')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true, plan_key, is_active });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
