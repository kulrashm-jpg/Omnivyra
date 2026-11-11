import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * PATCH /api/credits/earn/setup-progress
 *
 * Marks a setup step as complete for the current user's org.
 * After each mark, checks if setup_complete (+100) or website_connected (+150)
 * thresholds are now met and grants credits accordingly.
 * If not yet complete, sends a nudge notification.
 *
 * Steps:
 *   profile_complete          — company profile filled (name, website, industry)
 *   external_api_connected    — at least one external API key saved
 *   social_accounts_connected — at least one social account linked
 *   website_blog_connected    — company blog URL connected
 *   lead_capture_connected    — lead capture page connected
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { logger } from '../../../../backend/services/logger';
import {
  checkAndGrantSetupCredits,
  notifyEarnProgress,
} from '../../../../backend/services/earnCreditsService';

const VALID_STEPS = [
  'profile_complete',
  'external_api_connected',
  'social_accounts_connected',
  'website_blog_connected',
  'lead_capture_connected',
] as const;

type SetupStep = typeof VALID_STEPS[number];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).end();

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
    logger.error('credits_earn_setup_membership_read_failed', { userId: user.id, message: roleErr.message });
    return res.status(503).json({ error: 'temporarily_unavailable', retryable: true });
  }

  if (!roleRow) return res.status(400).json({ error: 'No active company' });
  const orgId = (roleRow as any).company_id as string;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { step } = body as { step?: SetupStep };

  if (!step || !VALID_STEPS.includes(step)) {
    return res.status(400).json({ error: `step must be one of: ${VALID_STEPS.join(', ')}` });
  }

  // Upsert setup progress row
  // MONEY: the grant below reads this row. If the step was not recorded, stop
  // here - never answer success for progress that was not saved.
  const { error: upsertErr } = await supabase.from('company_setup_progress').upsert(
    { company_id: orgId, [step]: true, updated_at: new Date().toISOString() },
    { onConflict: 'company_id' },
  );
  if (upsertErr) {
    logger.error('credits_earn_setup_record_failed', { userId: user.id, orgId, step, message: upsertErr.message });
    return res.status(500).json({ error: 'setup_progress_not_saved' });
  }

  // Check thresholds and grant if met
  const { setup_credits, website_credits } = await checkAndGrantSetupCredits(orgId, user.id);

  // If no credits granted yet, check how many steps are left and nudge
  if (setup_credits === 0) {
    // best-effort: these reads only phrase a nudge notification; the grant has
    // already been decided. On a failed read no nudge is sent (never a wrong
    // count) and the failure is logged.
    const { data: setupRow, error: setupErr } = await supabase
      .from('company_setup_progress')
      .select('profile_complete, external_api_connected, social_accounts_connected, website_blog_connected, lead_capture_connected')
      .eq('company_id', orgId)
      .maybeSingle();

    const { count: socialCount, error: socialErr } = await supabase
      .from('social_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', orgId);
    const nudgeErr = setupErr ?? socialErr;
    if (nudgeErr) logger.error('credits_earn_setup_nudge_read_failed', { orgId, message: nudgeErr.message });

    const row = (setupRow as any) ?? {};
    const done = [
      row.profile_complete,
      row.external_api_connected,
      (socialCount ?? 0) > 0 || row.social_accounts_connected,
      row.website_blog_connected,
      row.lead_capture_connected,
    ].filter(Boolean).length;

    const remaining = 5 - done;
    if (!nudgeErr && remaining > 0) {
      await notifyEarnProgress({
        orgId,
        actionType: 'setup_complete',
        message:    `Complete ${remaining} more setup step${remaining === 1 ? '' : 's'} to earn +100 credits.`,
      });
    }
  }

  if (website_credits === 0 && (step === 'website_blog_connected' || step === 'lead_capture_connected')) {
    // best-effort: nudge only (see above); a failed read sends no nudge.
    const { data: setupRow, error: webErr } = await supabase
      .from('company_setup_progress')
      .select('website_blog_connected, lead_capture_connected')
      .eq('company_id', orgId)
      .maybeSingle();
    if (webErr) logger.error('credits_earn_setup_nudge_read_failed', { orgId, message: webErr.message });

    const row = (setupRow as any) ?? {};
    if (!webErr && (!row.website_blog_connected || !row.lead_capture_connected)) {
      const missing = !row.website_blog_connected ? 'company blog' : 'lead capture page';
      await notifyEarnProgress({
        orgId,
        actionType: 'website_connected',
        message:    `Connect your ${missing} to earn +150 credits.`,
      });
    }
  }

  return res.status(200).json({ success: true, setup_credits, website_credits });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/credits/earn/setup-progress' });
