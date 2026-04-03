
/**
 * POST /api/campaigns/pending/:id/approve
 * POST /api/campaigns/pending/:id/reject
 *
 * Approve or reject a pending autonomous campaign.
 * On approval: atomically marks pending as approved then creates the campaign.
 * On rejection: marks the pending record as rejected.
 *
 * Auth: requireAuth + requireCompanyAccess
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireAuth, requireCompanyAccess } from '@/backend/middleware/authMiddleware';
import { logDecision } from '@/backend/services/autonomousDecisionLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const pendingId = req.query.id as string;
  const action = req.url?.endsWith('/reject') ? 'reject' : 'approve';

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const note: string | undefined = body.note;

  // Load pending campaign
  const { data: pending, error: loadError } = await supabase
    .from('pending_campaigns')
    .select('*')
    .eq('id', pendingId)
    .maybeSingle();

  if (loadError || !pending) {
    return res.status(404).json({ error: 'Pending campaign not found' });
  }
  if ((pending as any).status !== 'pending') {
    return res.status(409).json({ error: `Campaign already ${(pending as any).status}` });
  }

  const companyId = (pending as any).company_id as string;

  // Verify user has access to this company
  const allowed = await requireCompanyAccess(auth.user.id, companyId, res);
  if (!allowed) return;

  const reviewedAt = new Date().toISOString();
  const reviewedBy = auth.user.email ?? auth.user.id;

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === 'reject') {
    const { error: rejectErr } = await supabase.from('pending_campaigns').update({
      status:      'rejected',
      reviewed_at: reviewedAt,
      reviewed_by: reviewedBy,
    }).eq('id', pendingId).eq('status', 'pending'); // guard against race

    if (rejectErr) {
      console.error('[pending/approve] reject failed:', rejectErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    await logDecision({
      company_id:    companyId,
      decision_type: 'reject',
      reason:        note ?? 'Rejected by user',
      metrics_used:  { pending_id: pendingId, reviewed_by: reviewedBy },
    });

    return res.status(200).json({ success: true, action: 'rejected' });
  }

  // ── Approve → mark pending first, then create campaign ───────────────────
  // Marking as approved BEFORE creating the campaign prevents a double-approve
  // race and ensures no orphaned campaigns if campaign insert fails.
  const { error: markErr } = await supabase.from('pending_campaigns').update({
    status:      'approved',
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
  }).eq('id', pendingId).eq('status', 'pending'); // optimistic lock

  if (markErr) {
    console.error('[pending/approve] status update failed:', markErr.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const plan = (pending as any).campaign_plan as Record<string, unknown>;

  const { data: newCampaign, error: createError } = await supabase.from('campaigns').insert({
    company_id:        companyId,
    name:              plan.name,
    description:       plan.description,
    status:            'scheduled',
    platforms:         plan.platforms,
    posting_frequency: plan.posting_frequency,
    content_mix:       plan.content_mix,
    duration_weeks:    plan.duration_weeks,
    campaign_goal:     plan.campaign_goal,
    generation_meta:   (plan as any).generation_meta,
    created_at:        reviewedAt,
    updated_at:        reviewedAt,
  }).select('id').maybeSingle();

  if (createError) {
    console.error('[pending/approve] campaign create failed:', createError.message);
    // Roll back status so admin can retry
    await supabase.from('pending_campaigns').update({
      status: 'pending',
    }).eq('id', pendingId);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const campaignId = (newCampaign as { id: string }).id;

  // Notify team (non-fatal)
  await supabase.from('notifications').insert({
    company_id: companyId,
    type:       'campaign_approved',
    title:      'Campaign approved and scheduled',
    body:       `"${plan.name}" has been approved and is now scheduled.`,
    metadata:   { campaign_id: campaignId, pending_id: pendingId },
    created_at: reviewedAt,
    read:       false,
  });

  await logDecision({
    company_id:    companyId,
    campaign_id:   campaignId,
    decision_type: 'approve',
    reason:        note ?? 'Approved by user',
    metrics_used:  { pending_id: pendingId, reviewed_by: reviewedBy },
    outcome:       `Campaign created: ${campaignId}`,
  });

  return res.status(200).json({
    success:     true,
    action:      'approved',
    campaign_id: campaignId,
  });
}
