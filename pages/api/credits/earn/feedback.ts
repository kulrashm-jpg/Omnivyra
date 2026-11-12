import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/credits/earn/feedback
 *
 * User submits feedback. Super admin reviews it.
 * On approval → +100 credits granted to the user's org.
 *
 * One pending submission allowed per user at a time.
 * Credits granted once per user lifetime (approved status).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { logger } from '../../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // MONEY: each read below gates a credit-bearing submission. A failed read is
  // "unknown", never "none" - 503, nothing inserted. (The approved/pending
  // checks used to fall through on an error and insert a second submission,
  // which a later approval would credit again.)
  const unavailable = (what: string, message: string) => {
    logger.error('credits_earn_feedback_read_failed', { userId: user.id, what, message });
    return res.status(503).json({ error: 'temporarily_unavailable', retryable: true });
  };

  const { data: roleRow, error: roleErr } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (roleErr) return unavailable('membership', roleErr.message);

  if (!roleRow) return res.status(400).json({ error: 'No active company' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { feedbackText, rating } = body as { feedbackText?: string; rating?: number };

  if (!feedbackText?.trim()) return res.status(400).json({ error: 'feedbackText required' });
  if (feedbackText.trim().length < 20) {
    return res.status(400).json({ error: 'Feedback must be at least 20 characters.' });
  }

  // Already approved (credits already given)
  const { data: approved, error: approvedErr } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (approvedErr) return unavailable('approved_check', approvedErr.message);

  if (approved) {
    return res.status(409).json({ error: 'Your feedback has already been accepted and credited.' });
  }

  // Pending already
  const { data: pending, error: pendingErr } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (pendingErr) return unavailable('pending_check', pendingErr.message);

  if (pending) {
    return res.status(409).json({ error: 'You already have feedback pending review. We\'ll notify you when it\'s reviewed.' });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('feedback_submissions')
    .insert({
      user_id:         user.id,
      organization_id: (roleRow as any).company_id,
      feedback_text:   feedbackText.trim(),
      rating:          rating ?? null,
    })
    .select('id')
    .single();

  if (insertErr) {
    // CLASS 2 (20270217000002): the partial UNIQUE index (one pending/approved
    // submission per user) is the authority; the two reads above are only the
    // early answer. A 23505 NAMING that index is the concurrent loser -> 409.
    // Keyed on the constraint NAME (05): any other UNIQUE added to this table
    // later must not inherit the "already pending or accepted" message.
    // CHOSEN trade-off: if the DB error text is ever sanitised, a real
    // duplicate answers 500 instead of 409 - safe direction, never a wrong reason.
    if ((insertErr as { code?: string }).code === '23505'
        && /feedback_submissions_one_open_per_user/.test(`${insertErr.message ?? ''} ${(insertErr as { details?: string }).details ?? ''}`)) {
      return res.status(409).json({ error: 'You already have feedback pending review or accepted.' });
    }
    logger.error('credits_earn_feedback_insert_failed', { userId: user.id, message: insertErr.message });
    return res.status(500).json({ error: 'feedback_not_saved' });
  }

  // Notify super admins of new feedback. Canonical authority is
  // user_company_roles.role='SUPER_ADMIN' — no longer read from users.role.
  // best-effort: the submission is saved and sits in the pending review queue
  // either way; a failed admin lookup or notification only delays the alert.
  // Both are logged.
  const { data: superAdminRoles, error: saErr } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('role', 'SUPER_ADMIN');
  if (saErr) logger.error('credits_earn_feedback_admin_lookup_failed', { feedbackId: (inserted as any).id, message: saErr.message });

  const superAdminIds = Array.from(
    new Set((superAdminRoles ?? []).map((r: any) => r.user_id).filter(Boolean))
  );

  if (superAdminIds.length > 0) {
    const { error: notifyErr } = await supabase.from('notifications').insert(
      superAdminIds.map((id: string) => ({
        user_id:  id,
        type:     'feedback_submitted',
        title:    'New feedback pending review',
        message:  `User submitted feedback: "${feedbackText.trim().slice(0, 80)}${feedbackText.length > 80 ? '…' : ''}"`,
        metadata: { feedback_id: (inserted as any).id, submitter_user_id: user.id },
        is_read:  false,
      })),
    );
    if (notifyErr) logger.error('credits_earn_feedback_notify_failed', { feedbackId: (inserted as any).id, message: notifyErr.message });
  }

  return res.status(200).json({ success: true, feedbackId: (inserted as any).id });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/credits/earn/feedback' });
