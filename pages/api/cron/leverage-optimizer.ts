
/**
 * GET /api/cron/leverage-optimizer
 *
 * Daily cron — runs the outcome measurement + efficiency optimization loop
 * for all companies with campaign data.
 *
 * Schedule: 0 2 * * *  (2am daily — after health monitor has run)
 * Header:   x-cron-secret: $CRON_SECRET
 *
 * Per company:
 *   1. measureOutcomeScore for recently completed campaigns
 *   2. checkAndFailFast for active campaigns
 *   3. optimizeCreditEfficiency (upgrades efficiency tier, prunes content)
 *   4. checkCreditAlerts (fires low-balance notifications)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { measureOutcomeScore } from '../../../backend/services/outcomeTrackingService';
import { checkAndFailFast } from '../../../backend/services/failFastService';
import { optimizeCreditEfficiency } from '../../../backend/services/creditEfficiencyEngine';
import { checkCreditAlerts } from '../../../backend/services/creditAlertService';

type LeverageRunResult = {
  companies_processed: number;
  outcomes_measured:   number;
  fail_fast_triggered: number;
  efficiency_upgrades: string[];
  alerts_fired:        number;
  errors:              string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const result: LeverageRunResult = {
    companies_processed: 0,
    outcomes_measured:   0,
    fail_fast_triggered: 0,
    efficiency_upgrades: [],
    alerts_fired:        0,
    errors:              [],
  };

  try {
    // ── 1. Get all active companies ────────────────────────────────────────
    const { data: companies } = await supabase
      .from('companies')
      .select('id')
      .eq('status', 'active')
      .limit(200);

    if (!companies?.length) {
      return res.status(200).json({ success: true, result });
    }

    // ── 2. Get recently completed campaigns (last 48h) ─────────────────────
    const since48h = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data: completedCampaigns } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .in('status', ['completed', 'ended'])
      .gte('updated_at', since48h);

    // ── 3. Get active campaigns for fail-fast check ────────────────────────
    const { data: activeCampaigns } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .in('status', ['active', 'execution_ready']);

    const processedCompanyIds = new Set<string>();

    // ── Measure outcomes for completed campaigns ───────────────────────────
    for (const campaign of (completedCampaigns ?? []) as Array<{ id: string; company_id: string }>) {
      try {
        await measureOutcomeScore(campaign.id, campaign.company_id);
        result.outcomes_measured++;
        processedCompanyIds.add(campaign.company_id);
      } catch (err: any) {
        result.errors.push(`outcome [${campaign.id}]: ${err?.message}`);
      }
    }

    // ── Fail-fast check for active campaigns ──────────────────────────────
    for (const campaign of (activeCampaigns ?? []) as Array<{ id: string; company_id: string }>) {
      try {
        const ff = await checkAndFailFast(campaign.id, campaign.company_id);
        if (ff.total_credits_reallocated > 0) {
          result.fail_fast_triggered++;
        }
        processedCompanyIds.add(campaign.company_id);
      } catch (err: any) {
        result.errors.push(`fail-fast [${campaign.id}]: ${err?.message}`);
      }
    }

    // ── Efficiency optimization + credit alerts per company ────────────────
    const companyIds = [...new Set([
      ...processedCompanyIds,
      ...(companies as Array<{ id: string }>).map(c => c.id).slice(0, 50),
    ])];

    for (const companyId of companyIds) {
      result.companies_processed++;
      try {
        const [effReport, alertResult] = await Promise.all([
          optimizeCreditEfficiency(companyId),
          checkCreditAlerts(companyId),
        ]);

        if (effReport.efficiency_tier !== 'standard') {
          result.efficiency_upgrades.push(`${companyId.slice(0, 8)}: ${effReport.efficiency_tier}`);
        }

        result.alerts_fired += alertResult.alerts_fired.length;
      } catch (err: any) {
        result.errors.push(`[${companyId}]: ${err?.message}`);
      }
    }

    console.log('[cron/leverage-optimizer]', result);
    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    console.error('[cron/leverage-optimizer] fatal', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
