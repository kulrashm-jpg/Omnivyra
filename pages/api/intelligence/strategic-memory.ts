import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { buildStrategicMemoryProfile } from '../../../lib/intelligence/strategicMemory';
import type { StrategistAction } from '../../../lib/intelligence/strategicMemory';

const ALL_ACTIONS: StrategistAction[] = ['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'];

function isValidAction(a: string): a is StrategistAction {
  return ALL_ACTIONS.includes(a as StrategistAction);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'POST') {
      const body = req.body as Record<string, unknown>;
      const campaign_id = typeof body?.campaign_id === 'string' ? body.campaign_id.trim() : '';
      const action = typeof body?.action === 'string' ? body.action.trim() : '';
      const accepted = Boolean(body?.accepted);
      const platform = body?.platform != null ? String(body.platform).trim() || null : null;
      const confidence_score =
        body?.confidence_score != null && Number.isFinite(Number(body.confidence_score))
          ? Math.max(0, Math.min(100, Math.round(Number(body.confidence_score))))
          : null;

      if (!campaign_id || !action || !isValidAction(action)) {
        return res.status(400).json({ error: 'campaign_id and action (IMPROVE_CTA | IMPROVE_HOOK | ADD_DISCOVERABILITY) required' });
      }

      const access = await requireCampaignAccess(req, res, campaign_id);
      if (!access) return;

      const { error } = await supabase.from('campaign_strategic_memory').insert({
        campaign_id: access.campaignId,
        action,
        platform: platform || null,
        accepted,
        confidence_score,
      });

      if (error) {
        console.error('[StrategicMemoryAPI] insert error', error);
        return res.status(500).json({ error: 'Failed to persist strategic memory event' });
      }

      return res.status(200).json({ success: true });
    }

    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query required' });
    }

    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const { data: rows, error } = await supabase
      .from('campaign_strategic_memory')
      .select('action, platform, accepted, confidence_score, created_at')
      .eq('campaign_id', access.campaignId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[StrategicMemoryAPI] fetch error', error);
      return res.status(500).json({ error: 'Failed to fetch strategic memory' });
    }

    const events = (rows || []).map((r: any) => ({
      campaign_id: access.campaignId,
      execution_id: '',
      platform: r.platform ?? undefined,
      action: r.action as StrategistAction,
      accepted: Boolean(r.accepted),
      timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    }));

    const confidenceHistory: Array<{ platform: string; confidence: number }> = [];
    for (const r of rows || []) {
      if (r.confidence_score != null && Number.isFinite(r.confidence_score) && r.platform) {
        confidenceHistory.push({
          platform: String(r.platform).trim().toLowerCase(),
          confidence: Math.max(0, Math.min(100, Number(r.confidence_score))),
        });
      }
    }

    const profile = buildStrategicMemoryProfile(events, confidenceHistory);

    if (process.env.NODE_ENV === 'development') {
      console.log('[StrategicMemoryAPI]', { campaignId: access.campaignId, totalRows: (rows || []).length });
    }

    return res.status(200).json(profile);
  } catch (err) {
    console.error('[StrategicMemoryAPI]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
