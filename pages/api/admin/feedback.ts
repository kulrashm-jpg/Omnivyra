
/**
 * GET   /api/admin/feedback          — list all feedback submissions (super admin)
 * PATCH /api/admin/feedback?id=<id>  — approve or reject a submission
 *
 * On approve → grants +100 incentive credits to the submitter's org
 *            → notifies org members
 * On reject  → notifies submitter so they can re-submit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { grantEarnCredit } from '../../../backend/services/earnCreditsService';

async function requireSuperAdmin(req: NextApiRequest): Promise<string | null> {
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return null;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  return (data as any)?.role === 'SUPER_ADMIN' ? user.id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const adminId = await requireSuperAdmin(req);
  if (!adminId) return res.status(403).json({ error: 'Super admin only' });

  // ── GET — list all submissions ────────────────────────────────────────────
  if (req.method === 'GET') {
    const status = (req.query.status as string) ?? 'pending';

    const query = supabase
      .from('feedback_submissions')
      .select(`
        id, user_id, organization_id, feedback_text, rating,
        status, credits_granted, submitted_at, reviewed_at,
        users:user_id ( name, email )
      `)
      .order('submitted_at', { ascending: false });

    if (status !== 'all') query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ feedback: data ?? [] });
  }

  // ── PATCH — approve or reject ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id query param required' });

    const body   = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const action = (body as any).action as 'approve' | 'reject';

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const { data: fb } = await supabase
      .from('feedback_submissions')
      .select('id, user_id, organization_id, status, feedback_text')
      .eq('id', id)
      .maybeSingle();

    if (!fb) return res.status(404).json({ error: 'Feedback not found' });
    if ((fb as any).status !== 'pending') {
      return res.status(409).json({ error: `Already ${(fb as any).status}` });
    }

    const now = new Date().toISOString();

    await supabase.from('feedback_submissions').update({
      status:      action === 'approve' ? 'approved' : 'rejected',
      reviewed_at: now,
      reviewed_by: adminId,
      ...(action === 'approve' ? { credits_granted: true } : {}),
    }).eq('id', id);

    let creditsGranted = 0;

    if (action === 'approve') {
      const result = await grantEarnCredit({
        orgId:       (fb as any).organization_id,
        userId:      (fb as any).user_id,
        actionType:  'feedback_approved',
        referenceId: id,
      });
      creditsGranted = result.credits;
    } else {
      // Notify submitter that feedback wasn't accepted so they can try again
      await supabase.from('notifications').insert({
        user_id:  (fb as any).user_id,
        type:     'feedback_rejected',
        title:    'Feedback not accepted this time',
        message:  'Thank you for your feedback. It didn\'t qualify for credits this time — feel free to submit again.',
        metadata: { feedback_id: id },
        is_read:  false,
      });
    }

    return res.status(200).json({ success: true, action, creditsGranted });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).end();
}
