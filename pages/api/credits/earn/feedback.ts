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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!roleRow) return res.status(400).json({ error: 'No active company' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { feedbackText, rating } = body as { feedbackText?: string; rating?: number };

  if (!feedbackText?.trim()) return res.status(400).json({ error: 'feedbackText required' });
  if (feedbackText.trim().length < 20) {
    return res.status(400).json({ error: 'Feedback must be at least 20 characters.' });
  }

  // Already approved (credits already given)
  const { data: approved } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'approved')
    .maybeSingle();

  if (approved) {
    return res.status(409).json({ error: 'Your feedback has already been accepted and credited.' });
  }

  // Pending already
  const { data: pending } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();

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

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // Notify super admins of new feedback
  const { data: superAdmins } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'SUPER_ADMIN');

  if (superAdmins?.length) {
    await supabase.from('notifications').insert(
      superAdmins.map((sa: any) => ({
        user_id:  sa.id,
        type:     'feedback_submitted',
        title:    'New feedback pending review',
        message:  `User submitted feedback: "${feedbackText.trim().slice(0, 80)}${feedbackText.length > 80 ? '…' : ''}"`,
        metadata: { feedback_id: (inserted as any).id, submitter_user_id: user.id },
        is_read:  false,
      })),
    );
  }

  return res.status(200).json({ success: true, feedbackId: (inserted as any).id });
}
