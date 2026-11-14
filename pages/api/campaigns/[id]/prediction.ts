import { seamDenial } from '../../../../backend/db/seamDenial';
import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET  /api/campaigns/:id/prediction        — fetch latest stored prediction
 * POST /api/campaigns/:id/prediction        — run a new prediction
 * POST /api/campaigns/:id/prediction/accuracy — evaluate predicted vs actual
 *
 * Auth: requireAuth + requireCompanyAccess (company membership verified)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { predictCampaignOutcome, type CampaignPlanInput } from '@/backend/services/campaignPredictionEngine';
import { PaymentRequiredError } from '@/backend/services/billing/phase2EnforcementGate';
import { evaluatePredictionAccuracy } from '@/backend/services/predictionAccuracyService';
import { requireAuth, requireCompanyAccess } from '@/backend/middleware/authMiddleware';
import { supabase as adminSupabase } from '@/backend/db/supabaseClient';
import { tenantChildTable, tenantContextFor, ownerCompanyOfRow, TenantSeamError } from '@/backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const campaignId = req.query.id as string;
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID required' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // Look up campaign's company.
  // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the campaign (the same
  // campaigns.company_id as before; name/status were never used). Missing, unreadable or company-less: the same 404
  // (a company-less campaign used to reach requireCompanyAccess with a null company and be denied there).
  const campaignCompanyId = await ownerCompanyOfRow('campaigns', campaignId, 'campaign prediction: owner of the campaign');
  if (!campaignCompanyId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const allowed = await requireCompanyAccess(auth.user.id, campaignCompanyId, res);
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
    // S2 tenant seam: campaign_predictions is a child of campaigns; read through tenantChildTable with the
    // tenant built from the company requireCompanyAccess just authorized (campaignCompanyId) for this user.
    let predictionsTable: Awaited<ReturnType<typeof tenantChildTable>>;
    try {
      const tenant = tenantContextFor({ userId: auth.user.id }, campaignCompanyId);
      predictionsTable = await tenantChildTable('campaign_predictions', tenant, campaignId);
    } catch (err) {
      if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Campaign not found' });
      throw err;
    }
    const { data: prediction } = await predictionsTable
      .select('*')
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
        .eq('id', campaignCompanyId)
        .maybeSingle();
      description = (company as any)?.description ?? (company as any)?.name ?? '';
    }

    const planInput: CampaignPlanInput = {
      campaign_id:       campaignId,
      company_id:        campaignCompanyId,
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
      if (err instanceof PaymentRequiredError) {
        return res.status(402).json({ error: err.message, code: err.code });
      }
      console.error('[prediction/run]', err?.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/prediction' });
