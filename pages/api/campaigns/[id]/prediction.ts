/**
 * GET  /api/campaigns/:id/prediction        — fetch latest stored prediction
 * POST /api/campaigns/:id/prediction        — run a new prediction
 * POST /api/campaigns/:id/prediction/accuracy — evaluate predicted vs actual
 *
 * Auth: requireAuth + requireCompanyAccess (company membership verified)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { predictCampaignOutcome, type CampaignPlanInput } from '@/backend/services/campaignPredictionEngine';
import { evaluatePredictionAccuracy } from '@/backend/services/predictionAccuracyService';
import { requireAuth, requireCompanyAccess } from '@/backend/middleware/authMiddleware';
import { supabase as adminSupabase } from '@/backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const campaignId = req.query.id as string;
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID required' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // Look up campaign's company (service-role to guarantee lookup succeeds)
  const { data: campaign, error: campaignErr } = await adminSupabase
    .from('campaigns')
    .select('id, company_id, name, status')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignErr || !campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const allowed = await requireCompanyAccess(auth.user.id, campaign.company_id, res);
  if (!allowed) return;

  // ── POST .../accuracy ─────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url?.includes('/accuracy')) {
    try {
      const result = await evaluatePredictionAccuracy(campaignId);
      if (!result) return res.status(404).json({ error: 'No prediction or performance data found' });
      return res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error('[prediction/accuracy]', err?.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ── GET — fetch latest stored prediction ──────────────────────────────────
  if (req.method === 'GET') {
    const { data: prediction } = await adminSupabase
      .from('campaign_predictions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!prediction) {
      return res.status(404).json({ error: 'No prediction found — POST to generate one' });
    }
    return res.status(200).json({ success: true, data: prediction });
  }

  // ── POST — run a fresh prediction ─────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};

    // Load strategy context from DB if not provided
    let strategyContext = body.strategy_context;
    if (!strategyContext) {
      const { data: strategy } = await adminSupabase
        .from('campaign_strategies')
        .select('platforms, posting_frequency, content_mix, duration_weeks, campaign_goal, target_audience')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      strategyContext = strategy ?? {
        platforms:         ['linkedin'],
        posting_frequency: { linkedin: 3 },
        content_mix:       { post: 80, carousel: 20 },
        duration_weeks:    12,
      };
    }

    let description = body.description ?? '';
    if (!description) {
      const { data: company } = await adminSupabase
        .from('companies')
        .select('description, name')
        .eq('id', campaign.company_id)
        .maybeSingle();
      description = (company as any)?.description ?? (company as any)?.name ?? '';
    }

    const planInput: CampaignPlanInput = {
      campaign_id:       campaignId,
      company_id:        campaign.company_id,
      description,
      strategy_context:  strategyContext,
      content_samples:   body.content_samples,
      account_authority: body.account_authority,
      sentiment_score:   body.sentiment_score,
    };

    try {
      const prediction = await predictCampaignOutcome(planInput);
      return res.status(200).json({ success: true, data: prediction });
    } catch (err: any) {
      console.error('[prediction/run]', err?.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
