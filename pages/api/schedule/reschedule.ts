import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/schedule/reschedule
 * Updates scheduled_posts.scheduled_for for drag-and-drop rescheduling.
 * Payload: { scheduled_post_id, new_date (YYYY-MM-DD), companyId? }
 *
 * 3AH-92 (S-3) — the post's OWNER is resolved server-side and authorized
 * before anything is written or enqueued. The route used to load the post by
 * id with no tenant scope, authorize whatever `companyId` the caller sent, and
 * bind the post to it only when a campaign_versions row happened to exist — so
 * a post with campaign_id NULL, a campaign with no version row, or a failed
 * version read let every signed-in user retime (and re-enqueue publishing on)
 * another tenant's post and social account.
 *
 * Owner rules (the existing canonical ones, not new):
 *   - campaign post  → requireCampaignAccess on the post's campaign (owner =
 *     latest campaign_versions row; no version ⇒ 404; caller needs a role in
 *     that company). The campaign's other owner records must agree with it:
 *     the campaigns row must exist, campaigns.company_id must be NULL or the
 *     same company, and no version row may name a different company.
 *   - campaign_id NULL → the post's user_id must be the caller, the rule
 *     /api/schedule/posts/[id] (getLegacyScheduledPostById) applies to the
 *     same update + enqueue.
 * The request `companyId` never grants anything; when sent, it must name the
 * resolved owner company. Every missing record, conflict or failed read denies.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(str: string): Date | null {
  const m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Number.isFinite(d.getTime()) ? d : null;
}

type CampaignOwnerAgreement = 'agrees' | 'missing' | 'conflict' | 'lookup_error';

/**
 * The campaign's other owner records must name the company requireCampaignAccess
 * resolved. campaigns.company_id (TenantGuard / checkCampaignOwnership's
 * authority) may be NULL — most creation flows only write user_id there — but
 * never a different company; no campaign_versions row may name a different
 * company either (checkCampaignOwnership accepts ANY version row, so a second
 * company in the history would be an owner for the other guard).
 */
async function campaignOwnerAgreement(campaignId: string, ownerCompanyId: string): Promise<CampaignOwnerAgreement> {
  const campaign = await supabase.from('campaigns').select('id, company_id').eq('id', campaignId).maybeSingle();
  if (campaign.error) return 'lookup_error';
  if (!campaign.data) return 'missing';
  const legacyCompany = (campaign.data as { company_id?: string | null }).company_id ?? null;
  if (legacyCompany && String(legacyCompany) !== ownerCompanyId) return 'conflict';
  const others = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .neq('company_id', ownerCompanyId)
    .limit(1);
  if (others.error) return 'lookup_error';
  return Array.isArray(others.data) && others.data.length > 0 ? 'conflict' : 'agrees';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate before the post is read: an anonymous caller learns nothing
  // about which ids exist.
  const user = await resolveUserContext(req);
  if (!user?.userId || user.authenticated === false) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { scheduled_post_id, new_date } = req.body || {};
  const rawCompanyId = req.body?.companyId;
  const postId = typeof scheduled_post_id === 'string' ? scheduled_post_id.trim() : '';
  const newDate = parseDate(typeof new_date === 'string' ? new_date : '');

  if (!postId || !newDate) {
    return res.status(400).json({ error: 'scheduled_post_id and new_date (YYYY-MM-DD) required' });
  }
  if (!UUID_RE.test(postId)) {
    return res.status(400).json({ error: 'scheduled_post_id must be a UUID' });
  }
  if (rawCompanyId != null && typeof rawCompanyId !== 'string') {
    return res.status(400).json({ error: 'companyId must be a string' });
  }
  const requestedCompanyId = typeof rawCompanyId === 'string' ? rawCompanyId.trim() : '';

  try {
    const { data: post, error: postErr } = await supabase
      .from('scheduled_posts')
      .select('id, campaign_id, scheduled_for, social_account_id, user_id, status')
      .eq('id', postId)
      .maybeSingle();

    if (postErr) {
      console.error('[schedule/reschedule] post lookup failed', postErr);
      return res.status(503).json({ error: 'Scheduled post lookup failed. Please retry.', code: 'POST_LOOKUP_FAILED' });
    }
    if (!post) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    const campaignId = post.campaign_id ? String(post.campaign_id) : '';
    if (campaignId) {
      const access = await requireCampaignAccess(req, res, campaignId);
      if (!access) return;
      if (requestedCompanyId && requestedCompanyId !== access.companyId) {
        return res.status(403).json({ error: 'Post not in company scope' });
      }
      const agreement = await campaignOwnerAgreement(campaignId, access.companyId);
      if (agreement === 'lookup_error') {
        return res.status(503).json({ error: 'Campaign ownership check failed. Please retry.', code: 'CAMPAIGN_LOOKUP_ERROR' });
      }
      if (agreement === 'missing') {
        return res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
      }
      if (agreement === 'conflict') {
        console.warn('[schedule/reschedule] CAMPAIGN_OWNERSHIP_CONFLICT', { campaignId, ownerCompanyId: access.companyId });
        return res.status(403).json({ error: 'Campaign ownership could not be verified.', code: 'CAMPAIGN_OWNERSHIP_CONFLICT' });
      }
    } else if (String(post.user_id ?? '') !== user.userId) {
      // A post outside a campaign belongs to its user alone; to anyone else
      // it does not exist.
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    const oldScheduled = post.scheduled_for ? new Date(post.scheduled_for) : new Date();
    const newScheduledFor = new Date(newDate);
    newScheduledFor.setHours(oldScheduled.getHours(), oldScheduled.getMinutes(), oldScheduled.getSeconds(), 0);

    // The write repeats the ownership predicate it was authorized under, so a
    // post re-parented between the read and the write is left untouched.
    const update = supabase
      .from('scheduled_posts')
      .update({
        scheduled_for: newScheduledFor.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId);
    const { error } = campaignId
      ? await update.eq('campaign_id', campaignId)
      : await update.is('campaign_id', null).eq('user_id', user.userId);

    if (error) {
      console.error('[schedule/reschedule]', error);
      return res.status(500).json({ error: error.message });
    }

    // calendar_events_index teardown: the manual event_date sync here was
    // redundant (the scheduled_posts UPDATE trigger maintained it) and the
    // index is being removed. The scheduled_posts.scheduled_for update above is
    // the source of truth; the calendar reads it via activity-events.

    try {
      if (post.social_account_id && post.status === 'scheduled') {
        await enqueueScheduledPostAt(postId, String(post.user_id), String(post.social_account_id), newScheduledFor.toISOString());
      }
    } catch (enqueueError: any) {
      console.warn('[schedule/reschedule] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
    }

    return res.status(200).json({
      success: true,
      scheduled_post_id: postId,
      new_date: newDate.toISOString().slice(0, 10),
    });
  } catch (err: unknown) {
    console.error('[schedule/reschedule]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/schedule/reschedule' });
