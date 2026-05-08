
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
import { runJob } from '../../../backend/services/jobRunner';

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

  // Each per-org block below is wrapped in runJob so the canonical
  // tenant guard rejects soft-deleted / suspended orgs BEFORE the
  // service-level work runs. The previous loop's `WHERE status='active'`
  // filter was insufficient — it only checks the companies row's
  // string column, not the organization's overall canonical state, and
  // missed orgs whose membership had been revoked.
  const dayBucket = new Date().toISOString().slice(0, 10);
  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers['x-cron-secret'] === process.env.CRON_SECRET;

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

    // ── Measure outcomes for completed campaigns (per-tenant containment) ──
    for (const campaign of (completedCampaigns ?? []) as Array<{ id: string; company_id: string }>) {
      const outcome = await runJob(
        {
          jobName:        'cron:leverage-optimizer:outcome',
          triggerSource:  triggeredByCronSecret ? 'cron' : 'admin',
          tenantId:       campaign.company_id,
          principalKind:  'cron-secret',
          idempotencyKey: `cron:leverage-optimizer:outcome:${campaign.id}:${dayBucket}`,
          // Per-tenant analytical work is fine sequentially. Daily cron
          // tick can't fan out a single tenant beyond 1 in flight.
          concurrency: {
            key:                 `tenant:${campaign.company_id}:cron:leverage-optimizer`,
            max:                 1,
            maxPerSecond:        5,
            maxRetriesPerMinute: 6,
          },
        },
        async () => measureOutcomeScore(campaign.id, campaign.company_id),
      );

      if (outcome.status === 'completed') {
        result.outcomes_measured++;
        processedCompanyIds.add(campaign.company_id);
      } else if (outcome.status === 'tenant_invalid') {
        result.errors.push(`outcome [${campaign.id}]: tenant_invalid (${outcome.reason})`);
      } else if (outcome.status === 'pressure_rejected') {
        // Governor refused — next cron tick handles. Don't fail; log.
        result.errors.push(`outcome [${campaign.id}]: pressure_rejected (${outcome.reason})`);
      } else if (outcome.status === 'failed') {
        result.errors.push(`outcome [${campaign.id}]: ${
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        }`);
      }
    }

    // ── Fail-fast check for active campaigns (per-tenant containment) ──────
    for (const campaign of (activeCampaigns ?? []) as Array<{ id: string; company_id: string }>) {
      const outcome = await runJob(
        {
          jobName:        'cron:leverage-optimizer:fail-fast',
          triggerSource:  triggeredByCronSecret ? 'cron' : 'admin',
          tenantId:       campaign.company_id,
          principalKind:  'cron-secret',
          idempotencyKey: `cron:leverage-optimizer:fail-fast:${campaign.id}:${dayBucket}`,
          concurrency: {
            key:                 `tenant:${campaign.company_id}:cron:leverage-optimizer`,
            max:                 1,
            maxPerSecond:        5,
            maxRetriesPerMinute: 6,
          },
        },
        async () => checkAndFailFast(campaign.id, campaign.company_id),
      );

      if (outcome.status === 'completed') {
        if (outcome.result.total_credits_reallocated > 0) {
          result.fail_fast_triggered++;
        }
        processedCompanyIds.add(campaign.company_id);
      } else if (outcome.status === 'tenant_invalid') {
        result.errors.push(`fail-fast [${campaign.id}]: tenant_invalid (${outcome.reason})`);
      } else if (outcome.status === 'pressure_rejected') {
        result.errors.push(`fail-fast [${campaign.id}]: pressure_rejected (${outcome.reason})`);
      } else if (outcome.status === 'failed') {
        result.errors.push(`fail-fast [${campaign.id}]: ${
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        }`);
      }
    }

    // ── Efficiency optimization + credit alerts (per-tenant containment) ───
    const companyIds = [...new Set([
      ...processedCompanyIds,
      ...(companies as Array<{ id: string }>).map(c => c.id).slice(0, 50),
    ])];

    for (const companyId of companyIds) {
      result.companies_processed++;
      const outcome = await runJob(
        {
          jobName:        'cron:leverage-optimizer:efficiency',
          triggerSource:  triggeredByCronSecret ? 'cron' : 'admin',
          tenantId:       companyId,
          principalKind:  'cron-secret',
          idempotencyKey: `cron:leverage-optimizer:efficiency:${companyId}:${dayBucket}`,
          concurrency: {
            key:                 `tenant:${companyId}:cron:leverage-optimizer`,
            max:                 1,
            maxPerSecond:        5,
            maxRetriesPerMinute: 6,
          },
        },
        async () => Promise.all([
          optimizeCreditEfficiency(companyId),
          checkCreditAlerts(companyId),
        ]),
      );

      if (outcome.status === 'completed') {
        const [effReport, alertResult] = outcome.result;
        if (effReport.efficiency_tier !== 'standard') {
          result.efficiency_upgrades.push(`${companyId.slice(0, 8)}: ${effReport.efficiency_tier}`);
        }
        result.alerts_fired += alertResult.alerts_fired.length;
      } else if (outcome.status === 'tenant_invalid') {
        result.errors.push(`[${companyId}]: tenant_invalid (${outcome.reason})`);
      } else if (outcome.status === 'pressure_rejected') {
        result.errors.push(`[${companyId}]: pressure_rejected (${outcome.reason})`);
      } else if (outcome.status === 'failed') {
        result.errors.push(`[${companyId}]: ${
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        }`);
      }
    }

    console.log('[cron/leverage-optimizer]', result);
    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    console.error('[cron/leverage-optimizer] fatal', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
