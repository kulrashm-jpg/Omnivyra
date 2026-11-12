import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

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
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

async function requireSuperAdmin(req: NextApiRequest): Promise<string | null> {
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return null;
  return (await isPlatformSuperAdmin(user.id)) ? user.id : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const { data: fb, error: fbErr } = await supabase
      .from('feedback_submissions')
      .select('id, user_id, organization_id, status, feedback_text, credits_granted')
      .eq('id', id)
      .maybeSingle();

    // A failed read is not "not found". (2026-11-12)
    if (fbErr) return res.status(503).json({ error: 'Could not read the feedback', retryable: true });
    if (!fb) return res.status(404).json({ error: 'Feedback not found' });
    // RETRYABLE (05, 2026-11-12): 'pending', or - for an APPROVE only -
    // 'approved' with credits_granted = false: a crash between a failed grant
    // and its revert (or a failed revert / flag write) must not strand a row
    // that no admin can ever retry. grantEarnCredit is idempotent per feedback
    // id, so re-approving an actually-credited row just sets the flag.
    // (credits_granted is boolean NOT NULL DEFAULT false - no IS NULL case.)
    const stuckApproved = (fb as any).status === 'approved' && (fb as any).credits_granted === false;
    if ((fb as any).status !== 'pending' && !(action === 'approve' && stuckApproved)) {
      return res.status(409).json({ error: `Already ${(fb as any).status}` });
    }

    const now = new Date().toISOString();

    // CLASS 2 (2026-11-12): the decision is a CAS on 'pending' with a row count.
    // Unconditioned, a concurrent approve and reject both passed the read and
    // the LAST write won (an approved-and-credited submission could end up
    // 'rejected'); the update's error was never read either. credits_granted is
    // set only once the credit is actually granted.
    const { data: decided, error: decideErr } = await supabase.from('feedback_submissions').update({
      status:      action === 'approve' ? 'approved' : 'rejected',
      reviewed_at: now,
      reviewed_by: adminId,
    }).eq('id', id)
      .or(action === 'approve'
        ? 'status.eq.pending,and(status.eq.approved,credits_granted.eq.false)'
        : 'status.eq.pending')
      .select('id');
    if (decideErr) return res.status(500).json({ error: 'Could not record the decision' });
    if (!Array.isArray(decided) || decided.length !== 1) {
      return res.status(409).json({ error: 'This feedback was already reviewed by someone else', code: 'ALREADY_REVIEWED' });
    }

    let creditsGranted = 0;

    if (action === 'approve') {
      const result = await grantEarnCredit({
        orgId:       (fb as any).organization_id,
        userId:      (fb as any).user_id,
        actionType:  'feedback_approved',
        referenceId: id,
      });
      if (!result.granted && result.reason !== 'already_granted') {
        // The credit did not move: put the review back to pending (CAS on what
        // THIS request wrote) so an admin can retry - never "approved" with
        // nothing credited. grantEarnCredit is idempotent per feedback id.
        const { data: reverted, error: revertErr } = await supabase.from('feedback_submissions')
          .update({ status: 'pending', reviewed_at: null, reviewed_by: null })
          .eq('id', id).eq('status', 'approved').eq('reviewed_at', now).eq('credits_granted', false)
          .select('id');
        if (revertErr || !Array.isArray(reverted) || reverted.length !== 1) {
          // Say what is TRUE: the item still reads approved-but-uncredited. It
          // is retryable (the approve predicate above accepts that state).
          console.error('[admin/feedback] approval revert failed after a failed grant - approved without credit (retry approve to complete):', id, revertErr?.message ?? 'no row matched');
          return res.status(500).json({ error: 'Credit grant failed and the item still shows approved without credit; approve it again to complete', code: 'CREDIT_GRANT_FAILED_APPROVED_UNCREDITED', retryable: true });
        }
        return res.status(500).json({ error: 'Credit grant failed; the feedback is back in the review queue', code: 'CREDIT_GRANT_FAILED', retryable: true });
      }
      // already_granted: credited by an EARLIER approval - say so instead of
      // reporting "approved, 0 credits" for a credited submission.
      const alreadyCredited = result.reason === 'already_granted';
      creditsGranted = result.credits;
      const { error: flagErr } = await supabase.from('feedback_submissions').update({ credits_granted: true }).eq('id', id);
      // A lost flag write leaves approved-but-uncredited, which the widened
      // approve predicate heals on the next review (the grant is idempotent).
      if (flagErr) console.error('[admin/feedback] credits_granted flag write failed (credit IS granted):', id, flagErr.message);
      if (alreadyCredited) return res.status(200).json({ success: true, action, creditsGranted: 0, alreadyCredited: true });
    } else {
      // Notify submitter that feedback wasn't accepted so they can try again
      // best-effort: the rejection is recorded; a failed notice is logged.
      const { error: notifyErr } = await supabase.from('notifications').insert({
        user_id:  (fb as any).user_id,
        type:     'feedback_rejected',
        title:    'Feedback not accepted this time',
        message:  'Thank you for your feedback. It didn\'t qualify for credits this time — feel free to submit again.',
        metadata: { feedback_id: id },
        is_read:  false,
      });
      if (notifyErr) console.error('[admin/feedback] rejection notification failed:', id, notifyErr.message);
    }

    return res.status(200).json({ success: true, action, creditsGranted });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).end();
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/feedback' });
