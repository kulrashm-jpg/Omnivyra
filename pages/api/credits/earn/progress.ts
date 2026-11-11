import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/credits/earn/progress
 *
 * Returns the full earn-more credits progress for the current user's org:
 *   - Which actions are completed and when
 *   - Total earned and total still available
 *   - Setup checklist state (sub-steps for setup_complete + website_connected)
 *   - Pending feedback submission (if any)
 *   - Referral stats
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { logger } from '../../../../backend/services/logger';
import { getEarnProgress } from '../../../../backend/services/earnCreditsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // MONEY: a failed membership read is "unknown", not "no active company".
  const { data: roleRow, error: roleErr } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (roleErr) {
    logger.error('credits_earn_progress_membership_read_failed', { userId: user.id, message: roleErr.message });
    return res.status(503).json({ error: 'temporarily_unavailable', retryable: true });
  }

  if (!roleRow) return res.status(400).json({ error: 'No active company' });
  const orgId = (roleRow as any).company_id as string;

  // ── Parallel fetch ────────────────────────────────────────────────────────
  const [earnProgress, setupRes, socialCountRes, feedbackRes, referralRows] =
    await Promise.all([
      getEarnProgress(orgId),

      supabase
        .from('company_setup_progress')
        .select('profile_complete, external_api_connected, social_accounts_connected, website_blog_connected, lead_capture_connected')
        .eq('company_id', orgId)
        .maybeSingle(),

      supabase
        .from('social_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', orgId),

      supabase
        .from('feedback_submissions')
        .select('id, status, submitted_at')
        .eq('user_id', user.id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('referrals')
        .select('id, invited_email, status, completed_at')
        .eq('referrer_user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

  // A failed read would render every step "not done" and hide a pending
  // feedback/referral the user is owed credits for - 503 instead.
  const readErr = setupRes.error ?? socialCountRes.error ?? feedbackRes.error ?? referralRows.error;
  if (readErr) {
    logger.error('credits_earn_progress_read_failed', { userId: user.id, orgId, message: readErr.message });
    return res.status(503).json({ error: 'temporarily_unavailable', retryable: true });
  }
  const setupRow = setupRes.data;
  const feedbackRow = feedbackRes.data;
  const row = (setupRow as any) ?? {};
  const socialConnected = (socialCountRes.count ?? 0) > 0 || !!row.social_accounts_connected;

  const setup = {
    profile_complete:          !!row.profile_complete,
    external_api_connected:    !!row.external_api_connected,
    social_accounts_connected: socialConnected,
    website_blog_connected:    !!row.website_blog_connected,
    lead_capture_connected:    !!row.lead_capture_connected,
  };

  const setupDone  = Object.values(setup).filter(Boolean).length;
  const setupTotal = Object.keys(setup).length;

  return res.status(200).json({
    ...earnProgress,
    setup,
    setup_done:  setupDone,
    setup_total: setupTotal,
    feedback:    feedbackRow ?? null,
    referrals: {
      pending:   ((referralRows.data ?? []) as any[]).filter(r => r.status === 'pending').length,
      completed: ((referralRows.data ?? []) as any[]).filter(r => r.status === 'completed').length,
      list:      referralRows.data ?? [],
    },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/credits/earn/progress' });
