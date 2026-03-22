/**
 * GET  /api/campaigns/[id]/performance
 *   → Returns the most recent performance snapshot + evaluation for this campaign.
 *
 * POST /api/campaigns/[id]/performance
 *   → Records new raw metrics, runs evaluation, stores result.
 *   Body: {
 *     total_reach?, total_impressions?, engagement_rate?, avg_likes?,
 *     total_likes?, total_comments?, total_clicks?, total_shares?, total_leads?
 *   }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { evaluateOutcome, getDefaultBenchmarks, type CampaignActuals } from '../../../../backend/lib/campaigns/outcomeEvaluator';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  // Resolve campaign + goal config
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, goal_type, goal_benchmarks, topic_seed, source_blog_id')
    .eq('id', id)
    .maybeSingle();

  if (campErr || !campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: latest } = await supabase
      .from('campaign_performance')
      .select('*')
      .eq('campaign_id', id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.status(200).json({
      campaign_id: id,
      goal_type: campaign.goal_type ?? null,
      goal_benchmarks: campaign.goal_benchmarks ?? null,
      latest_performance: latest ?? null,
    });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {};

    // Resolve company_id from campaign_versions
    const { data: versionRow } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const companyId = versionRow?.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Cannot resolve company for this campaign' });
    }

    const actuals: CampaignActuals = {
      total_reach:     typeof body.total_reach     === 'number' ? body.total_reach     : null,
      engagement_rate: typeof body.engagement_rate === 'number' ? body.engagement_rate : null,
      avg_likes:       typeof body.avg_likes       === 'number' ? body.avg_likes
                     : typeof body.total_likes     === 'number' && typeof body.published_slots === 'number' && body.published_slots > 0
                       ? body.total_likes / body.published_slots
                       : null,
      total_comments:  typeof body.total_comments  === 'number' ? body.total_comments  : null,
      total_clicks:    typeof body.total_clicks    === 'number' ? body.total_clicks    : null,
    };

    // Build goal config (use stored or defaults)
    const goalType = campaign.goal_type ?? 'awareness';
    const storedBenchmarks = campaign.goal_benchmarks ?? {};
    const defaultBenchmarks = getDefaultBenchmarks(goalType as any);
    const benchmarks = { ...defaultBenchmarks, ...storedBenchmarks };

    const evaluation = evaluateOutcome(
      { goal_type: goalType as any, benchmarks },
      actuals
    );

    const { data: perf, error: perfErr } = await supabase
      .from('campaign_performance')
      .insert({
        campaign_id:        id,
        company_id:         companyId,
        total_reach:        body.total_reach        ?? null,
        total_impressions:  body.total_impressions  ?? null,
        engagement_rate:    body.engagement_rate    ?? null,
        avg_likes:          actuals.avg_likes       ?? null,
        total_likes:        body.total_likes        ?? null,
        total_comments:     body.total_comments     ?? null,
        total_clicks:       body.total_clicks       ?? null,
        total_shares:       body.total_shares       ?? null,
        total_leads:        body.total_leads        ?? null,
        evaluation_status:  evaluation.status,
        evaluation_score:   evaluation.score,
        evaluation_summary: evaluation.summary,
        metric_breakdown:   evaluation.metric_breakdown,
        confidence_level:   evaluation.confidence.level,
        confidence_reason:  evaluation.confidence.reason,
        recorded_at:        new Date().toISOString(),
      })
      .select('*')
      .single();

    if (perfErr || !perf) {
      console.error('Failed to store performance:', perfErr?.message);
      return res.status(500).json({ error: 'Failed to store performance record' });
    }

    return res.status(201).json({
      performance_id: perf.id,
      evaluation,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.COMPANY_ADMIN]);
