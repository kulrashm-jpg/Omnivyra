
/**
 * POST /api/onboarding/profile
 *
 * Protected endpoint. Saves user profile (name, phone) and advances
 * onboarding_state to 'profile_complete'.
 *
 * Body: { name: string, phone?: string }
 * Auth: Bearer <supabase_access_token>
 * Returns: { success: true, route: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

type SuccessResponse = { success: true; route: string };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Bearer token & resolve user ─────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) {
    const status = userErr === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: userErr ?? 'Invalid session', code: userErr ?? undefined });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { name, phone, jobTitle, industry } = body as {
    name?: string; phone?: string; jobTitle?: string; industry?: string;
  };

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  // ── 2. Update user profile in public.users ────────────────────────────────
  const updates: Record<string, unknown> = {
    name:             name.trim(),
    onboarding_state: 'profile_complete',
  };

  if (phone    !== undefined) updates.phone     = phone.trim()    || null;
  if (jobTitle !== undefined) updates.job_title = jobTitle.trim() || null;
  if (industry !== undefined) updates.industry  = industry.trim() || null;

  const { error: updateErr } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id);

  if (updateErr) {
    console.error('[onboarding/profile] update error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  // ── 3. Determine next route ───────────────────────────────────────────────
  // After profile completion, user needs to set up or join a company
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const route = roleRow ? '/dashboard' : '/onboarding/company';

  return res.status(200).json({ success: true, route });
}
