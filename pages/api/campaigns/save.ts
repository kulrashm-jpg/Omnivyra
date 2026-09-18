import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { campaignId, name, description } = req.body;

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // ROUTE-AUTH-001 (STEP 3AH-85) — the upsert below is keyed by a
    // client-supplied id and stamps user_id with the caller, so without a
    // binding any authenticated user could overwrite (and take over) any
    // tenant's campaign. Only a genuinely new id may be created freely; an id
    // that already exists (campaigns row or owner record) must be one the
    // caller can access — requireCampaignAccess resolves the owner from
    // campaign_versions, so a campaign with no owner record is refused too.
    const [{ data: existingCampaign, error: existingErr }, { data: existingVersion, error: versionErr }] =
      await Promise.all([
        supabase.from('campaigns').select('id').eq('id', campaignId).maybeSingle(),
        supabase.from('campaign_versions').select('campaign_id').eq('campaign_id', campaignId).limit(1).maybeSingle(),
      ]);
    if (existingErr || versionErr) {
      return res.status(503).json({ error: 'Campaign lookup is temporarily unavailable. Please try again.' });
    }
    const existed = Boolean(existingCampaign || existingVersion);
    if (existed) {
      const access = await requireCampaignAccess(req, res, campaignId);
      if (!access) return;
    }

    // WSF-ORD-007 — the binding above and the write below used to be an
    // existence CHECK followed by an unconditional UPSERT: two statements with
    // a gap between them. A campaign created by another tenant inside that gap
    // matched no existence read, skipped requireCampaignAccess entirely, and
    // was then overwritten by the upsert — which also stamps `user_id` with
    // the caller, so the race was an ownership takeover, not just a lost
    // update. The window was widened by the two lookups plus, for an existing
    // id, the whole guard chain (campaign_versions read + membership read).
    //
    // The write is now split so the "new campaign" case is INSERT-ONLY. The
    // database, not our earlier read, decides whether the id was free: if the
    // row appeared meanwhile the insert fails on the primary key, and we then
    // authorize the campaign that actually exists before applying the change
    // as a scoped update. A caller who cannot pass that guard is refused by
    // it, exactly as if the row had existed all along.
    const payload = {
      id: campaignId,
      name: name || 'Campaign ' + campaignId,
      description: description || '',
      status: 'planning',
      current_stage: 'planning',
      timeframe: 'quarter',
      user_id: user.id,
      thread_id: 'thread_' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const writeExisting = () =>
      supabase.from('campaigns').update(payload).eq('id', campaignId).select().single();

    let { data: campaign, error } = existed
      ? await writeExisting()
      : await supabase.from('campaigns').insert(payload).select().single();

    // 23505 = unique_violation: we lost the create race for this id.
    if (!existed && (error as { code?: string } | null)?.code === '23505') {
      const access = await requireCampaignAccess(req, res, campaignId);
      if (!access) return;
      ({ data: campaign, error } = await writeExisting());
    }

    if (error) {
      console.error('Error saving campaign:', error);
      return res.status(500).json({ error: 'Failed to save campaign', details: error });
    }

    return res.status(200).json({
      success: true,
      campaign
    });

  } catch (error) {
    console.error('Error in save campaign API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/save' });
