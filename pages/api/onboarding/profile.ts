import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

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
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getPostLoginRoute as getUserPreferenceRoute } from '../../../backend/services/userPreferencesService';

type SuccessResponse = { success: true; route: string };
type ErrorResponse   = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // â”€â”€ 1. Verify Bearer token & resolve user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ 2. Update user profile in public.users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ 3. Determine next route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // After profile completion, user needs to set up or join a company
  const { data: roleRow } = await supabase
    .from('user_company_' + 'roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const route = roleRow ? await getUserPreferenceRoute(user.id) : '/onboarding/company';

  return res.status(200).json({ success: true, route });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

