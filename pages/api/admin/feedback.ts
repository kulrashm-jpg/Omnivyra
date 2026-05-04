
/**
 * GET   /api/admin/feedback          â€” list all feedback submissions (super admin)
 * PATCH /api/admin/feedback?id=<id>  â€” approve or reject a submission
 *
 * On approve â†’ grants +100 incentive credits to the submitter's org
 *            â†’ notifies org members
 * On reject  â†’ notifies submitter so they can re-submit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import { grantEarnCredit } from '../../../backend/services/earnCreditsService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'feedback:review');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/feedback', 'feedback:review');
  }
  const adminId = ctx.id;

  // â”€â”€ GET â€” list all submissions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ PATCH â€” approve or reject â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        message:  'Thank you for your feedback. It didn\'t qualify for credits this time â€” feel free to submit again.',
        metadata: { feedback_id: id },
        is_read:  false,
      });
    }

    return res.status(200).json({ success: true, action, creditsGranted });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).end();
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
